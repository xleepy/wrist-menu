import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import { APPROVED_PACKAGE_FILES } from '../scripts/approved-package-files.mjs'
import {
  createCandidateEvidenceIndex,
  assertCandidateSourceUnchanged,
  captureCandidateSourceState,
  verifyCandidateBundleMarkdownLinks,
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

test('candidate source guard detects concurrent changes even when status paths stay the same', async () => {
  const repository = await mkdtemp(join(tmpdir(), 'wrist-menu-source-guard-'))
  const git = (args) => execFileSync('git', args, { cwd: repository })
  try {
    git(['init', '--quiet'])
    git(['config', 'user.name', 'Candidate Test'])
    git(['config', 'user.email', 'candidate@example.invalid'])
    await writeFile(join(repository, 'tracked.txt'), 'committed\n')
    git(['add', 'tracked.txt'])
    git(['commit', '--quiet', '-m', 'fixture'])

    await writeFile(join(repository, 'tracked.txt'), 'dirty one\n')
    const before = await captureCandidateSourceState(repository)
    await writeFile(join(repository, 'tracked.txt'), 'dirty two\n')
    const after = await captureCandidateSourceState(repository)

    assert.equal(before.clean, false)
    assert.equal(after.clean, false)
    assert.equal(before.statusSha256, after.statusSha256)
    assert.throws(
      () => assertCandidateSourceUnchanged(before, after),
      /candidate source changed while the bundle was staged/,
    )
  } finally {
    await rm(repository, { recursive: true, force: true })
  }
})

test('candidate bundle rejects broken links from every Markdown subtree', async () => {
  const bundle = await mkdtemp(join(tmpdir(), 'wrist-menu-markdown-links-'))
  const documents = [
    'package/README.md',
    'documentation/validation-gates.md',
    'fixtures/candidate-docs/README.md',
    'documentation/evidence/record/README.md',
  ]
  try {
    for (const path of documents) {
      const document = join(bundle, ...path.split('/'))
      await mkdir(dirname(document), { recursive: true })
      await writeFile(join(dirname(document), 'target.txt'), 'target\n')
      await writeFile(document, '[target](target.txt)\n')
    }
    await assert.doesNotReject(() => verifyCandidateBundleMarkdownLinks(bundle))

    for (const path of documents) {
      const document = join(bundle, ...path.split('/'))
      await writeFile(document, '[missing](missing.txt)\n')
      await assert.rejects(
        () => verifyCandidateBundleMarkdownLinks(bundle),
        new RegExp(`Markdown link target is missing: ${path.replace('.', '\\.')}`),
      )
      await writeFile(document, '[target](target.txt)\n')
    }

    const packageReadme = join(bundle, 'package', 'README.md')
    for (const target of [
      '../../../../outside.md',
      '/absolute.md',
      'C:/windows.md',
      '..%5C..%5Coutside.md',
    ]) {
      await writeFile(packageReadme, `[unsafe](${target})\n`)
      await assert.rejects(
        () => verifyCandidateBundleMarkdownLinks(bundle),
        /Markdown link target (?:is unsafe|escapes the bundle)/,
      )
    }

    await writeFile(packageReadme, '[target](target.txt "title")\n')
    await assert.doesNotReject(() => verifyCandidateBundleMarkdownLinks(bundle))
    await writeFile(packageReadme, '[missing][target]\n\n[target]: missing.txt\n')
    await assert.rejects(
      () => verifyCandidateBundleMarkdownLinks(bundle),
      /Markdown link target is missing: package\/README\.md -> missing\.txt/,
    )
  } finally {
    await rm(bundle, { recursive: true, force: true })
  }
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
  assert.doesNotMatch(guide, /`reducedMotion`/)
  assert.doesNotMatch(guide, /default theme targets 4\.5:1/i)
  assert.doesNotMatch(guide, /default.*non-color cues/i)
  assert.match(guide, /default Command slab does not render those labels/i)
  assert.match(guide, /color and material changes only/i)
  assert.match(guide, /no public reduced-motion override/i)
  assert.match(guide, /clear transient interaction and Scene Input Claims immediately/i)
  assert.match(guide, /sample-driven[\s\S]*next\s+Frame Sample/i)

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
