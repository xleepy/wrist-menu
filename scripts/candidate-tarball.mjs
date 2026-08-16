import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFile, readFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'

import { sha256 } from './release-evidence-lib.mjs'

const SHA256 = /^[a-f0-9]{64}$/

export async function digestNamedCandidate(root) {
  const packedPath = resolve(
    root,
    'artifacts',
    'xleepy-wrist-menu-0.0.0.tgz',
  )
  const bytes = await readFile(packedPath)
  const candidateSha256 = sha256(bytes)
  const candidatePath = resolve(
    dirname(packedPath),
    `xleepy-wrist-menu-0.0.0-${candidateSha256}.tgz`,
  )
  await copyFile(packedPath, candidatePath)
  return { candidatePath, sha256: candidateSha256 }
}

export async function resolveCandidate(root, environment = process.env) {
  const configuredPath = environment.WRIST_MENU_CANDIDATE_PATH
  const expectedSha256 = environment.WRIST_MENU_CANDIDATE_SHA256
  if (configuredPath === undefined || configuredPath === '') {
    assert.ok(
      expectedSha256 === undefined || expectedSha256 === '',
      'WRIST_MENU_CANDIDATE_SHA256 requires WRIST_MENU_CANDIDATE_PATH',
    )
    return digestNamedCandidate(root)
  }

  assert.match(
    expectedSha256 ?? '',
    SHA256,
    'WRIST_MENU_CANDIDATE_PATH requires a sha256 WRIST_MENU_CANDIDATE_SHA256',
  )
  const candidatePath = resolve(root, configuredPath)
  const actualSha256 = sha256(await readFile(candidatePath))
  assert.equal(
    actualSha256,
    expectedSha256,
    'configured candidate bytes differ from WRIST_MENU_CANDIDATE_SHA256',
  )
  return { candidatePath, sha256: actualSha256 }
}

export function installPackedCandidate({ npmCli, directory, candidatePath }) {
  execFileSync(
    process.execPath,
    [
      npmCli,
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--no-save',
      '--package-lock=false',
      candidatePath,
    ],
    { cwd: directory, stdio: 'inherit' },
  )
  console.log(`installed exact candidate ${basename(candidatePath)}`)
}
