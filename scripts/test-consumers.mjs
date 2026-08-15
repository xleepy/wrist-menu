import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  installPackedCandidate,
  resolveCandidate,
} from './candidate-tarball.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const npmCli = process.env.npm_execpath
const fixtures = ['three', 'react-18', 'react-19']

assert.ok(npmCli, 'run consumer verification through npm')
const candidate = await resolveCandidate(root)

const installFrozen = async (fixtureDirectory) => {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      execFileSync(
        process.execPath,
        [npmCli, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'],
        { cwd: fixtureDirectory, stdio: 'inherit' },
      )
      return
    } catch (error) {
      if (attempt === 3) {
        throw error
      }

      console.warn(`frozen install attempt ${attempt} failed; retrying`)
      await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 250))
    }
  }
}

for (const fixture of fixtures) {
  const fixtureDirectory = resolve(root, 'fixtures', 'consumers', fixture)
  console.log(`checking ${fixture} consumer`)
  await installFrozen(fixtureDirectory)
  installPackedCandidate({
    npmCli,
    directory: fixtureDirectory,
    candidatePath: candidate.candidatePath,
  })
  execFileSync(process.execPath, [npmCli, 'test'], {
    cwd: fixtureDirectory,
    stdio: 'inherit',
    env: {
      ...process.env,
      WRIST_MENU_CANDIDATE_SHA256: candidate.sha256,
    },
  })
}
