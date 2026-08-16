import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { APPROVED_PACKAGE_FILES } from './approved-package-files.mjs'
import { sha256 } from './release-evidence-lib.mjs'
import { requireSafeRelativePath } from './safe-files.mjs'

const COMMIT = /^[a-f0-9]{40}$/

function requireSourceCommit(sourceCommit) {
  if (typeof sourceCommit !== 'string' || !COMMIT.test(sourceCommit)) {
    throw new TypeError('candidate source commit must be an exact lowercase identity')
  }
  return sourceCommit
}

export function rewriteCandidatePackageReadme(markdown, sourceCommit) {
  requireSourceCommit(sourceCommit)
  return markdown.replace(
    /\[([^\]]*)\]\(([^)]+)\)/gu,
    (link, label, untrimmedTarget) => {
      const target = untrimmedTarget.trim()
      if (/^(?:https?:|mailto:|#)/u.test(target)) return link
      const [path, ...fragmentParts] = target.split('#')
      const safePath = requireSafeRelativePath(
        decodeURIComponent(path),
        'candidate package README link',
      )
      const fragment =
        fragmentParts.length === 0 ? '' : `#${fragmentParts.join('#')}`
      return `[${label}](https://github.com/xleepy/wrist-menu/blob/${sourceCommit}/${encodeURI(safePath)}${fragment})`
    },
  )
}

async function stageCandidatePackage(root, destination, sourceCommit) {
  await mkdir(destination)
  for (const path of APPROVED_PACKAGE_FILES) {
    const source = resolve(root, ...path.split('/'))
    const target = resolve(destination, ...path.split('/'))
    await mkdir(dirname(target), { recursive: true })
    await cp(source, target)
  }
  const readmePath = resolve(destination, 'README.md')
  await writeFile(
    readmePath,
    rewriteCandidatePackageReadme(await readFile(readmePath, 'utf8'), sourceCommit),
  )
}

export async function packStagedCandidatePackage({
  root,
  sourceCommit,
  outputDirectory,
  npmCli = process.env.npm_execpath,
}) {
  requireSourceCommit(sourceCommit)
  if (typeof npmCli !== 'string' || npmCli.length === 0) {
    throw new Error('run staged candidate generation through npm')
  }
  await mkdir(outputDirectory, { recursive: true })
  const stagingRoot = await mkdtemp(join(tmpdir(), 'wrist-menu-staged-package-'))
  try {
    const packageInput = resolve(stagingRoot, 'package-input')
    await stageCandidatePackage(root, packageInput, sourceCommit)
    const packOutput = execFileSync(
      process.execPath,
      [npmCli, 'pack', '--json', '--pack-destination', outputDirectory],
      { cwd: packageInput, encoding: 'utf8' },
    )
    const [archive] = JSON.parse(packOutput)
    assert.ok(archive, 'npm pack did not report an archive')
    assert.deepEqual(
      archive.files.map(({ path }) => path).sort(),
      [...APPROVED_PACKAGE_FILES].sort(),
      'staged candidate package file list differs from the approved payload',
    )
    const candidatePath = resolve(outputDirectory, archive.filename)
    const bytes = await readFile(candidatePath)
    return {
      candidatePath,
      sha256: sha256(bytes),
      files: archive.files.map(({ path }) => path),
    }
  } finally {
    await rm(stagingRoot, { recursive: true, force: true })
  }
}
