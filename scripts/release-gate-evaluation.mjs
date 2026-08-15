import assert from 'node:assert/strict'

import { assertCompleteJourneyCoverage } from '../fixtures/consumers/journey-evidence.mjs'
import {
  evaluatePerformanceBaselineGate,
  performanceBaselinePrerequisites,
} from '../fixtures/consumers/performance-baseline.mjs'
import {
  buildAutomatedEvidenceRecord,
  buildCandidateUnavailableEvidenceRecord,
  canonicalJson,
  consumerLanePassed,
  sha256,
} from './release-evidence-lib.mjs'

const IWER_LANES = Object.freeze([
  'iwer-vanilla-hand',
  'iwer-vanilla-controller',
  'iwer-react-hand',
  'iwer-react-controller',
])

function gate(id, status, report, detail) {
  return {
    id,
    status: status === true || status === 'passed' ? 'passed' : 'failed',
    report,
    ...(detail === undefined ? {} : { detail }),
  }
}

function resolveCompatibilityEvidence(
  compatibility,
  candidate,
  laneStates,
  evidenceRecord,
) {
  return {
    ...compatibility,
    candidate,
    evidenceRecord,
    testedLanes: compatibility.testedLanes.map((lane) => ({
      ...lane,
      status: laneStates[lane.id] ? 'passed' : 'failed',
      evidenceRecords: [evidenceRecord],
    })),
  }
}

function journeyCombinationPassed(report, integration, sourceKind) {
  const journey = report?.journeys?.find(
    ({ sceneEventShield } = {}) =>
      sceneEventShield?.rendererIntegration === integration &&
      sceneEventShield.selectionSourceKind === sourceKind,
  )
  const coverage = journey?.coverage
  const shield = journey?.sceneEventShield
  const expectedDriver = integration === 'three'
    ? 'packed-three-renderer-xr'
    : 'packed-react-renderer-xr'
  const expectedDispatchPath = integration === 'three'
    ? 'three-host-shield'
    : 'react-event-manager'

  if (!(
    report?.status === 'passed' &&
    journey?.status === 'passed' &&
    coverage?.status === 'passed' &&
    coverage?.driver === expectedDriver &&
    coverage?.sourceKind === sourceKind &&
    shield?.status === 'passed' &&
    shield.rendererIntegration === integration &&
    shield.selectionSourceKind === sourceKind
  )) return false

  try {
    assertCompleteJourneyCoverage(coverage)
    assert.deepEqual(coverage.sceneEventShield, shield)
  } catch {
    return false
  }
  return shield.cases.every(
    ({ observations }) => observations.dispatchPath === expectedDispatchPath,
  )
}

function testedLaneStates({
  consumerResult,
  candidateSha256,
  threeReport,
  react18Report,
  react19Report,
  importReports,
}) {
  const passed = (report, laneId) =>
    consumerLanePassed(consumerResult, report, laneId, candidateSha256)
  const states = {
    'three-0.185.1': passed(threeReport, 'three-0.185.1'),
    'react-18.3.1-r3f-8.18.0': passed(
      react18Report,
      'react-18.3.1-r3f-8.18.0',
    ),
    'react-19.2.7-r3f-9.6.1': passed(
      react19Report,
      'react-19.2.7-r3f-9.6.1',
    ),
    'react-xr-6.6.30':
      passed(react18Report, 'react-xr-6.6.30') &&
      passed(react19Report, 'react-xr-6.6.30'),
    'iwer-vanilla-hand': passed(threeReport, 'iwer-vanilla-hand'),
    'iwer-vanilla-controller': passed(threeReport, 'iwer-vanilla-controller'),
    'iwer-react-hand': passed(react19Report, 'iwer-react-hand'),
    'iwer-react-controller': passed(react19Report, 'iwer-react-controller'),
  }
  states['core-import'] =
    consumerResult?.status === 'passed' &&
    importReports.every(
      ({ status, candidateSha256: observedSha256 }) =>
        status === 'passed' && observedSha256 === candidateSha256,
    )
  return states
}

function sceneEventShieldReport({
  candidateSha256,
  laneStates,
  threeReport,
  react18Report,
  react19Report,
}) {
  const combinations = [
    ['three-hand', threeReport, 'raw/three-iwer-lanes.json', 'three-0.185.1', 'three', 'hand'],
    ['three-controller', threeReport, 'raw/three-iwer-lanes.json', 'three-0.185.1', 'three', 'controller'],
    ['react-18-hand', react18Report, 'raw/react-18-xr-iwer-lanes.json', 'react-18.3.1-r3f-8.18.0', 'react', 'hand'],
    ['react-18-controller', react18Report, 'raw/react-18-xr-iwer-lanes.json', 'react-18.3.1-r3f-8.18.0', 'react', 'controller'],
    ['react-19-hand', react19Report, 'raw/react-19-xr-iwer-lanes.json', 'react-19.2.7-r3f-9.6.1', 'react', 'hand'],
    ['react-19-controller', react19Report, 'raw/react-19-xr-iwer-lanes.json', 'react-19.2.7-r3f-9.6.1', 'react', 'controller'],
  ].map(([id, report, reportPath, laneId, integration, sourceKind]) => ({
    id,
    integration,
    sourceKind,
    report: reportPath,
    status:
      laneStates[laneId] &&
      journeyCombinationPassed(report, integration, sourceKind)
        ? 'passed'
        : 'failed',
  }))
  return {
    candidateSha256,
    status: combinations.every(({ status }) => status === 'passed')
      ? 'passed'
      : 'failed',
    combinations,
  }
}

function performanceReport({
  policy,
  automatedReport,
  react18Report,
  react19Report,
  consumerResult,
  candidateSha256,
}) {
  const evaluated = evaluatePerformanceBaselineGate(policy, {
    vanilla:
      automatedReport.gates?.['performance-baseline']?.variants?.vanilla
        ?.measurements,
    'react-18.3.1-r3f-8.18.0':
      react18Report.performanceBaseline?.measurements,
    'react-19.2.7-r3f-9.6.1':
      react19Report.performanceBaseline?.measurements,
  })
  const prerequisites = performanceBaselinePrerequisites({
    vanillaAutomatedReport: automatedReport,
    react18PackedConsumer: consumerLanePassed(
      consumerResult,
      react18Report,
      'react-18.3.1-r3f-8.18.0',
      candidateSha256,
    ),
    react19PackedConsumer: consumerLanePassed(
      consumerResult,
      react19Report,
      'react-19.2.7-r3f-9.6.1',
      candidateSha256,
    ),
  })
  return {
    ...evaluated,
    status:
      evaluated.status === 'passed' &&
      Object.values(prerequisites).every(Boolean)
        ? 'passed'
        : 'failed',
    failures: [
      ...evaluated.failures,
      ...Object.entries(prerequisites)
        .filter(([, passed]) => !passed)
        .map(([prerequisite]) => `${prerequisite} prerequisite failed`),
    ],
    prerequisites,
  }
}

/** Interpret retained reports into exact Tested Lanes and Release Gates. */
export function evaluateAutomatedReleaseGates({
  compatibility,
  protocol,
  candidate,
  source,
  lockfiles,
  instrumentation,
  prerequisiteResults,
  deterministicResult,
  deterministicReport,
  consumerResult,
  automatedResult,
  automatedReport,
  exampleResult,
  threeReport,
  react18Report,
  react19Report,
  importReportNames,
  importReports,
  performanceBaselinePolicy,
}) {
  const laneStates = testedLaneStates({
    consumerResult,
    candidateSha256: candidate.sha256,
    threeReport,
    react18Report,
    react19Report,
    importReports,
  })
  const importSafety = {
    candidateSha256: candidate.sha256,
    status: laneStates['core-import'] ? 'passed' : 'failed',
    reports: importReportNames.map((name, index) => ({
      report: `raw/${name}`,
      status:
        consumerResult.status === 'passed' &&
        importReports[index]?.status === 'passed' &&
        importReports[index]?.candidateSha256 === candidate.sha256
          ? 'passed'
          : 'failed',
    })),
  }
  const sceneEventShield = sceneEventShieldReport({
    candidateSha256: candidate.sha256,
    laneStates,
    threeReport,
    react18Report,
    react19Report,
  })
  const performanceBaseline = performanceReport({
    policy: performanceBaselinePolicy,
    automatedReport,
    react18Report,
    react19Report,
    consumerResult,
    candidateSha256: candidate.sha256,
  })
  const automatedGate = (id) =>
    automatedResult.status === 'passed'
      ? automatedReport.gates?.[id]?.status
      : 'failed'
  const gates = [
    gate(
      'deterministic-boundaries',
      deterministicResult.status === 'passed'
        ? deterministicReport.status
        : 'failed',
      'raw/deterministic-boundaries.json',
    ),
    gate('core-behavior', prerequisiteResults[4]?.status, 'raw/prerequisite-5.json'),
    gate('import-safety', importSafety.status, 'raw/import-safety.json'),
    gate('three-consumer', laneStates['three-0.185.1'], 'raw/three-iwer-lanes.json'),
    gate('react-18-consumer', laneStates['react-18.3.1-r3f-8.18.0'], 'raw/react-18-xr-iwer-lanes.json'),
    gate('react-19-consumer', laneStates['react-19.2.7-r3f-9.6.1'], 'raw/react-19-xr-iwer-lanes.json'),
    gate('react-xr', laneStates['react-xr-6.6.30'], 'raw/react-19-xr-iwer-lanes.json'),
    gate(
      'iwer-four-lanes',
      IWER_LANES.every((id) => laneStates[id]),
      'raw/packed-consumers-command.json',
    ),
    ...[
      'allocation',
      'identical-frame-mutation',
      'resource-growth',
      'lifecycle-leak',
    ].map((id) => gate(
      id,
      automatedGate(id),
      'raw/automated-package-gates.json',
      automatedReport.gates?.[id]?.reason,
    )),
    gate(
      'performance-baseline',
      performanceBaseline.status,
      'raw/performance-baseline.json',
      performanceBaseline.failures[0],
    ),
    gate(
      'scene-event-shield',
      sceneEventShield.status,
      'raw/scene-event-shield.json',
    ),
    gate(
      'example-packed-consumer',
      exampleResult.status,
      'raw/packed-example-command.json',
    ),
  ]
  return Object.freeze({
    compatibility,
    protocol,
    candidate,
    source,
    lockfiles,
    instrumentation,
    testedLanes: Object.freeze(compatibility.testedLanes.map(({ id }) => id)),
    laneStates: Object.freeze(laneStates),
    reports: Object.freeze({ importSafety, sceneEventShield, performanceBaseline }),
    gates: Object.freeze(gates),
  })
}

/** Build the immutable successful/fail-closed record and resolved claim view. */
export function finalizeAutomatedReleaseEvidence(
  evaluation,
  { bundleManifest, artifactDirectory = 'artifacts/release-evidence' },
) {
  const resolvedTemplate = resolveCompatibilityEvidence(
    evaluation.compatibility,
    evaluation.candidate,
    evaluation.laneStates,
    'SELF',
  )
  const input = {
    candidate: evaluation.candidate,
    source: evaluation.source,
    lockfiles: evaluation.lockfiles,
    protocol: {
      id: evaluation.protocol.id,
      version: evaluation.protocol.version,
      sha256: evaluation.protocol.sha256,
    },
    instrumentation: evaluation.instrumentation,
    rawReportDirectory: 'RAW_DIRECTORY_PLACEHOLDER',
    requiredGateIds: evaluation.protocol.requiredGateIds,
    gates: evaluation.gates,
    testedLanes: evaluation.testedLanes,
    validationCombinations: [],
    resolvedCompatibilitySha256: sha256(canonicalJson(resolvedTemplate)),
    bundleManifest,
  }
  const preliminary = buildAutomatedEvidenceRecord(input)
  const recordDirectory = `${artifactDirectory}/${preliminary.recordId}`
  const evidenceRecord = `${recordDirectory}/evidence-record.json`
  const record = buildAutomatedEvidenceRecord({
    ...input,
    rawReportDirectory: `${recordDirectory}/raw`,
  })
  return Object.freeze({
    recordDirectory,
    record,
    resolvedCompatibility: resolveCompatibilityEvidence(
      evaluation.compatibility,
      record.candidate,
      evaluation.laneStates,
      evidenceRecord,
    ),
  })
}

/** Build fail-closed evidence when no candidate can be produced. */
export function finalizeCandidateUnavailableEvidence({
  compatibility,
  protocol,
  candidate,
  source,
  lockfiles,
  instrumentation,
  failure,
  bundleManifest,
  artifactDirectory = 'artifacts/release-evidence',
}) {
  const testedLanes = compatibility.testedLanes.map(({ id }) => id)
  const laneStates = Object.fromEntries(testedLanes.map((id) => [id, false]))
  const resolvedTemplate = resolveCompatibilityEvidence(
    compatibility,
    candidate,
    laneStates,
    'SELF',
  )
  const input = {
    candidate,
    source,
    lockfiles,
    protocol: {
      id: protocol.id,
      version: protocol.version,
      sha256: protocol.sha256,
    },
    instrumentation,
    testedLanes,
    validationCombinations: [],
    resolvedCompatibilitySha256: sha256(canonicalJson(resolvedTemplate)),
    bundleManifest,
    rawReportDirectory: 'RAW_DIRECTORY_PLACEHOLDER',
    failure,
  }
  const preliminary = buildCandidateUnavailableEvidenceRecord(input)
  const recordDirectory = `${artifactDirectory}/${preliminary.recordId}`
  const evidenceRecord = `${recordDirectory}/evidence-record.json`
  const record = buildCandidateUnavailableEvidenceRecord({
    ...input,
    rawReportDirectory: `${recordDirectory}/raw`,
  })
  return Object.freeze({
    recordDirectory,
    record,
    resolvedCompatibility: resolveCompatibilityEvidence(
      compatibility,
      record.candidate,
      laneStates,
      evidenceRecord,
    ),
  })
}
