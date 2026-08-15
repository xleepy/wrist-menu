import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import test from 'node:test'

import {
  canonicalJson,
  createRetainedReportManifest,
  publishImmutableEvidenceBundle,
  verifyImmutableEvidenceBundle,
} from '../scripts/release-evidence-lib.mjs'
import {
  finalizeCandidateUnavailableEvidence,
} from '../scripts/release-gate-evaluation.mjs'

const digest = (value) => createHash('sha256').update(value).digest('hex')

async function stageBundle(path) {
  await mkdir(resolve(path, 'raw'), { recursive: true })
  await writeFile(resolve(path, 'raw', 'report.json'), '{"status":"failed"}\n')
  const bundleManifest = await createRetainedReportManifest(path)
  const candidate = {
    package: '@xleepy/wrist-menu',
    version: '0.0.0',
    availability: 'unavailable',
  }
  const compatibility = { testedLanes: [{ id: 'core-import' }] }
  const input = {
    evidenceContext: {
      compatibility,
      candidate,
      source: {
        commit: 'b'.repeat(40),
        exampleCommit: 'b'.repeat(40),
        committedAt: '2026-08-08T00:00:00Z',
      },
      lockfiles: [{ path: 'package-lock.json', sha256: 'c'.repeat(64) }],
      protocol: { id: 'automated-release', version: 1, sha256: 'd'.repeat(64) },
      instrumentation: { id: 'test', version: 1, sha256: 'e'.repeat(64) },
    },
    bundleManifest,
    failure: {
      stage: 'build',
      command: 'npm run build',
      exitCode: 1,
      report: 'raw/report.json',
    },
  }
  const finalized = finalizeCandidateUnavailableEvidence(input)
  const record = canonicalJson(finalized.record)
  await writeFile(resolve(path, 'evidence-record.json'), record)
  await writeFile(
    resolve(path, 'compatibility.resolved.json'),
    canonicalJson(finalized.resolvedCompatibility),
  )
  await writeFile(
    resolve(path, 'evidence-record.sha256'),
    `${digest(record)}  evidence-record.json\n`,
  )
  return { bundleManifest, record }
}

test('an immutable evidence bundle reuses only an exact complete byte-for-byte match', async () => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), 'wrist-menu-evidence-'))
  const recordDirectory = resolve(temporaryRoot, 'record')
  try {
    const firstStage = resolve(temporaryRoot, 'stage-1')
    const { bundleManifest } = await stageBundle(firstStage)
    assert.deepEqual(bundleManifest.map(({ path, bytes }) => ({ path, bytes })), [
      { path: 'raw/report.json', bytes: 20 },
    ])
    assert.equal(
      await publishImmutableEvidenceBundle(firstStage, recordDirectory),
      'created',
    )
    await assert.doesNotReject(verifyImmutableEvidenceBundle(recordDirectory))

    const secondStage = resolve(temporaryRoot, 'stage-2')
    await stageBundle(secondStage)
    assert.equal(
      await publishImmutableEvidenceBundle(secondStage, recordDirectory),
      'reused',
    )

    const mutations = [
      ['evidence-record.json', 'mutated record\n'],
      ['compatibility.resolved.json', 'mutated resolved report\n'],
      ['evidence-record.sha256', `${'0'.repeat(64)}  evidence-record.json\n`],
      ['raw/report.json', 'mutated raw report\n'],
    ]
    for (const [relativePath, bytes] of mutations) {
      const original = await readFile(resolve(recordDirectory, relativePath))
      await writeFile(resolve(recordDirectory, relativePath), bytes)
      const stage = resolve(temporaryRoot, `stage-mutation-${relativePath.replaceAll('/', '-')}`)
      await stageBundle(stage)
      await assert.rejects(
        publishImmutableEvidenceBundle(stage, recordDirectory),
        /immutable Evidence Record identity collision/,
      )
      await writeFile(resolve(recordDirectory, relativePath), original)
    }

    for (const relativePath of [
      'evidence-record.json',
      'compatibility.resolved.json',
      'evidence-record.sha256',
      'raw/report.json',
    ]) {
      const original = await readFile(resolve(recordDirectory, relativePath))
      await rm(resolve(recordDirectory, relativePath))
      const stage = resolve(
        temporaryRoot,
        `stage-missing-${relativePath.replaceAll('/', '-')}`,
      )
      await stageBundle(stage)
      await assert.rejects(
        publishImmutableEvidenceBundle(stage, recordDirectory),
        /immutable Evidence Record identity collision/,
      )
      await writeFile(resolve(recordDirectory, relativePath), original)
    }

    await writeFile(resolve(recordDirectory, 'unexpected.txt'), 'extra\n')
    const extraStage = resolve(temporaryRoot, 'stage-extra')
    await stageBundle(extraStage)
    await assert.rejects(
      publishImmutableEvidenceBundle(extraStage, recordDirectory),
      /immutable Evidence Record identity collision/,
    )
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})

test('a staged bundle is rejected when its raw manifest is incomplete or its checksum is invalid', async () => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), 'wrist-menu-evidence-invalid-'))
  try {
    const incomplete = resolve(temporaryRoot, 'incomplete')
    await stageBundle(incomplete)
    const recordPath = resolve(incomplete, 'evidence-record.json')
    const record = JSON.parse(await readFile(recordPath, 'utf8'))
    record.bundleManifest = []
    const recordBytes = `${JSON.stringify(record, null, 2)}\n`
    await writeFile(recordPath, recordBytes)
    await writeFile(
      resolve(incomplete, 'evidence-record.sha256'),
      `${digest(recordBytes)}  evidence-record.json\n`,
    )
    await assert.rejects(
      publishImmutableEvidenceBundle(incomplete, resolve(temporaryRoot, 'final-incomplete')),
      /identity does not match|retained raw report manifest does not match/,
    )

    const badChecksum = resolve(temporaryRoot, 'bad-checksum')
    await stageBundle(badChecksum)
    await writeFile(
      resolve(badChecksum, 'evidence-record.sha256'),
      `${'0'.repeat(64)}  evidence-record.json\n`,
    )
    await assert.rejects(
      publishImmutableEvidenceBundle(badChecksum, resolve(temporaryRoot, 'final-bad-checksum')),
      /evidence-record checksum does not match/,
    )
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})
