import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  installPackedCandidate,
  resolveCandidate,
} from './candidate-tarball.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const exampleDirectory = resolve(root, 'examples', 'primitive-workshop')
const npmCli = process.env.npm_execpath

assert.ok(npmCli, 'run Example Variant verification through npm')
const candidate = await resolveCandidate(root)

execFileSync(
  process.execPath,
  [npmCli, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'],
  { cwd: exampleDirectory, stdio: 'inherit' },
)
installPackedCandidate({
  npmCli,
  directory: exampleDirectory,
  candidatePath: candidate.candidatePath,
})
execFileSync(process.execPath, [npmCli, 'run', 'build'], {
  cwd: exampleDirectory,
  stdio: 'inherit',
})

for (const path of ['index.html', 'vanilla/index.html', 'react/index.html']) {
  const html = readFileSync(resolve(exampleDirectory, 'dist', path), 'utf8')
  assert.match(html, /Primitive Workshop/)
}
const chooser = readFileSync(
  resolve(exampleDirectory, 'dist', 'index.html'),
  'utf8',
)
assert.match(chooser, /href="\.\/vanilla\/"/)
assert.match(chooser, /href="\.\/react\/"/)
assert.match(chooser, /target\.search = location\.search/)
