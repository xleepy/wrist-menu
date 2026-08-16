import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'

import { APPROVED_PACKAGE_FILES } from '../scripts/approved-package-files.mjs'
import {
  createCandidateEvidenceIndex,
  assertCandidateSourceUnchanged,
  buildCandidateBundle,
  captureCandidateSourceState,
  verifyCandidateBundleMarkdownLinks,
  verifyCandidateFileList,
} from '../scripts/candidate-package.mjs'
import { resolveCandidate } from '../scripts/candidate-tarball.mjs'
import {
  canonicalJson,
  createRetainedReportManifest,
  sha256,
} from '../scripts/release-evidence-lib.mjs'
import { finalizeAutomatedReleaseEvidence } from '../scripts/release-gate-evaluation.mjs'
import {
  packStagedCandidatePackage,
  rewriteCandidatePackageReadme,
} from '../scripts/staged-candidate.mjs'

const EVIDENCE_ID = 'automated-release-1111111111111111'
const npmCli = process.env.npm_execpath

test('candidate evidence index applies only to exact passing candidate bytes and source', () => {
  const candidateSha256 = 'a'.repeat(64)
  const sourceCommit = 'b'.repeat(40)
  const record = {
    schemaVersion: 1,
    kind: 'automated',
    recordId: EVIDENCE_ID,
    result: 'passed',
    candidate: {
      package: '@xleepy/wrist-menu',
      version: '0.0.0',
      sha256: candidateSha256,
    },
    source: {
      commit: sourceCommit,
      exampleCommit: sourceCommit,
    },
    gates: [
      { id: 'core-behavior', status: 'passed' },
      { id: 'allocation', status: 'passed' },
    ],
    validationCombinations: [],
  }

  const index = createCandidateEvidenceIndex({
    candidate: {
      package: '@xleepy/wrist-menu',
      version: '0.0.0',
      sha256: candidateSha256,
    },
    candidateSource: {
      commit: sourceCommit,
      worktreeClean: true,
    },
    evidenceRecord: record,
  })

  assert.deepEqual(index.candidate, {
    package: '@xleepy/wrist-menu',
    version: '0.0.0',
    sha256: candidateSha256,
    sourceCommit,
    worktreeClean: true,
  })
  assert.deepEqual(index.exampleApp, {
    revision: sourceCommit,
    relation: 'exact-evaluated-revision',
  })
  assert.equal(index.evidence.recordId, EVIDENCE_ID)
  assert.equal(index.evidence.result, 'passed')
  assert.equal(index.evidence.sourceCommit, sourceCommit)
  assert.equal(index.evidence.appliesToCandidate, true)
  assert.deepEqual(index.evidence.failedGates, [])
  assert.equal(index.compatibilityClaimsPromoted, false)

  assert.equal(
    createCandidateEvidenceIndex({
      candidate: {
        package: '@xleepy/wrist-menu',
        version: '0.0.0',
        sha256: 'c'.repeat(64),
      },
      candidateSource: {
        commit: sourceCommit,
        worktreeClean: true,
      },
      evidenceRecord: record,
    }).evidence.appliesToCandidate,
    false,
  )
  assert.equal(
    createCandidateEvidenceIndex({
      candidate: {
        package: '@xleepy/wrist-menu',
        version: '0.0.0',
        sha256: candidateSha256,
      },
      candidateSource: {
        commit: 'd'.repeat(40),
        worktreeClean: true,
      },
      evidenceRecord: record,
    }).evidence.appliesToCandidate,
    false,
  )
  assert.throws(
    () =>
      createCandidateEvidenceIndex({
        candidate: {
          package: '@xleepy/wrist-menu',
          version: '0.0.0',
          sha256: candidateSha256,
        },
        candidateSource: {
          commit: sourceCommit,
          worktreeClean: true,
        },
        evidenceRecord: { ...record, result: 'failed' },
      }),
    /candidate evidence must retain a passing result/,
  )
})

test('staged package README pins repository-relative links to the exact source commit', () => {
  const sourceCommit = 'a'.repeat(40)
  const rewritten = rewriteCandidatePackageReadme(
    '[guide](docs/0.0.0/index.md) [section](docs/0.0.0/index.md#entry-points) [web](https://example.com)\n',
    sourceCommit,
  )
  assert.match(
    rewritten,
    new RegExp(`https://github\\.com/xleepy/wrist-menu/blob/${sourceCommit}/docs/0\\.0\\.0/index\\.md`),
  )
  assert.match(rewritten, /index\.md#entry-points/)
  assert.match(rewritten, /\[web\]\(https:\/\/example\.com\)/)
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

test('configured candidate resolution fails closed unless path and digest agree', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'wrist-menu-candidate-config-'))
  try {
    const candidateFile = join(temporaryRoot, 'candidate.tgz')
    await writeFile(candidateFile, 'candidate bytes\n')
    const matchingSha256 = sha256(await readFile(candidateFile))

    await assert.rejects(
      () =>
        resolveCandidate(temporaryRoot, {
          WRIST_MENU_CANDIDATE_PATH: 'candidate.tgz',
        }),
      /WRIST_MENU_CANDIDATE_PATH requires a sha256 WRIST_MENU_CANDIDATE_SHA256/,
    )
    await assert.rejects(
      () =>
        resolveCandidate(temporaryRoot, {
          WRIST_MENU_CANDIDATE_SHA256: matchingSha256,
        }),
      /WRIST_MENU_CANDIDATE_SHA256 requires WRIST_MENU_CANDIDATE_PATH/,
    )
    await assert.rejects(
      () =>
        resolveCandidate(temporaryRoot, {
          WRIST_MENU_CANDIDATE_PATH: 'candidate.tgz',
          WRIST_MENU_CANDIDATE_SHA256: 'not-a-digest',
        }),
      /WRIST_MENU_CANDIDATE_PATH requires a sha256 WRIST_MENU_CANDIDATE_SHA256/,
    )
    await assert.rejects(
      () =>
        resolveCandidate(temporaryRoot, {
          WRIST_MENU_CANDIDATE_PATH: 'candidate.tgz',
          WRIST_MENU_CANDIDATE_SHA256: '0'.repeat(64),
        }),
      /configured candidate bytes differ from WRIST_MENU_CANDIDATE_SHA256/,
    )

    const resolved = await resolveCandidate(temporaryRoot, {
      WRIST_MENU_CANDIDATE_PATH: 'candidate.tgz',
      WRIST_MENU_CANDIDATE_SHA256: matchingSha256,
    })
    assert.equal(resolved.candidatePath, candidateFile)
    assert.equal(resolved.sha256, matchingSha256)
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})

async function createCandidateSourceRepository(repository) {
  const git = (args) =>
    execFileSync('git', args, { cwd: repository, encoding: 'utf8' })
  const write = async (path, bytes) => {
    const file = join(repository, ...path.split('/'))
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, bytes)
  }
  for (const path of APPROVED_PACKAGE_FILES) {
    await write(path, `// ${path}\n`)
  }
  await write(
    'package.json',
    `${JSON.stringify({ name: '@xleepy/wrist-menu', version: '0.0.0', type: 'module' }, null, 2)}\n`,
  )
  await write('README.md', '# fixture candidate\n')
  await write('docs/0.0.0/index.md', '# fixture docs\n')
  await write('docs/validation-gates.md', '# fixture gates\n')
  await write('docs/release-evidence.md', '# fixture evidence\n')
  await write('fixtures/candidate-docs/README.md', '# fixture consumer\n')
  git(['init', '--quiet'])
  git(['config', 'user.name', 'Candidate Test'])
  git(['config', 'user.email', 'candidate@example.invalid'])
  git(['add', '.'])
  git(['commit', '--quiet', '-m', 'fixture'])
  return git(['rev-parse', 'HEAD']).trim()
}

async function createAutomatedEvidenceBundle(
  bundleDirectory,
  { sourceCommit, candidateSha256, gateStatus = 'passed' },
) {
  await mkdir(resolve(bundleDirectory, 'raw'), { recursive: true })
  await writeFile(
    resolve(bundleDirectory, 'raw', 'report.json'),
    `{"status":"${gateStatus}"}\n`,
  )
  const bundleManifest = await createRetainedReportManifest(bundleDirectory)
  const evaluation = {
    evidenceContext: {
      compatibility: { testedLanes: [{ id: 'core-import' }] },
      protocol: {
        id: 'automated-release',
        version: 1,
        sha256: 'd'.repeat(64),
        requiredGateIds: ['core-import'],
      },
      candidate: {
        package: '@xleepy/wrist-menu',
        version: '0.0.0',
        sha256: candidateSha256,
      },
      source: {
        commit: sourceCommit,
        exampleCommit: sourceCommit,
        committedAt: '2026-08-16T00:00:00Z',
      },
      lockfiles: [],
      instrumentation: { id: 'test', version: 1, sha256: 'e'.repeat(64) },
    },
    testedLanes: ['core-import'],
    laneStates: { 'core-import': gateStatus === 'passed' },
    gates: [{ id: 'core-import', status: gateStatus, report: 'raw/report.json' }],
  }
  const finalized = finalizeAutomatedReleaseEvidence(evaluation, { bundleManifest })
  const recordBytes = canonicalJson(finalized.record)
  await writeFile(resolve(bundleDirectory, 'evidence-record.json'), recordBytes)
  await writeFile(
    resolve(bundleDirectory, 'compatibility.resolved.json'),
    canonicalJson(finalized.resolvedCompatibility),
  )
  await writeFile(
    resolve(bundleDirectory, 'evidence-record.sha256'),
    `${sha256(recordBytes)}  evidence-record.json\n`,
  )
  return finalized.record
}

test(
  'candidate generation enforces the exact evidence handshake fail-closed',
  { skip: npmCli === undefined ? 'run through npm' : false },
  async (t) => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'wrist-menu-handshake-'))
    try {
      const repository = resolve(temporaryRoot, 'repository')
      await mkdir(repository, { recursive: true })
      const sourceCommit = await createCandidateSourceRepository(repository)
      const build = (evidenceBundleDirectory, outputName) =>
        buildCandidateBundle({
          root: repository,
          evidenceBundleDirectory,
          outputRoot: resolve(temporaryRoot, outputName),
          npmCli,
        })

      await t.test('rejects evidence from a different source revision', async () => {
        const bundle = resolve(temporaryRoot, 'evidence-foreign-source')
        await createAutomatedEvidenceBundle(bundle, {
          sourceCommit: 'f'.repeat(40),
          candidateSha256: '0'.repeat(64),
        })
        await assert.rejects(
          () => build(bundle, 'candidates-foreign-source'),
          /Evidence Record source revision does not match the candidate source commit/,
        )
      })

      await t.test('rejects a failed Evidence Record', async () => {
        const bundle = resolve(temporaryRoot, 'evidence-failed')
        await createAutomatedEvidenceBundle(bundle, {
          sourceCommit,
          candidateSha256: '0'.repeat(64),
          gateStatus: 'failed',
        })
        await assert.rejects(
          () => build(bundle, 'candidates-failed'),
          /candidate evidence must retain a passing result/,
        )
      })

      await t.test('rejects evidence for different candidate bytes', async () => {
        const bundle = resolve(temporaryRoot, 'evidence-foreign-digest')
        await createAutomatedEvidenceBundle(bundle, {
          sourceCommit,
          candidateSha256: '0'.repeat(64),
        })
        await assert.rejects(
          () => build(bundle, 'candidates-foreign-digest'),
          /Evidence Record candidate digest does not match the exact staged candidate bytes/,
        )
      })

      await t.test('accepts the exact staged candidate and reports appliesToCandidate', async () => {
        const packed = await packStagedCandidatePackage({
          root: repository,
          sourceCommit,
          outputDirectory: resolve(temporaryRoot, 'pre-pack'),
          npmCli,
        })
        const bundle = resolve(temporaryRoot, 'evidence-exact')
        const record = await createAutomatedEvidenceBundle(bundle, {
          sourceCommit,
          candidateSha256: packed.sha256,
        })
        const { bundleDirectory, candidate } = await build(bundle, 'candidates-exact')
        assert.equal(candidate.package.sha256, packed.sha256)
        assert.equal(candidate.evidence.recordId, record.recordId)
        assert.equal(candidate.evidence.result, 'passed')
        assert.equal(candidate.evidence.appliesToCandidate, true)
        const evidenceIndex = JSON.parse(
          await readFile(
            resolve(bundleDirectory, 'documentation', 'evidence-index.json'),
            'utf8',
          ),
        )
        assert.equal(evidenceIndex.evidence.appliesToCandidate, true)
        assert.equal(evidenceIndex.compatibilityClaimsPromoted, false)
      })
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true })
    }
  },
)

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

  assert.match(compatibility, /evidence-index\.json/)
  assert.match(compatibility, /appliesToCandidate: true/)
  assert.match(compatibility, /digest or source\s+mismatch fails closed/i)
  assert.match(compatibility, /promotes no physical Validation Combination/i)
  assert.match(release, /documentation\.revision/)
  assert.match(release, /working-tree/)
  assert.match(release, /same staging function/i)
  assert.match(release, /exact publication-staged npm archive/i)
  assert.match(release, /appliesToCandidate: true/)
  assert.match(release, /restore the local override/i)
})
