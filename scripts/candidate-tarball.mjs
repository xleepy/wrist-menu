import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFile, readFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'

const SHA256 = /^[a-f0-9]{64}$/

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

export async function digestNamedCandidate(root) {
  const packedPath = resolve(
    root,
    'artifacts',
    'xleepy-wrist-menu-0.0.0.tgz',
  )
  const bytes = await readFile(packedPath)
  const sha256 = digest(bytes)
  const candidatePath = resolve(
    dirname(packedPath),
    `xleepy-wrist-menu-0.0.0-${sha256}.tgz`,
  )
  await copyFile(packedPath, candidatePath)
  return { candidatePath, sha256 }
}

export async function resolveCandidate(root, environment = process.env) {
  const configuredPath = environment.WRIST_MENU_CANDIDATE_PATH
  if (configuredPath === undefined || configuredPath === '') {
    return digestNamedCandidate(root)
  }

  const candidatePath = resolve(root, configuredPath)
  const sha256 = digest(await readFile(candidatePath))
  const expectedSha256 = environment.WRIST_MENU_CANDIDATE_SHA256
  if (expectedSha256 !== undefined && expectedSha256 !== '') {
    assert.match(expectedSha256, SHA256, 'configured candidate digest must be sha256')
    assert.equal(
      sha256,
      expectedSha256,
      'configured candidate bytes differ from WRIST_MENU_CANDIDATE_SHA256',
    )
  }
  return { candidatePath, sha256 }
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
