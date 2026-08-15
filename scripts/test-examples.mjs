import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const exampleDirectory = resolve(root, 'examples', 'primitive-workshop')
const npmCli = process.env.npm_execpath

assert.ok(npmCli, 'run Example Variant verification through npm')

execFileSync(
  process.execPath,
  [npmCli, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'],
  { cwd: exampleDirectory, stdio: 'inherit' },
)
execFileSync(process.execPath, [npmCli, 'run', 'build'], {
  cwd: exampleDirectory,
  stdio: 'inherit',
})
