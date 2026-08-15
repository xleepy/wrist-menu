import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  buildAutomatedEvidenceRecord,
  buildCandidateUnavailableEvidenceRecord,
  consumerLanePassed,
  evidenceInvalidationReasons,
  validateCompatibilityManifest,
} from '../scripts/release-evidence-lib.mjs'
import {
  finalizeAutomatedReleaseEvidence,
} from '../scripts/release-gate-evaluation.mjs'
import {
  evaluatePerformanceBaselineGate,
  evaluatePerformanceVariant,
  performanceBaselinePhases,
  performanceBaselinePrerequisites,
  performanceBaselineVariants,
  performanceBaselineVariantIds,
} from '../fixtures/consumers/performance-baseline.mjs'
import {
  installReactStateSetterProbe,
  instrumentUniqueAddedFrameSubscription,
} from '../fixtures/consumers/react-renderer-harness.mjs'

const readJson = async (path) =>
  JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'))

test('the compatibility manifest separates policy, exact lanes, claims, and physical provisional rows', async () => {
  const manifest = await readJson('../compatibility.json')

  assert.doesNotThrow(() => validateCompatibilityManifest(manifest))
  assert.equal(manifest.schemaVersion, 2)
  assert.deepEqual(Object.keys(manifest.declaredPeers).sort(), [
    '@react-three/fiber',
    'react',
    'three',
  ])
  assert.deepEqual(
    manifest.testedLanes.map(({ id }) => id),
    [
      'core-import',
      'three-0.185.1',
      'react-18.3.1-r3f-8.18.0',
      'react-19.2.7-r3f-9.6.1',
      'react-xr-6.6.30',
      'iwer-vanilla-hand',
      'iwer-vanilla-controller',
      'iwer-react-hand',
      'iwer-react-controller',
    ],
  )
  assert.deepEqual(manifest.verifiedClaims, [])
  assert.ok(manifest.provisionalRows.length > 0)
  assert.ok(
    manifest.provisionalRows.every(
      ({ status, evidenceRecords }) =>
        status === 'provisional' && evidenceRecords.length === 0,
    ),
  )
  assert.deepEqual(manifest.invalidatedEvidence, [])
})

test('an automated Evidence Record is reproducible and fails closed', () => {
  const input = {
    candidate: {
      package: '@xleepy/wrist-menu',
      version: '0.0.0',
      tarball: 'artifacts/xleepy-wrist-menu-0.0.0.tgz',
      sha256: 'a'.repeat(64),
    },
    source: {
      commit: 'b'.repeat(40),
      exampleCommit: 'b'.repeat(40),
      committedAt: '2026-08-08T00:00:00Z',
    },
    lockfiles: [
      { path: 'package-lock.json', sha256: 'c'.repeat(64) },
      {
        path: 'examples/primitive-workshop/package-lock.json',
        sha256: 'd'.repeat(64),
      },
    ],
    protocol: { id: 'automated-release', version: 1, sha256: 'e'.repeat(64) },
    instrumentation: {
      id: 'node-iwer-three-counters',
      version: 1,
      node: 'v22.0.0',
      platform: 'win32-x64',
    },
    rawReportDirectory: `artifacts/release-evidence/${'a'.repeat(64)}/raw`,
    requiredGateIds: ['deterministic-boundaries', 'import-safety'],
    gates: [
      { id: 'deterministic-boundaries', status: 'passed', report: 'raw/a.json' },
      { id: 'import-safety', status: 'passed', report: 'raw/b.json' },
    ],
    testedLanes: ['core-import'],
    validationCombinations: [],
    resolvedCompatibilitySha256: '3'.repeat(64),
    bundleManifest: [
      { path: 'raw/a.json', bytes: 2, sha256: 'f'.repeat(64) },
      { path: 'raw/b.json', bytes: 2, sha256: '1'.repeat(64) },
      { path: 'raw/command.json', bytes: 2, sha256: '2'.repeat(64) },
    ],
  }

  const first = buildAutomatedEvidenceRecord(input)
  const second = buildAutomatedEvidenceRecord(structuredClone(input))
  assert.deepEqual(first, second)
  assert.equal(first.result, 'passed')
  assert.match(first.recordId, /^automated-release-[a-f0-9]{16}$/)
  assert.ok(Object.isFrozen(first))

  const finalized = finalizeAutomatedReleaseEvidence({
    evidenceContext: {
      compatibility: { testedLanes: [{ id: 'core-import' }] },
      protocol: { ...input.protocol, requiredGateIds: input.requiredGateIds },
      candidate: input.candidate,
      source: input.source,
      lockfiles: input.lockfiles,
      instrumentation: input.instrumentation,
    },
    testedLanes: input.testedLanes,
    laneStates: { 'core-import': true },
    gates: input.gates,
  }, { bundleManifest: input.bundleManifest })
  assert.equal(finalized.record.result, 'passed')
  assert.ok(Object.isFrozen(finalized.record))
  assert.equal(finalized.resolvedCompatibility.testedLanes[0].status, 'passed')
  assert.deepEqual(
    finalized.resolvedCompatibility.testedLanes[0].evidenceRecords,
    [`${finalized.recordDirectory}/evidence-record.json`],
  )

  for (const changed of [
    { testedLanes: ['core-import', 'three-0.185.1'] },
    { validationCombinations: ['quest-3-react-hand-left-90hz'] },
    {
      bundleManifest: input.bundleManifest.map((file, index) =>
        index === 2 ? { ...file, sha256: '3'.repeat(64) } : file,
      ),
    },
    { resolvedCompatibilitySha256: '4'.repeat(64) },
  ]) {
    assert.notEqual(
      buildAutomatedEvidenceRecord({ ...input, ...changed }).recordId,
      first.recordId,
    )
  }

  assert.throws(
    () =>
      buildAutomatedEvidenceRecord({
        ...input,
        bundleManifest: [
          ...input.bundleManifest,
          { path: 'evidence-record.json', bytes: 2, sha256: '4'.repeat(64) },
        ],
      }),
    /must contain only retained raw reports/,
  )

  assert.throws(
    () =>
      buildAutomatedEvidenceRecord({
        ...input,
        gates: input.gates.slice(0, 1),
      }),
    /missing required Release Gate: import-safety/,
  )
  assert.throws(
    () =>
      buildAutomatedEvidenceRecord({
        ...input,
        gates: [input.gates[0], input.gates[0]],
      }),
    /duplicate Release Gate/,
  )
  assert.throws(
    () =>
      buildAutomatedEvidenceRecord({
        ...input,
        gates: input.gates.map((gate) => ({ ...gate, status: 'unknown' })),
      }),
    /invalid Release Gate status/,
  )
  assert.equal(
    buildAutomatedEvidenceRecord({
      ...input,
      gates: input.gates.map((gate) =>
        gate.id === 'import-safety' ? { ...gate, status: 'failed' } : gate,
      ),
    }).result,
    'failed',
  )
})

test('a packed consumer lane fails when its enclosing subprocess fails', () => {
  const report = {
    status: 'passed',
    candidateSha256: 'a'.repeat(64),
    testedLanes: ['three-0.185.1'],
  }

  assert.equal(
    consumerLanePassed({ status: 'failed' }, report, 'three-0.185.1', 'a'.repeat(64)),
    false,
  )
  assert.equal(
    consumerLanePassed({ status: 'passed' }, report, 'three-0.185.1', 'a'.repeat(64)),
    true,
  )
})

test('a prerequisite failure has immutable candidate-unavailable identity without an invented digest', () => {
  const input = {
    candidate: {
      package: '@xleepy/wrist-menu',
      version: '0.0.0',
      availability: 'unavailable',
    },
    source: {
      commit: 'b'.repeat(40),
      exampleCommit: 'b'.repeat(40),
      committedAt: '2026-08-08T00:00:00Z',
    },
    lockfiles: [{ path: 'package-lock.json', sha256: 'c'.repeat(64) }],
    protocol: { id: 'automated-release', version: 1, sha256: 'd'.repeat(64) },
    instrumentation: {
      id: 'node-iwer-three-counters',
      version: 1,
      sha256: 'e'.repeat(64),
    },
    testedLanes: ['core-import'],
    validationCombinations: [],
    resolvedCompatibilitySha256: '2'.repeat(64),
    bundleManifest: [
      { path: 'raw/prerequisite-2.json', bytes: 42, sha256: 'f'.repeat(64) },
    ],
    rawReportDirectory: 'RAW_DIRECTORY_PLACEHOLDER',
    failure: {
      stage: 'build',
      command: 'npm run build',
      exitCode: 1,
      report: 'raw/prerequisite-2.json',
    },
  }

  const first = buildCandidateUnavailableEvidenceRecord(input)
  const second = buildCandidateUnavailableEvidenceRecord(structuredClone(input))
  assert.deepEqual(first, second)
  assert.equal(first.result, 'failed')
  assert.equal(first.kind, 'candidate-unavailable')
  assert.equal('sha256' in first.candidate, false)
  assert.match(first.recordId, /^candidate-unavailable-[a-f0-9]{16}$/)
  assert.ok(Object.isFrozen(first))
  assert.notEqual(
    buildCandidateUnavailableEvidenceRecord({
      ...input,
      bundleManifest: [{ ...input.bundleManifest[0], sha256: '1'.repeat(64) }],
    }).recordId,
    first.recordId,
  )
  assert.throws(
    () =>
      buildCandidateUnavailableEvidenceRecord({
        ...input,
        candidate: { ...input.candidate, sha256: '0'.repeat(64) },
      }),
    /must not invent a digest/,
  )
})

test('candidate, source, lockfile, protocol, and instrumentation changes invalidate evidence', () => {
  const recordIdentity = {
    candidateSha256: 'a'.repeat(64),
    sourceCommit: 'b'.repeat(40),
    exampleCommit: 'b'.repeat(40),
    lockfileSha256: 'c'.repeat(64),
    protocolSha256: 'd'.repeat(64),
    instrumentationVersion: 1,
    instrumentationSha256: 'e'.repeat(64),
    deviceOsBuild: 'os-1',
    browserBuild: 'browser-1',
  }

  assert.deepEqual(evidenceInvalidationReasons(recordIdentity, recordIdentity), [])
  assert.deepEqual(
    evidenceInvalidationReasons(recordIdentity, {
      candidateSha256: 'e'.repeat(64),
      sourceCommit: 'f'.repeat(40),
      exampleCommit: 'f'.repeat(40),
      lockfileSha256: '1'.repeat(64),
      protocolSha256: '2'.repeat(64),
      instrumentationVersion: 2,
      instrumentationSha256: '3'.repeat(64),
      deviceOsBuild: 'os-2',
      browserBuild: 'browser-2',
    }),
    [
      'candidate-digest-changed',
      'source-commit-changed',
      'example-commit-changed',
      'lockfile-changed',
      'protocol-changed',
      'instrumentation-changed',
      'device-os-build-changed',
      'browser-build-changed',
    ],
  )
})

test('the automated protocol names every threshold triplet and fail-closed gate', async () => {
  const protocol = await readJson('../evidence/protocols/automated-v1.json')
  const baselines = await readJson('../evidence/baselines/performance-v1.json')

  for (const boundary of [
    'enter-angle-35-degrees',
    'exit-angle-50-degrees',
    'initial-dwell-300-ms',
    'reacquire-dwell-200-ms',
    'tracking-grace-250-ms',
    'transition-150-ms',
    'hand-scroll-9-mm',
    'controller-scroll-13-mm',
  ]) {
    assert.deepEqual(
      protocol.deterministicTraces
        .filter(({ boundary: candidate }) => candidate === boundary)
        .map(({ position }) => position),
      ['below', 'at', 'above'],
    )
  }
  assert.deepEqual(protocol.frameSchedules, ['60hz', '72hz', '90hz', '120hz', 'irregular'])
  for (const gate of [
    'import-safety',
    'allocation',
    'identical-frame-mutation',
    'resource-growth',
    'lifecycle-leak',
    'scene-event-shield',
    'performance-baseline',
  ]) {
    assert.ok(protocol.requiredGateIds.includes(gate), gate)
  }
  assert.deepEqual(
    Object.keys(baselines.variants),
    performanceBaselineVariantIds,
  )
  for (const variant of performanceBaselineVariantIds) {
    assert.deepEqual(Object.keys(baselines.variants[variant]), [
      'hidden',
      'visibleIdle',
      'activeScroll',
    ])
  }
})

test('the performance baseline gate fails closed on missing, exceeded, or React-updating measurements', async () => {
  const baselines = await readJson('../evidence/baselines/performance-v1.json')
  const laneId = 'react-18.3.1-r3f-8.18.0'
  const variant = performanceBaselineVariants.find(({ id }) => id === laneId)
  const measurement = (phase) => ({
    workload: phase,
    frameSamples: 10_000,
    drawCalls: 0,
    triangles: 0,
    lines: 0,
    geometries: 0,
    textures: 0,
    programs: 0,
    atlasUploads: 0,
    packageUpdateP95Ms: 0,
    packageUpdateSamplesMs: Array.from({ length: 10_000 }, () => 0),
    reactStateSetterCalls: 0,
    reactCommits: 0,
    reactStateSettersInstrumented: 2,
  })
  const measurements = Object.fromEntries(
    performanceBaselinePhases.map((phase) => [phase, measurement(phase)]),
  )

  assert.equal(
    evaluatePerformanceVariant(
      variant,
      measurements,
      baselines.variants[laneId],
    ).status,
    'passed',
  )

  for (const mutate of [
    (candidate) => { delete candidate.visibleIdle.triangles },
    (candidate) => {
      candidate.visibleIdle.drawCalls =
        baselines.variants[laneId].visibleIdle.drawCallsMax + 1
    },
    (candidate) => { candidate.activeScroll.reactStateSetterCalls = 1 },
    (candidate) => { candidate.hidden.reactCommits = 1 },
    (candidate) => { candidate.hidden.reactStateSettersInstrumented = 0 },
    (candidate) => { candidate.visibleIdle.packageUpdateSamplesMs.pop() },
    (candidate) => { candidate.hidden.frameSamples = 9_999 },
  ]) {
    const candidate = structuredClone(measurements)
    mutate(candidate)
    assert.equal(
      evaluatePerformanceVariant(
        variant,
        candidate,
        baselines.variants[laneId],
      ).status,
      'failed',
    )
  }

  assert.equal(
    evaluatePerformanceVariant(
      variant,
      measurements,
      { ...baselines.variants[laneId], activeScroll: undefined },
    ).status,
    'failed',
  )
  assert.equal(
    evaluatePerformanceVariant(
      { ...variant, renderer: 'three' },
      measurements,
      baselines.variants[laneId],
    ).status,
    'failed',
  )

  const variants = {
    vanilla: Object.fromEntries(
      performanceBaselinePhases.map((phase) => {
        const {
          reactStateSetterCalls,
          reactCommits,
          reactStateSettersInstrumented,
          ...vanilla
        } = measurements[phase]
        return [phase, vanilla]
      }),
    ),
    'react-18.3.1-r3f-8.18.0': measurements,
    'react-19.2.7-r3f-9.6.1': structuredClone(measurements),
  }
  assert.equal(
    evaluatePerformanceBaselineGate(baselines, variants).status,
    'passed',
  )
  delete variants['react-19.2.7-r3f-9.6.1']
  assert.equal(
    evaluatePerformanceBaselineGate(baselines, variants).status,
    'failed',
  )
})

test('React performance evidence runs through both packed public consumer lanes without source coupling', async () => {
  const [
    react18,
    react19,
    instrumentation,
    rendererHarness,
    vanillaInstrumentation,
    reachWorkload,
  ] = await Promise.all([
    readFile(new URL('../fixtures/consumers/react-18/smoke.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../fixtures/consumers/react-19/smoke.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../fixtures/consumers/react-performance-baseline.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../fixtures/consumers/react-renderer-harness.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../fixtures/consumers/three/automated-gates.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../fixtures/consumers/reach-scroll-workload.mjs', import.meta.url), 'utf8'),
  ])

  for (const source of [react18, react19]) {
    assert.match(source, /import\(['"]@xleepy\/wrist-menu\/react['"]\)/)
    assert.match(source, /runPackedReactPerformanceBaseline/)
    assert.ok(
      source.indexOf('const stateSetterProbe = installReactStateSetterProbe') <
        source.indexOf("import('@xleepy/wrist-menu/react')"),
    )
  }
  assert.match(instrumentation, /from ['"]\.\/performance-workload\.mjs['"]/)
  assert.match(vanillaInstrumentation, /from ['"]\.\.\/performance-workload\.mjs['"]/)
  assert.match(instrumentation, /from ['"]\.\/reach-scroll-workload\.mjs['"]/)
  assert.match(vanillaInstrumentation, /from ['"]\.\.\/reach-scroll-workload\.mjs['"]/)
  assert.doesNotMatch(instrumentation, /controller-action-journey/)
  assert.match(instrumentation, /instrumentUniqueAddedFrameSubscription/)
  assert.doesNotMatch(
    instrumentation,
    /(?:beforeFrameSample|afterFrameSample|-1001|-999)/,
  )
  assert.doesNotMatch(
    `${instrumentation}\n${vanillaInstrumentation}`,
    /function (?:sceneCounters|percentile)\(/,
  )
  assert.doesNotMatch(
    `${react18}\n${react19}\n${instrumentation}\n${rendererHarness}\n${reachWorkload}`,
    /(?:\.\.\/)+src\//,
  )
})

test('a package-owned state setter dispatch is counted when React bails out without a commit', () => {
  let renders = 1
  let currentState = 'unchanged'
  const reactRuntime = {
    useState() {
      return [currentState, (nextState) => {
        if (nextState !== currentState) {
          currentState = nextState
          renders += 1
        }
      }]
    },
  }
  const probe = installReactStateSetterProbe(reactRuntime, {
    ownsHook: () => true,
  })
  const [, setState] = reactRuntime.useState(currentState)

  probe.beginFrameSamples()
  setState('unchanged')
  const observation = probe.endFrameSamples()
  probe.restore()

  assert.equal(renders, 1)
  assert.equal(observation.reactStateSetterCalls, 1)
})

test('package timing excludes another same-priority frame callback', () => {
  let clock = 0
  const samePriorityHostSubscription = {
    priority: -1000,
    ref: { current: () => { clock += 100 } },
  }
  const packedWristMenuSubscription = {
    priority: -1000,
    ref: { current: () => { clock += 3 } },
  }
  const timingProbe = instrumentUniqueAddedFrameSubscription(
    [samePriorityHostSubscription],
    [samePriorityHostSubscription, packedWristMenuSubscription],
    { now: () => clock },
  )

  timingProbe.start()
  samePriorityHostSubscription.ref.current()
  packedWristMenuSubscription.ref.current()
  assert.deepEqual(timingProbe.stop(), [3])
  timingProbe.restore()

  assert.throws(
    () => instrumentUniqueAddedFrameSubscription(
      [samePriorityHostSubscription],
      [
        samePriorityHostSubscription,
        packedWristMenuSubscription,
        { priority: -1000, ref: { current: () => undefined } },
      ],
      { now: () => clock },
    ),
    /exactly one newly registered priority -1000 frame subscription/,
  )
})

test('the performance Release Gate is independent from failed sibling automation gates', () => {
  const vanillaAutomatedReport = {
    gates: {
      allocation: { status: 'failed' },
      'performance-baseline': { status: 'passed' },
    },
  }

  assert.deepEqual(
    performanceBaselinePrerequisites({
      vanillaAutomatedReport,
      react18PackedConsumer: true,
      react19PackedConsumer: true,
    }),
    {
      vanillaPackedConsumer: true,
      react18PackedConsumer: true,
      react19PackedConsumer: true,
    },
  )
  assert.equal(
    performanceBaselinePrerequisites({
      vanillaAutomatedReport: { gates: {} },
      react18PackedConsumer: true,
      react19PackedConsumer: true,
    }).vanillaPackedConsumer,
    false,
  )
})
