import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { APPROVED_PACKAGE_FILES } from './approved-package-files.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const artifactDirectory = resolve(root, 'artifacts')
const npmCli = process.env.npm_execpath

assert.ok(npmCli, 'run package verification through npm')

await mkdir(artifactDirectory, { recursive: true })

const packOutput = execFileSync(
  process.execPath,
  [npmCli, 'pack', '--json', '--pack-destination', artifactDirectory],
  { cwd: root, encoding: 'utf8' },
)
const [archive] = JSON.parse(packOutput)

assert.ok(archive, 'npm pack did not report an archive')
assert.equal(archive.filename, 'xleepy-wrist-menu-0.0.0.tgz')

const actualFiles = archive.files.map(({ path }) => path).sort()
assert.deepEqual(
  actualFiles,
  APPROVED_PACKAGE_FILES,
  `package archive contents changed:\n${actualFiles.join('\n')}`,
)

console.log(`verified ${archive.filename} (${actualFiles.length} files)`)
