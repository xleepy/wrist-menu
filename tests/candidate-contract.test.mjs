import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { APPROVED_PACKAGE_FILES } from '../scripts/approved-package-files.mjs'
import {
  createCandidateEvidenceIndex,
  verifyCandidateFileList,
} from '../scripts/candidate-package.mjs'

const PREDECESSOR_COMMIT = '6d57b41b3f28a981f2c88e9f7c3cd5dd0a8d7c91'

test('candidate documentation preserves exact failed predecessor evidence without promoting it', () => {
  const index = createCandidateEvidenceIndex({
    candidate: {
      package: '@xleepy/wrist-menu',
      version: '0.0.0',
      sha256: 'a'.repeat(64),
    },
    candidateSource: {
      commit: 'b'.repeat(40),
      worktreeClean: true,
    },
    predecessorRecord: {
      schemaVersion: 1,
      recordId: 'automated-release-d5827ff6fbbe7c67',
      result: 'failed',
      candidate: {
        package: '@xleepy/wrist-menu',
        version: '0.0.0',
        sha256: 'eef2c2de4a8c25a0226d5067a3735beeb177816c84a5265caf37a861adeff21d',
      },
      source: {
        commit: PREDECESSOR_COMMIT,
        exampleCommit: PREDECESSOR_COMMIT,
      },
      gates: [
        { id: 'core-behavior', status: 'passed' },
        { id: 'allocation', status: 'failed', detail: 'instrumentation unavailable' },
      ],
      validationCombinations: [],
    },
  })

  assert.deepEqual(index.candidate, {
    package: '@xleepy/wrist-menu',
    version: '0.0.0',
    sha256: 'a'.repeat(64),
    sourceCommit: 'b'.repeat(40),
    worktreeClean: true,
  })
  assert.deepEqual(index.exampleApp, {
    revision: PREDECESSOR_COMMIT,
    relation: 'exact-predecessor-evaluated-revision',
  })
  assert.equal(index.evidence.recordId, 'automated-release-d5827ff6fbbe7c67')
  assert.equal(index.evidence.result, 'failed')
  assert.equal(index.evidence.sourceCommit, PREDECESSOR_COMMIT)
  assert.equal(index.evidence.appliesToCandidate, false)
  assert.deepEqual(index.evidence.failedGates, [
    { id: 'allocation', detail: 'instrumentation unavailable' },
  ])
  assert.equal(index.compatibilityClaimsPromoted, false)
})

test('candidate extraction fails closed on missing or additional package files', () => {
  assert.doesNotThrow(() => verifyCandidateFileList(APPROVED_PACKAGE_FILES))
  assert.throws(
    () => verifyCandidateFileList([...APPROVED_PACKAGE_FILES, 'src/index.ts']),
    /candidate package file list differs from the approved payload/,
  )
  assert.throws(
    () => verifyCandidateFileList(APPROVED_PACKAGE_FILES.slice(1)),
    /candidate package file list differs from the approved payload/,
  )
})

test('versioned documentation covers the candidate contract and exact breaking migration', async () => {
  const [guide, migration, compatibility, release] = await Promise.all([
    readFile(new URL('../docs/0.0.0/index.md', import.meta.url), 'utf8'),
    readFile(new URL('../docs/0.0.0/migration.md', import.meta.url), 'utf8'),
    readFile(new URL('../docs/0.0.0/compatibility.md', import.meta.url), 'utf8'),
    readFile(new URL('../docs/0.0.0/release.md', import.meta.url), 'utf8'),
  ])

  for (const heading of [
    'Entry points',
    'Host Snapshots',
    'Behavior and integration',
    'Lifecycle',
    'Customization',
    'Accessibility',
    'Testing',
    'Security',
    'Troubleshooting',
  ]) {
    assert.match(guide, new RegExp(`^## ${heading}$`, 'm'))
  }

  for (const name of [
    'createWristMenuRuntimeState',
    'syncWristMenuRuntime',
    'stepWristMenuRuntime',
    'wristMenuRuntimeBlocksSceneInput',
    'disposeWristMenuRuntime',
    'createThreeWristMenuState',
    'state.presentation.group',
    'syncThreeWristMenu',
    'updateThreeWristMenu',
    'threeWristMenuBlocksSceneInput',
    'disposeThreeWristMenu',
  ]) {
    assert.ok(migration.includes(name), `migration is missing ${name}`)
  }
  assert.match(migration, /breaking/i)
  assert.match(migration, /no legacy aliases/i)
  assert.match(migration, /source of truth/i)
  assert.match(migration, /keep stable\s+function identity/i)

  assert.match(compatibility, new RegExp(PREDECESSOR_COMMIT, 'g'))
  assert.match(compatibility, /automated-release-d5827ff6fbbe7c67/)
  assert.match(
    compatibility,
    /\.\.\/evidence\/automated-release-d5827ff6fbbe7c67\/evidence-record\.json/,
  )
  assert.match(compatibility, /verdict is \*\*failed\*\*/)
  assert.match(compatibility, /68 instrumented property writes/)
  assert.match(compatibility, /promote no provisional device row/)
  assert.match(release, /documentation\.revision/)
  assert.match(release, /working-tree/)
  assert.match(release, /restore the local override/i)
})
