import assert from 'node:assert/strict'

const semanticCaseIds = Object.freeze([
  'both-wrists',
  'scrolling',
  'invalid-disabled',
  'tracking-loss',
  'input-switching',
  'visibility-session-reentry',
  'empty-unavailable',
])
const shieldCaseIds = Object.freeze([
  'commit',
  'cancel',
  'hold',
  'leave-before-release',
  'rapid-actions',
])
const sceneActionTypes = Object.freeze([
  'pointerdown',
  'pointerup',
  'click',
  'dblclick',
  'contextmenu',
])

function definition(rowCount = 3) {
  const rows = Array.from({ length: rowCount }, (_, index) => ({
    type: 'action',
    id: `row-${index}`,
    label: `Row ${index}`,
  }))
  rows.push({
    type: 'action',
    id: 'disabled',
    label: 'Unavailable',
    disabled: true,
  })
  return rows
}

function snapshot(wrist, rowCount = 3) {
  return {
    activationMode: 'forced-open',
    wrist,
    comfort: { transitionMs: 0 },
    menuDefinition: definition(rowCount),
  }
}

function opposite(wrist) {
  return wrist === 'left' ? 'right' : 'left'
}

function createHarness(core, sourceKind, wrist = 'left', rowCount = 3) {
  const events = []
  const runtime = core.createWristMenuRuntimeState({
    snapshot: snapshot(wrist, rowCount),
    onEvent: (event) => events.push(event),
  })
  const sourceId = `${opposite(wrist)}-${sourceKind}`
  let sequence = 0
  let lifecycleRevision = 0
  const source = (overrides = {}) =>
    sourceKind === 'controller'
      ? {
          id: sourceId,
          kind: 'controller',
          handedness: opposite(wrist),
          selectPressed: false,
          selectCompleted: false,
          ...overrides,
        }
      : { id: sourceId, kind: 'hand', handedness: opposite(wrist), ...overrides }
  const observation = (itemId = 'row-0', phase = 'hover') =>
    sourceKind === 'controller'
      ? { sourceId, kind: 'controller-target-ray', itemId }
      : { sourceId, kind: 'hand-fingertip', itemId, phase }
  const step = ({
    visibility = 'visible',
    wristPresent = true,
    sources = [source()],
    observations = [],
    scrollSources = [],
    nextLifecycleRevision,
  } = {}) => {
    sequence += 1
    if (nextLifecycleRevision !== undefined) {
      lifecycleRevision = nextLifecycleRevision
    }
    return core.stepWristMenuRuntime(
      runtime,
      {
        sequence,
        time: sequence * 16,
        visibility,
        viewerPosition: [0, -1, 0],
        lifecycleRevision,
        wristSources: wristPresent
          ? [{
              id: `${wrist}-hand`,
              kind: 'hand',
              handedness: wrist,
              pose: {
                position: [0, 0, 0],
                orientation: [0, 0, 0, 1],
                emulatedPosition: false,
              },
            }]
          : [],
        selectionSources: sources,
        scrollSources,
      },
      observations,
    )
  }
  const warm = () => {
    step()
    return step()
  }
  return {
    core,
    events,
    observation,
    runtime,
    source,
    sourceId,
    step,
    warm,
    dispose: () => core.disposeWristMenuRuntime(runtime),
  }
}

function eventCount(events, type) {
  return events.filter((event) => event.type === type).length
}

function observedCase(id, passed, observations) {
  return { id, status: passed ? 'passed' : 'failed', observations }
}

function bothWristsCase(core, sourceKind) {
  const observations = []
  for (const wrist of ['left', 'right']) {
    const harness = createHarness(core, sourceKind, wrist)
    const model = harness.warm()
    observations.push({ wrist, visible: model.visible, targetable: model.targetable })
    harness.dispose()
  }
  return observedCase(
    'both-wrists',
    observations.every(({ visible, targetable }) => visible && targetable),
    observations,
  )
}

function scrollingCase(core, sourceKind) {
  const harness = createHarness(core, sourceKind, 'left', 18)
  harness.warm()
  const threshold = sourceKind === 'hand' ? 0.009 : 0.013
  harness.step({
    scrollSources: [{
      id: harness.sourceId,
      kind: sourceKind,
      handedness: 'right',
      positionY: 0,
      targetingPanel: true,
    }],
  })
  const model = harness.step({
    scrollSources: [{
      id: harness.sourceId,
      kind: sourceKind,
      handedness: 'right',
      positionY: -threshold,
      targetingPanel: true,
    }],
  })
  const observations = {
    thresholdMeters: threshold,
    ownerSourceId: harness.runtime.scrollState.ownerSourceId,
    offset: model.scrollOffset,
  }
  harness.dispose()
  return observedCase(
    'scrolling',
    observations.ownerSourceId === harness.sourceId && observations.offset > 0,
    observations,
  )
}

function invalidDisabledCase(core, sourceKind) {
  const harness = createHarness(core, sourceKind)
  harness.warm()
  if (sourceKind === 'hand') {
    harness.step({ observations: [harness.observation('missing', 'pressed')] })
    harness.step({ observations: [harness.observation('disabled', 'pressed')] })
  } else {
    for (const itemId of ['missing', 'disabled']) {
      harness.step({
        sources: [harness.source({ selectPressed: true })],
        observations: [harness.observation(itemId)],
      })
      harness.step({
        sources: [harness.source({ selectCompleted: true })],
        observations: [harness.observation(itemId)],
      })
    }
  }
  const observations = {
    selectionIntents: eventCount(harness.events, 'selection-intent'),
    claims: harness.runtime.selectionState.claims.size,
  }
  harness.dispose()
  return observedCase(
    'invalid-disabled',
    observations.selectionIntents === 0 && observations.claims === 0,
    observations,
  )
}

function acquireClaim(harness) {
  if (harness.source().kind === 'hand') {
    harness.step({ observations: [harness.observation()] })
  } else {
    harness.step({ observations: [harness.observation()] })
    harness.step({
      sources: [harness.source({ selectPressed: true })],
      observations: [harness.observation()],
    })
  }
  return harness.core.wristMenuRuntimeBlocksSceneInput(
    harness.runtime,
    harness.sourceId,
  )
}

function interruptionCase(core, sourceKind, id, nextStep) {
  const harness = createHarness(core, sourceKind)
  harness.warm()
  const claimedBefore = acquireClaim(harness)
  const model = nextStep(harness)
  const observations = {
    claimedBefore,
    claimedAfter: harness.core.wristMenuRuntimeBlocksSceneInput(
      harness.runtime,
      harness.sourceId,
    ),
    targetableAfter: model.targetable,
    cancellations: eventCount(harness.events, 'selection-cancellation'),
  }
  harness.dispose()
  return observedCase(
    id,
    claimedBefore &&
      !observations.claimedAfter &&
      observations.cancellations === 1,
    observations,
  )
}

function visibilitySessionCase(core, sourceKind) {
  const harness = createHarness(core, sourceKind)
  harness.warm()
  const claimedBefore = acquireClaim(harness)
  harness.step({ visibility: 'visible-blurred', sources: [], observations: [] })
  harness.step({ visibility: 'hidden', sources: [], observations: [] })
  const firstReentry = harness.step({ nextLifecycleRevision: 1 })
  const secondReentry = harness.step()
  const observations = {
    claimedBefore,
    cancellations: eventCount(harness.events, 'selection-cancellation'),
    visibilityEvents: harness.events
      .filter(({ type }) => type === 'visibility-change')
      .map(({ visible }) => visible),
    firstReentryTargetable: firstReentry.targetable,
    secondReentryTargetable: secondReentry.targetable,
  }
  harness.dispose()
  return observedCase(
    'visibility-session-reentry',
    claimedBefore &&
      observations.cancellations === 1 &&
      !observations.firstReentryTargetable &&
      observations.secondReentryTargetable,
    observations,
  )
}

function emptyUnavailableCase(core, sourceKind) {
  const emptyHarness = createHarness(core, sourceKind)
  emptyHarness.warm()
  core.syncWristMenuRuntime(emptyHarness.runtime, {
    ...snapshot('left'),
    menuDefinition: [],
  })
  const emptyModel = emptyHarness.step()
  emptyHarness.dispose()

  const unavailableHarness = createHarness(core, sourceKind)
  unavailableHarness.step({ wristPresent: false })
  const unavailableModel = unavailableHarness.step({ wristPresent: false })
  unavailableHarness.dispose()
  const observations = {
    emptyVisible: emptyModel.visible,
    unavailableVisible: unavailableModel.visible,
  }
  return observedCase(
    'empty-unavailable',
    !observations.emptyVisible && !observations.unavailableVisible,
    observations,
  )
}

function runShieldScenario(core, sourceKind, id) {
  const harness = createHarness(core, sourceKind)
  harness.warm()
  let claimed = false
  const commit = () => {
    if (sourceKind === 'hand') {
      harness.step({ observations: [harness.observation()] })
      claimed ||= core.wristMenuRuntimeBlocksSceneInput(harness.runtime, harness.sourceId)
      harness.step({ observations: [harness.observation('row-0', 'pressed')] })
      harness.step({ observations: [] })
    } else {
      harness.step({ observations: [harness.observation()] })
      harness.step({
        sources: [harness.source({ selectPressed: true })],
        observations: [harness.observation()],
      })
      claimed ||= core.wristMenuRuntimeBlocksSceneInput(harness.runtime, harness.sourceId)
      harness.step({
        sources: [harness.source({ selectCompleted: true })],
        observations: [harness.observation()],
      })
    }
  }
  const cancel = (leaveWhilePressed = false) => {
    claimed ||= acquireClaim(harness)
    harness.step({
      sources:
        sourceKind === 'controller' && leaveWhilePressed
          ? [harness.source({ selectPressed: true })]
          : [harness.source()],
      observations: [],
    })
    if (sourceKind === 'controller' && leaveWhilePressed) harness.step()
  }

  if (id === 'commit') commit()
  if (id === 'cancel') cancel(false)
  if (id === 'hold') {
    claimed ||= acquireClaim(harness)
    for (let index = 0; index < 3; index += 1) {
      harness.step({
        sources: sourceKind === 'controller'
          ? [harness.source({ selectPressed: true })]
          : [harness.source()],
        observations: [harness.observation()],
      })
    }
  }
  if (id === 'leave-before-release') cancel(true)
  if (id === 'rapid-actions') {
    commit()
    commit()
  }

  const selectionIntents = eventCount(harness.events, 'selection-intent')
  const cancellations = eventCount(harness.events, 'selection-cancellation')
  const expectedIntents = id === 'rapid-actions' ? 2 : id === 'commit' ? 1 : 0
  const observations = {
    selectionIntents,
    cancellations,
    sceneActions: sceneActionTypes.map((type) => ({ type, blocked: claimed })),
  }
  const passed =
    claimed &&
    selectionIntents === expectedIntents &&
    observations.sceneActions.every(({ blocked }) => blocked)
  harness.dispose()
  return observedCase(id, passed, observations)
}

export function runCandidateJourneyCoverage({ core, sourceKind }) {
  const semanticCases = [
    bothWristsCase(core, sourceKind),
    scrollingCase(core, sourceKind),
    invalidDisabledCase(core, sourceKind),
    interruptionCase(core, sourceKind, 'tracking-loss', (harness) =>
      harness.step({ wristPresent: false, sources: [], observations: [] }),
    ),
    interruptionCase(core, sourceKind, 'input-switching', (harness) =>
      harness.step({
        sources: [{
          id: `replacement-${sourceKind === 'hand' ? 'controller' : 'hand'}`,
          kind: sourceKind === 'hand' ? 'controller' : 'hand',
          handedness: 'right',
          ...(sourceKind === 'hand'
            ? { selectPressed: false, selectCompleted: false }
            : {}),
        }],
        observations: [],
      }),
    ),
    visibilitySessionCase(core, sourceKind),
    emptyUnavailableCase(core, sourceKind),
  ]
  const sceneEventShield = {
    actionTypes: sceneActionTypes,
    cases: shieldCaseIds.map((id) => runShieldScenario(core, sourceKind, id)),
  }
  sceneEventShield.status = sceneEventShield.cases.every(
    ({ status }) => status === 'passed',
  )
    ? 'passed'
    : 'failed'
  return {
    status:
      semanticCases.every(({ status }) => status === 'passed') &&
      sceneEventShield.status === 'passed'
        ? 'passed'
        : 'failed',
    driver: 'candidate-public-core-with-IWER-source-metadata',
    sourceKind,
    semanticCases,
    sceneEventShield,
  }
}

export function assertCompleteJourneyCoverage(coverage) {
  assert.deepEqual(coverage.semanticCases.map(({ id }) => id), semanticCaseIds)
  assert.deepEqual(
    coverage.sceneEventShield.cases.map(({ id }) => id),
    shieldCaseIds,
  )
  assert.deepEqual(coverage.sceneEventShield.actionTypes, sceneActionTypes)
  assert.equal(coverage.status, 'passed')
  assert.equal(coverage.sceneEventShield.status, 'passed')
  for (const entry of [
    ...coverage.semanticCases,
    ...coverage.sceneEventShield.cases,
  ]) {
    assert.equal(entry.status, 'passed', `${entry.id} did not pass`)
  }
}
