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
    entry.observations.rendererFrames > 0
  )
}

function validActualDispatchCase(entry) {
  const observations = entry?.observations
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
    Array.isArray(observations.recoveryDispatches) &&
    observations.recoveryDispatches.length === sceneActionTypes.length &&
    observations.recoveryDispatches.every(
      ({ type, behindTargetDeliveries }, index) =>
        type === sceneActionTypes[index] && behindTargetDeliveries > 0,
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
    !Array.isArray(sceneEventShield.actionTypes) ||
    !sceneEventShield.actionTypes.every(
      (type, index) => type === sceneActionTypes[index],
    )
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
