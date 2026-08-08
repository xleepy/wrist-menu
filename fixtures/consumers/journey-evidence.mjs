import assert from 'node:assert/strict'

export const semanticCaseIds = Object.freeze([
  'fresh-reveal-hide-dwell',
  'both-wrists',
  'scrolling',
  'invalid-disabled',
  'tracking-loss',
  'input-switching',
  'visibility-session-reentry',
  'empty-unavailable',
])
export const shieldCaseIds = Object.freeze([
  'commit',
  'cancel',
  'hold',
  'leave-before-release',
  'rapid-actions',
])
export const sceneActionTypes = Object.freeze([
  'pointerdown',
  'pointerup',
  'click',
  'dblclick',
  'contextmenu',
])
const shieldTerminalEventTypes = Object.freeze({
  commit: Object.freeze(['selection-intent']),
  cancel: Object.freeze(['selection-cancellation']),
  hold: Object.freeze(['selection-intent']),
  'leave-before-release': Object.freeze(['selection-cancellation']),
  'rapid-actions': Object.freeze(['selection-intent', 'selection-intent']),
})

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

function validActualDispatchCase(entry) {
  const observations = entry?.observations
  const terminalEventTypes = shieldTerminalEventTypes[entry?.id]
  return (
    entry?.status === 'passed' &&
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
      terminalEventTypes,
    ) &&
    Number.isInteger(observations.neutralTransitions) &&
    observations.neutralTransitions >= 1 &&
    observations.mountedRecoveryMenuPresent === true &&
    observations.sourceNeutralized === true &&
    Array.isArray(observations.mountedRecoveryDispatches) &&
    observations.mountedRecoveryDispatches.length === sceneActionTypes.length &&
    observations.mountedRecoveryDispatches.every(
      ({ type, behindTargetDeliveries }, index) =>
        type === sceneActionTypes[index] &&
        Number.isInteger(behindTargetDeliveries) &&
        behindTargetDeliveries > 0,
    ) &&
    observations.menuPresentAfterUnmount === false &&
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
