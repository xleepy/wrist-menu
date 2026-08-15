import assert from 'node:assert/strict'

export const semanticScenarios = Object.freeze([
  'fresh-reveal-hide-dwell',
  'both-wrists',
  'scrolling',
  'invalid-disabled',
  'tracking-loss',
  'input-switching',
  'visibility-session-reentry',
  'empty-unavailable',
].map((id) => Object.freeze({ id })))
export const semanticCaseIds = Object.freeze(
  semanticScenarios.map(({ id }) => id),
)
export const sceneActionTypes = Object.freeze([
  'pointerdown',
  'pointerup',
  'click',
  'dblclick',
  'contextmenu',
])
export const shieldScenarios = Object.freeze([
  ['commit', ['selection-intent']],
  ['cancel', ['selection-cancellation']],
  ['hold', ['selection-intent']],
  ['leave-before-release', ['selection-cancellation']],
  ['rapid-actions', ['selection-intent', 'selection-intent']],
].map(([id, terminalEventTypes]) => Object.freeze({
  id,
  terminalEventTypes: Object.freeze(terminalEventTypes),
  recovery: Object.freeze({
    mountedMenuPresent: true,
    sourceNeutralized: true,
    menuPresentAfterUnmount: false,
  }),
})))
export const shieldCaseIds = Object.freeze(
  shieldScenarios.map(({ id }) => id),
)

const shieldScenarioById = new Map(
  shieldScenarios.map((scenario) => [scenario.id, scenario]),
)

function sameOrderedValues(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  )
}

function sameIds(entries, ids) {
  return (
    Array.isArray(entries) &&
    entries.length === ids.length &&
    entries.every(({ id }, index) => id === ids[index])
  )
}

function validRendererObservation(entry) {
  return (
    entry?.status === 'passed' &&
    Number.isInteger(entry.observations?.iwerFrames) &&
    entry.observations.iwerFrames > 0 &&
    Number.isInteger(entry.observations?.rendererFrames) &&
    entry.observations.rendererFrames > 0 &&
    (entry.id !== 'input-switching' ||
      validInputSwitchingObservations(entry.observations)) &&
    (entry.id !== 'visibility-session-reentry' ||
      validLifecycleObservations(entry.observations)) &&
    (entry.id !== 'scrolling' ||
      validScrollingObservations(entry.observations))
  )
}

function sameNonemptyStringSignatures(before, after) {
  return (
    Array.isArray(before) &&
    before.length > 0 &&
    before.every((value) => typeof value === 'string') &&
    Array.isArray(after) &&
    after.length === before.length &&
    after.every((value, index) => value === before[index])
  )
}

function validInputSwitchingObservations(observations) {
  return (
    Array.isArray(observations?.runs) &&
    observations.runs.length > 0 &&
    observations.runs.every((run) =>
      typeof run?.activeTransientBefore?.kind === 'string' &&
      run.activeTransientBefore.kind.length > 0 &&
      run.activeTransientBefore.claimed === true &&
      run.sourceSwitched === true &&
      run.transientCleared === true &&
      Array.isArray(run.terminalEvents) &&
      run.terminalEvents.length === 1 &&
      run.terminalEvents[0]?.type === 'selection-cancellation' &&
      sameNonemptyStringSignatures(
        run.durableModelBefore,
        run.durableModelAfter,
      ),
    )
  )
}

function validLifecycleObservations(observations) {
  return (
    Array.isArray(observations?.runs) &&
    observations.runs.length > 0 &&
    observations.runs.every((run) =>
      run?.visibilityHidden === true &&
      run.visibilityRestored === true &&
      run.sessionEnded === true &&
      run.newSessionIdentity === true &&
      run.sessionCleanup === true &&
      sameNonemptyStringSignatures(
        run.durableModelBefore,
        run.durableModelAfter,
      ) &&
      run.freshDwell?.before === false &&
      run.freshDwell.below === false &&
      run.freshDwell.at === true &&
      run.postReentrySelectionIntents === 1,
    )
  )
}

function validScrollingObservations(observations) {
  return (
    Array.isArray(observations?.runs) &&
    observations.runs.length > 0 &&
    observations.runs.every((run) =>
      Array.isArray(run?.offsetSamples) &&
      run.offsetSamples.length >= 4 &&
      run.offsetSamples.every(Number.isFinite) &&
      run.offsetSamples[0] >= 0 &&
      run.offsetSamples.slice(1).every(
        (offset, index) => offset > run.offsetSamples[index],
      ) &&
      run.topClamp === 0 &&
      Number.isFinite(run.maxOffset) &&
      run.maxOffset > 0 &&
      run.bottomClamp === run.maxOffset &&
      run.ownershipAcquired === true &&
      run.ownershipReleased === true &&
      run.rearmed === true,
    )
  )
}

function sceneEventShieldScenarioPassed(id, observations) {
  const scenario = shieldScenarioById.get(id)
  return (
    scenario !== undefined &&
    (observations?.dispatchPath === 'three-host-shield' ||
      observations?.dispatchPath === 'react-event-manager') &&
    Array.isArray(observations.dispatches) &&
    observations.dispatches.length === sceneActionTypes.length &&
    observations.dispatches.every(
      ({ type, behindTargetDeliveries }, index) =>
        type === sceneActionTypes[index] && behindTargetDeliveries === 0,
    ) &&
    sameOrderedValues(
      observations.terminalEvents?.map(({ type }) => type),
      scenario.terminalEventTypes,
    ) &&
    Number.isInteger(observations.neutralTransitions) &&
    observations.neutralTransitions >= 1 &&
    observations.mountedRecoveryMenuPresent ===
      scenario.recovery.mountedMenuPresent &&
    observations.sourceNeutralized === scenario.recovery.sourceNeutralized &&
    Array.isArray(observations.mountedRecoveryDispatches) &&
    observations.mountedRecoveryDispatches.length === sceneActionTypes.length &&
    observations.mountedRecoveryDispatches.every(
      ({ type, behindTargetDeliveries }, index) =>
        type === sceneActionTypes[index] &&
        Number.isInteger(behindTargetDeliveries) &&
        behindTargetDeliveries > 0,
    ) &&
    observations.menuPresentAfterUnmount ===
      scenario.recovery.menuPresentAfterUnmount &&
    Array.isArray(observations.unmountRecoveryDispatches) &&
    observations.unmountRecoveryDispatches.length === sceneActionTypes.length &&
    observations.unmountRecoveryDispatches.every(
      ({ type, behindTargetDeliveries }, index) =>
        type === sceneActionTypes[index] &&
        Number.isInteger(behindTargetDeliveries) &&
        behindTargetDeliveries > 0,
    )
  )
}

function validActualDispatchCase(entry) {
  return (
    entry?.status === 'passed' &&
    sceneEventShieldScenarioPassed(entry.id, entry.observations)
  )
}

export function buildRendererJourneyCoverage({
  driver,
  sourceKind,
  semanticCases,
  sceneEventShield,
}) {
  if (driver !== 'packed-three-renderer-xr' && driver !== 'packed-react-renderer-xr') {
    throw new TypeError('journey evidence must use a production renderer/XR seam')
  }
  if (!sameIds(semanticCases, semanticCaseIds)) {
    throw new TypeError('renderer journey is missing a documented semantic case')
  }
  if (!semanticCases.every(validRendererObservation)) {
    const failedEntries = semanticCases
      .filter((entry) => !validRendererObservation(entry))
    const failed = failedEntries.map(({ id }) => id).join(', ')
    throw new TypeError(
      `semantic cases require actual IWER and renderer frames: ${failed}; ${JSON.stringify(failedEntries)}`,
    )
  }
  if (
    sceneEventShield?.status !== 'passed' ||
    !sameIds(sceneEventShield.cases, shieldCaseIds) ||
    !sceneEventShield.cases.every(validActualDispatchCase)
  ) {
    const failedEntries = sceneEventShield?.cases?.filter(
      (entry) => !validActualDispatchCase(entry),
    ) ?? []
    throw new TypeError(
      `Scene Event Shield requires actual behind-target dispatch: ${JSON.stringify(failedEntries)}`,
    )
  }
  if (
    !sameOrderedValues(sceneEventShield.actionTypes, sceneActionTypes)
  ) {
    throw new TypeError('Scene Event Shield action matrix is incomplete')
  }
  return Object.freeze({
    status: 'passed',
    driver,
    sourceKind,
    semanticCases,
    sceneEventShield,
  })
}

export function assertCompleteJourneyCoverage(coverage) {
  assert.equal(coverage.status, 'passed')
  assert.ok(
    coverage.driver === 'packed-three-renderer-xr' ||
      coverage.driver === 'packed-react-renderer-xr',
  )
  assert.deepEqual(coverage.semanticCases.map(({ id }) => id), semanticCaseIds)
  assert.ok(coverage.semanticCases.every(validRendererObservation))
  assert.deepEqual(
    coverage.sceneEventShield.cases.map(({ id }) => id),
    shieldCaseIds,
  )
  assert.deepEqual(coverage.sceneEventShield.actionTypes, sceneActionTypes)
  assert.ok(coverage.sceneEventShield.cases.every(validActualDispatchCase))
}

/**
 * Deep journey-evidence interface. Renderer Integration adapters receive the
 * shared scenario sequence and return observations; this module owns expected
 * Wrist Menu Events, recovery, coverage assembly, and the final lane result.
 */
export async function runRendererJourneyEvidence({
  rendererIntegration,
  sourceKind,
  runSemanticCases,
  runSceneEventShieldCases,
}) {
  if (rendererIntegration !== 'three' && rendererIntegration !== 'react') {
    throw new TypeError('unknown Renderer Integration')
  }
  const driver = rendererIntegration === 'three'
    ? 'packed-three-renderer-xr'
    : 'packed-react-renderer-xr'
  const semanticCases = await runSemanticCases(semanticScenarios)
  const shieldCases = (await runSceneEventShieldCases(shieldScenarios)).map(
    (entry) => Object.freeze({
      ...entry,
      status: sceneEventShieldScenarioPassed(entry.id, entry.observations)
        ? 'passed'
        : 'failed',
    }),
  )
  const sceneEventShield = {
    status: shieldCases.every(({ status }) => status === 'passed')
      ? 'passed'
      : 'failed',
    rendererIntegration,
    selectionSourceKind: sourceKind,
    actionTypes: sceneActionTypes,
    cases: shieldCases,
  }
  const coverage = buildRendererJourneyCoverage({
    driver,
    sourceKind,
    semanticCases,
    sceneEventShield,
  })
  assertCompleteJourneyCoverage(coverage)
  const selectionIntents = semanticCases.reduce(
    (total, entry) => total + entry.observations.runs.reduce(
      (subtotal, run) => subtotal + run.wristMenuEvents.filter(
        ({ type }) => type === 'selection-intent',
      ).length,
      0,
    ),
    0,
  )
  return Object.freeze({
    id: `iwer-${rendererIntegration}-${sourceKind}`,
    status: coverage.status,
    selectionIntents,
    coverage,
    sceneEventShield,
  })
}
