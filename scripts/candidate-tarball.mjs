import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFile, readFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'

export async function digestNamedCandidate(root) {
  const packedPath = resolve(
    root,
    'artifacts',
    'xleepy-wrist-menu-0.0.0.tgz',
  )
  const bytes = await readFile(packedPath)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const candidatePath = resolve(
    dirname(packedPath),
    `xleepy-wrist-menu-0.0.0-${sha256}.tgz`,
  )
  await copyFile(packedPath, candidatePath)
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
