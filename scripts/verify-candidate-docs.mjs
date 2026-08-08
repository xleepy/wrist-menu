import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cp, lstat, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { APPROVED_PACKAGE_FILES } from './approved-package-files.mjs'
import { buildCandidateBundle, verifyCandidateBundle } from './candidate-package.mjs'
import { sha256 } from './release-evidence-lib.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const evidenceFlag = process.argv.indexOf('--evidence-bundle')
const evidenceBundleDirectory =
  evidenceFlag < 0 ? undefined : process.argv[evidenceFlag + 1]
const npmCli = process.env.npm_execpath

assert.ok(npmCli, 'run candidate verification through npm')
assert.ok(
  evidenceBundleDirectory,
  'usage: npm run candidate:verify -- --evidence-bundle <immutable-record-directory>',
)

async function listFiles(directory, current = directory) {
  const files = []
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = resolve(current, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listFiles(directory, path)))
    } else if (entry.isFile()) {
      files.push(relative(directory, path).replaceAll('\\', '/'))
    } else {
      throw new Error(`candidate consumer contains a link: ${entry.name}`)
    }
  }
  return files.sort()
}

function npm(args, cwd) {
  execFileSync(process.execPath, [npmCli, ...args], { cwd, stdio: 'inherit' })
}

function npmJson(args, cwd) {
  return JSON.parse(
    execFileSync(process.execPath, [npmCli, ...args], {
      cwd,
      encoding: 'utf8',
    }),
  )
}

const { bundleDirectory, candidate } = await buildCandidateBundle({
  root,
  evidenceBundleDirectory: resolve(evidenceBundleDirectory),
})
await verifyCandidateBundle(bundleDirectory)

const fixtureSource = resolve(root, 'fixtures', 'candidate-docs')
const temporaryRoot = await mkdtemp(join(tmpdir(), 'wrist-menu-docs-consumer-'))
const fixtureDirectory = resolve(temporaryRoot, 'candidate-docs')

try {
  await cp(fixtureSource, fixtureDirectory, { recursive: true })
  const packageJsonBefore = await readFile(resolve(fixtureDirectory, 'package.json'))
  const packageLockBefore = await readFile(
    resolve(fixtureDirectory, 'package-lock.json'),
  )

  npm(['ci', '--ignore-scripts', '--no-audit', '--no-fund'], fixtureDirectory)
  const lockedTreeBefore = npmJson(['ls', '--all', '--json'], fixtureDirectory)
  npm(
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--no-save',
      '--package-lock=false',
      '--install-links=true',
      resolve(bundleDirectory, 'package'),
    ],
    fixtureDirectory,
  )

  const installedPackage = resolve(
    fixtureDirectory,
    'node_modules',
    '@xleepy',
    'wrist-menu',
  )
  assert.equal(
    (await lstat(installedPackage)).isSymbolicLink(),
    false,
    'candidate fixture must install a copy, not a workspace/source link',
  )
  assert.deepEqual(await listFiles(installedPackage), APPROVED_PACKAGE_FILES)
  for (const path of APPROVED_PACKAGE_FILES) {
    const [extracted, installed] = await Promise.all([
      readFile(resolve(bundleDirectory, 'package', path)),
      readFile(resolve(installedPackage, path)),
    ])
    assert.equal(sha256(installed), sha256(extracted), `installed bytes differ: ${path}`)
  }

  npm(['test'], fixtureDirectory)

  npm(['ci', '--ignore-scripts', '--no-audit', '--no-fund'], fixtureDirectory)
  await assert.rejects(() => lstat(installedPackage), { code: 'ENOENT' })
  assert.deepEqual(await readFile(resolve(fixtureDirectory, 'package.json')), packageJsonBefore)
  assert.deepEqual(
    await readFile(resolve(fixtureDirectory, 'package-lock.json')),
    packageLockBefore,
  )
  assert.deepEqual(
    npmJson(['ls', '--all', '--json'], fixtureDirectory),
    lockedTreeBefore,
    'restored dependency tree differs from the frozen checkout',
  )

  console.log(`verified extracted candidate ${candidate.package.sha256}`)
  console.log('restored clean locked candidate-docs consumer checkout')
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
