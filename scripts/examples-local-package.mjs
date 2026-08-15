import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const operation = process.argv[2]
assert.ok(
  operation === 'link' || operation === 'unlink',
  'usage: node scripts/examples-local-package.mjs <link|unlink>',
)

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const exampleDirectory = resolve(root, 'examples', 'primitive-workshop')
const archive = resolve(root, 'artifacts', 'xleepy-wrist-menu-0.0.0.tgz')
const npmCli = process.env.npm_execpath
assert.ok(npmCli, 'run the local Example App workflow through npm')

function npm(args, cwd = root) {
  execFileSync(process.execPath, [npmCli, ...args], { cwd, stdio: 'inherit' })
}

if (operation === 'link') {
  npm(['run', 'clean'])
  npm(['run', 'build'])
  npm(['run', 'build:declarations'])
  npm(['run', 'pack:verify'])
  npm(
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--no-save',
      '--package-lock=false',
      archive,
    ],
    exampleDirectory,
  )
} else {
  npm(
    ['ci', '--ignore-scripts', '--no-audit', '--no-fund'],
    exampleDirectory,
  )
}

npm(['run', 'build'], exampleDirectory)
