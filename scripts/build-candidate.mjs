import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildCandidateBundle } from './candidate-package.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const evidenceFlag = process.argv.indexOf('--evidence-bundle')
const evidenceBundleDirectory =
  evidenceFlag < 0 ? undefined : process.argv[evidenceFlag + 1]

assert.ok(
  evidenceBundleDirectory,
  'usage: npm run candidate:build -- --evidence-bundle <immutable-record-directory>',
)

const result = await buildCandidateBundle({
  root,
  evidenceBundleDirectory: resolve(evidenceBundleDirectory),
})

console.log(`candidate bundle: ${result.candidate.bundleId}`)
console.log(`candidate package sha256: ${result.candidate.package.sha256}`)
console.log(`candidate source state: ${result.candidate.documentation.state}`)
console.log(`candidate evidence result: ${result.candidate.evidence.result}`)
console.log(`candidate directory: ${result.bundleDirectory}`)
