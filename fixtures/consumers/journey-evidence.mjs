import assert from 'node:assert/strict'
import { reachScrollGapYMeters } from './reach-scroll-workload.mjs'

const semanticScenarios = Object.freeze([
  { id: 'fresh-reveal-hide-dwell', behavior: 'freshRevealHideDwell', automaticDwell: true },
  { id: 'both-wrists', behavior: 'bothWrists', wrists: ['left', 'right'] },
  { id: 'scrolling', behavior: 'scrolling', menuDefinition: 'long' },
  { id: 'invalid-disabled', behavior: 'invalidDisabled' },
  { id: 'tracking-loss', behavior: 'trackingLoss' },
  { id: 'input-switching', behavior: 'inputSwitching' },
  { id: 'visibility-session-reentry', behavior: 'visibilitySessionReentry', automaticDwell: true },
  { id: 'empty-unavailable', behavior: 'emptyUnavailable' },
].map((scenario) => Object.freeze({
  wrists: Object.freeze(scenario.wrists ?? ['left']),
  automaticDwell: false,
  menuDefinition: 'standard',
  ...scenario,
})))
const semanticCaseIds = Object.freeze(
  semanticScenarios.map(({ id }) => id),
)
export const sceneActionTypes = Object.freeze([
  'pointerdown',
  'pointerup',
  'click',
  'dblclick',
  'contextmenu',
])
const recoveredShield = Object.freeze({
  mountedMenuPresent: true,
  sourceNeutralized: true,
  menuPresentAfterUnmount: false,
})
const shieldScenarios = Object.freeze([
  {
    id: 'commit',
    engagement: 'immediate',
    resolution: 'commit',
    terminalEventTypes: ['selection-intent'],
  },
  {
    id: 'cancel',
    engagement: 'immediate',
    resolution: 'cancel',
    terminalEventTypes: ['selection-cancellation'],
  },
  {
    id: 'hold',
    engagement: 'hold',
    resolution: 'commit',
    terminalEventTypes: ['selection-intent'],
  },
  {
    id: 'leave-before-release',
    engagement: 'immediate',
    resolution: 'leaveBeforeRelease',
    terminalEventTypes: ['selection-cancellation'],
  },
  {
    id: 'rapid-actions',
    engagement: 'immediate',
    resolution: 'rapidActions',
    terminalEventTypes: ['selection-intent', 'selection-intent'],
  },
].map((scenario) => Object.freeze({
  ...scenario,
  terminalEventTypes: Object.freeze(scenario.terminalEventTypes),
  recovery: recoveredShield,
})))
const shieldCaseIds = Object.freeze(
  shieldScenarios.map(({ id }) => id),
)

const shieldScenarioById = new Map(
  shieldScenarios.map((scenario) => [scenario.id, scenario]),
)

async function initializeSemanticRun(run, scenario) {
  await run.step(0, {
    viewer: scenario.automaticDwell ? 'away' : 'neutral',
  })
  await run.step(16, {
    viewer: scenario.automaticDwell ? 'facing' : 'neutral',
  })
}

async function dragPanel(run, positionY, time) {
  await run.aim({ y: positionY, handZ: 0.06, time })
  const sampleTime = run.sourceKind === 'hand' ? time + 16 : time
  await run.step(sampleTime)
  return { offset: run.scrollOffset(), nextTime: sampleTime + 16 }
}

async function releaseScrollSource(run, time) {
  run.moveSelectionAway()
  await run.step(time)
  return { offset: run.scrollOffset(), nextTime: time + 16 }
}

const semanticWorkflows = Object.freeze({
  async freshRevealHideDwell(run) {
    const beforeDwell = run.visible()
    await run.step(315, { viewer: 'facing' })
    const belowDwell = run.visible()
    const belowPhase = run.revealPhase()
    await run.step(316, { viewer: 'facing' })
    const atDwell = run.visible()
    const atPhase = run.revealPhase()
    await run.step(332, { viewer: 'away' })
    const hidden = !run.visible()
    return {
      passed: !beforeDwell && !belowDwell && atDwell && hidden,
      detail: {
        beforeDwell,
        belowDwell,
        belowPhase,
        atDwell,
        atPhase,
        hidden,
      },
    }
  },
  async bothWrists(run) {
    return { passed: run.visible(), detail: { visible: run.visible() } }
  },
  async scrolling(run) {
    let time = 32
    ;({ nextTime: time } = await releaseScrollSource(run, time))
    const firstDownwardDrag = []
    for (const positionY of reachScrollGapYMeters) {
      const sample = await dragPanel(run, positionY, time)
      firstDownwardDrag.push(sample.offset)
      time = sample.nextTime
    }
    const ownershipAcquired =
      firstDownwardDrag.at(-1) > firstDownwardDrag[0]
    const released = await releaseScrollSource(run, time)
    time = released.nextTime
    const ownershipReleased = released.offset === firstDownwardDrag.at(-1)
    const secondDownwardDrag = []
    for (const positionY of reachScrollGapYMeters) {
      const sample = await dragPanel(run, positionY, time)
      secondDownwardDrag.push(sample.offset)
      time = sample.nextTime
    }
    const rearmed = secondDownwardDrag.at(-1) > secondDownwardDrag[0]
    const downwardSamples = [
      ...firstDownwardDrag,
      ...secondDownwardDrag.slice(1),
    ]
    const bottomClamp = run.scrollOffset()

    ;({ nextTime: time } = await releaseScrollSource(run, time))
    const upwardGapYs = [...reachScrollGapYMeters].reverse()
    const firstUpwardDrag = []
    for (const positionY of upwardGapYs) {
      const sample = await dragPanel(run, positionY, time)
      firstUpwardDrag.push(sample.offset)
      time = sample.nextTime
    }
    ;({ nextTime: time } = await releaseScrollSource(run, time))
    const secondUpwardDrag = []
    for (const positionY of upwardGapYs) {
      const sample = await dragPanel(run, positionY, time)
      secondUpwardDrag.push(sample.offset)
      time = sample.nextTime
    }
    const returnSamples = [
      ...firstUpwardDrag,
      ...secondUpwardDrag.slice(1),
    ]
    const topClamp = run.scrollOffset()
    const maxOffset = 6
    const offsetSamples = downwardSamples
    return {
      passed:
        offsetSamples.every(Number.isFinite) &&
        offsetSamples.slice(1).every(
          (offset, index) => offset > offsetSamples[index],
        ) &&
        Math.abs(bottomClamp - maxOffset) < 1e-9 &&
        Math.abs(topClamp) < 1e-9 &&
        ownershipAcquired && ownershipReleased && rearmed,
      detail: {
        offsetSamples,
        downwardSamples,
        returnSamples,
        topClamp,
        bottomClamp,
        maxOffset,
        ownershipAcquired,
        ownershipReleased,
        rearmed,
      },
    }
  },
  async invalidDisabled(run) {
    const before = run.selectionIntentCount()
    if (run.sourceKind === 'controller') {
      run.moveSelectionAway()
      await run.step(32, { input: 'press' })
      await run.step(48, { input: 'release' })
      await run.aim({ y: -0.0225, time: 64 })
      await run.step(64)
      await run.step(80, { input: 'press' })
      await run.step(96, { input: 'release' })
    } else {
      await run.aim({ y: -0.0225, handZ: 0.008, time: 32 })
      await run.step(48)
    }
    const selectionIntents = run.selectionIntentCount() - before
    return {
      passed: selectionIntents === 0,
      detail: { selectionIntents },
    }
  },
  async trackingLoss(run) {
    run.disconnectMenuSource()
    await run.step(32)
    return { passed: !run.visible(), detail: { hidden: !run.visible() } }
  },
  async inputSwitching(run) {
    const durableModelBefore = run.presentationSignature()
    if (run.sourceKind === 'controller') {
      await run.aim({ y: 0.0225, time: 32 })
      await run.step(32)
      await run.step(48, { input: 'press' })
    } else {
      await run.aim({ y: 0.0225, handZ: 0.03, time: 32 })
      await run.step(48)
    }
    const activeTransientBefore = await run.activeTransient()
    run.switchInputMode()
    await run.step(64)
    if (run.sourceKind === 'controller') {
      await run.step(80, { input: 'release' })
    } else {
      run.moveSelectionAway()
      await run.step(80)
    }
    const terminalEvents = run.terminalEvents()
    const durableModelAfter = run.presentationSignature()
    const sourceSwitched = run.sourceSwitched()
    const transientCleared = run.transientCleared()
    return {
      passed:
        activeTransientBefore.claimed &&
        sourceSwitched &&
        transientCleared &&
        terminalEvents.length === 1 &&
        terminalEvents[0].type === 'selection-cancellation' &&
        durableModelBefore.length > 0 &&
        sameOrderedValues(durableModelAfter, durableModelBefore),
      detail: {
        activeTransientBefore,
        sourceSwitched,
        transientCleared,
        terminalEvents,
        durableModelBefore,
        durableModelAfter,
      },
    }
  },
  async visibilitySessionReentry(run) {
    await run.step(315, { viewer: 'facing' })
    await run.step(316, { viewer: 'facing' })
    const durableModelBefore = run.presentationSignature()
    run.setVisibility('hidden')
    await run.step(332, { viewer: 'facing' })
    const visibilityHidden = !run.visible()
    run.setVisibility('visible')
    await run.step(348, { viewer: 'facing' })
    await run.step(548, { viewer: 'facing' })
    const visibilityRestored = run.visible()
    const session = await run.endAndReenterSession()
    await run.step(564, { viewer: 'facing' })
    const before = run.visible()
    await run.step(763, { viewer: 'facing' })
    const below = run.visible()
    await run.step(764, { viewer: 'facing' })
    const at = run.visible()
    const durableModelAfter = run.presentationSignature()
    const intentsBefore = run.selectionIntentCount()
    if (run.sourceKind === 'controller') {
      await run.aim({ y: 0.0225, time: 780 })
      await run.step(780, { viewer: 'facing' })
      await run.step(796, { input: 'press', viewer: 'facing' })
      await run.step(812, { input: 'release', viewer: 'facing' })
    } else {
      await run.aim({ y: 0.0225, handZ: 0.03, time: 780 })
      await run.step(796, { viewer: 'facing' })
      await run.aim({ y: 0.0225, handZ: 0.008, time: 812 })
      await run.step(828, { viewer: 'facing' })
    }
    const postReentrySelectionIntents =
      run.selectionIntentCount() - intentsBefore
    const detail = {
      visibilityHidden,
      visibilityRestored,
      sessionEnded: session.sessionEnded,
      newSessionIdentity: session.newSessionIdentity,
      sessionCleanup: session.sessionCleanup,
      durableModelBefore,
      durableModelAfter,
      freshDwell: { before, below, at },
      postReentrySelectionIntents,
    }
    return {
      passed:
        detail.visibilityHidden && detail.visibilityRestored &&
        detail.sessionEnded && detail.newSessionIdentity &&
        detail.sessionCleanup && !before && !below && at &&
        postReentrySelectionIntents === 1 &&
        durableModelBefore.length > 0 &&
        sameOrderedValues(durableModelAfter, durableModelBefore),
      detail,
    }
  },
  async emptyUnavailable(run) {
    await run.setMenuDefinition('empty')
    await run.step(32)
    const emptyHidden = !run.visible()
    await run.setMenuDefinition('standard')
    run.disconnectMenuSource()
    await run.step(48)
    const unavailableHidden = !run.visible()
    return {
      passed: emptyHidden && unavailableHidden,
      detail: { emptyHidden, unavailableHidden },
    }
  },
})

async function executeSemanticScenario(scenario, createSemanticRun) {
  const observations = []
  let passed = true
  for (const wrist of scenario.wrists) {
    const run = await createSemanticRun({ scenario, wrist })
    try {
      await initializeSemanticRun(run, scenario)
      const workflow = semanticWorkflows[scenario.behavior]
      if (typeof workflow !== 'function') {
        throw new TypeError(`unknown semantic journey workflow: ${scenario.id}`)
      }
      const result = await workflow(run)
      passed &&= result.passed
      observations.push({
        ...result.detail,
        wrist,
        iwerFrames: run.iwerFrames(),
        rendererFrames: run.rendererFrames(),
        wristMenuEvents: run.wristMenuEvents(),
      })
    } finally {
      await run.dispose()
    }
  }
  return {
    passed,
    observations: {
      iwerFrames: observations.reduce(
        (total, observation) => total + observation.iwerFrames,
        0,
      ),
      rendererFrames: observations.reduce(
        (total, observation) => total + observation.rendererFrames,
        0,
      ),
      runs: observations,
    },
  }
}

async function engageSceneEventShield(run, scenario) {
  await run.step(0)
  await run.step(16)
  if (run.sourceKind === 'controller') {
    await run.aim({ y: 0.0225, time: 32 })
    await run.step(32)
    await run.step(48, { input: 'press' })
  } else {
    await run.aim({ y: 0.0225, handZ: 0.03, time: 16 })
    await run.step(32)
    if (scenario.engagement === 'hold') {
      await run.aim({ y: 0.0225, handZ: 0.008, time: 48 })
      await run.step(48)
    }
  }
  if (scenario.engagement === 'hold') {
    await run.step(64)
    await run.step(80)
  }
  run.placeBehindMenu()
  await run.step(96)
  return run.dispatchSceneActions()
}

const shieldResolutionWorkflows = Object.freeze({
  async cancel(run) {
    run.disconnectMenuSource()
    await run.step(112)
    return { neutralTransitions: 1, recoveryTime: 160 }
  },
  async commit(run, scenario) {
    if (run.sourceKind === 'controller') {
      await run.step(112, { input: 'release' })
    } else {
      if (scenario.engagement !== 'hold') {
        await run.aim({ y: 0.0225, handZ: 0.008, time: 112 })
      }
      await run.step(112)
    }
    run.moveSelectionAway()
    await run.step(144)
    return { neutralTransitions: 1, recoveryTime: 160 }
  },
  async leaveBeforeRelease(run) {
    run.moveSelectionAway()
    await run.step(112, {
      input: run.sourceKind === 'controller' ? 'release' : 'next',
    })
    await run.step(144)
    return { neutralTransitions: 1, recoveryTime: 160 }
  },
  async rapidActions(run) {
    if (run.sourceKind === 'controller') {
      await run.step(112, { input: 'release' })
      await run.step(128)
      await run.step(144, { input: 'press' })
      await run.step(160, { input: 'release' })
      run.moveSelectionAway()
      await run.step(176)
      return { neutralTransitions: 2, recoveryTime: 192 }
    }
    await run.aim({ y: 0.0225, handZ: 0.008, time: 112 })
    await run.step(112)
    run.moveSelectionAway()
    await run.step(128)
    await run.aim({ y: 0.0225, handZ: 0.03, time: 144 })
    await run.step(144)
    await run.aim({ y: 0.0225, handZ: 0.008, time: 160 })
    await run.step(160)
    run.moveSelectionAway()
    await run.step(192)
    return { neutralTransitions: 2, recoveryTime: 208 }
  },
})

async function executeSceneEventShieldScenario(scenario, createShieldRun) {
  const run = await createShieldRun({ scenario })
  try {
    const dispatches = await engageSceneEventShield(run, scenario)
    const resolve = shieldResolutionWorkflows[scenario.resolution]
    if (typeof resolve !== 'function') {
      throw new TypeError(`unknown Scene Event Shield workflow: ${scenario.id}`)
    }
    const { neutralTransitions, recoveryTime } = await resolve(run, scenario)
    const terminalEvents = run.terminalEvents()
    run.placeBehindOutsideMenu()
    const mountedRecoveryMenuPresent = run.menuPresent()
    const mountedRecoveryDispatches = run.dispatchSceneActions()
    const sourceNeutralized = run.sourceNeutralized()
    await run.unmount(recoveryTime)
    const menuPresentAfterUnmount = run.menuPresent()
    const unmountRecoveryDispatches = run.dispatchSceneActions()
    return {
      dispatchPath: run.dispatchPath,
      dispatches,
      recoveryDispatches: mountedRecoveryDispatches,
      mountedRecoveryDispatches,
      unmountRecoveryDispatches,
      terminalEvents,
      neutralTransitions,
      mountedRecoveryMenuPresent,
      sourceNeutralized,
      menuPresentAfterUnmount,
      iwerFrames: run.iwerFrames(),
      rendererFrames: run.rendererFrames(),
      wristMenuEvents: run.wristMenuEvents(),
    }
  } finally {
    await run.dispose()
  }
}

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

function buildRendererJourneyCoverage({
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

function assertCompleteJourneyCoverage(coverage) {
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

/** Verify retained Renderer Integration journey observations as one unit. */
export function verifyRendererJourneyEvidence(coverage) {
  const verified = buildRendererJourneyCoverage(coverage)
  assertCompleteJourneyCoverage(verified)
  return verified
}

/**
 * Deep journey-evidence interface. Renderer Integration adapters expose frame,
 * aim, dispatch, and lifecycle mechanics; this module owns the executable
 * scenario timelines, expected Wrist Menu Events, recovery, coverage assembly,
 * and the final lane result.
 */
export async function runRendererJourneyEvidence({
  rendererIntegration,
  sourceKind,
  createSemanticRun,
  createSceneEventShieldRun,
}) {
  if (rendererIntegration !== 'three' && rendererIntegration !== 'react') {
    throw new TypeError('unknown Renderer Integration')
  }
  const driver = rendererIntegration === 'three'
    ? 'packed-three-renderer-xr'
    : 'packed-react-renderer-xr'
  if (
    typeof createSemanticRun !== 'function' ||
    typeof createSceneEventShieldRun !== 'function'
  ) {
    throw new TypeError('Renderer Integration adapter must observe every scenario')
  }
  const semanticCases = []
  for (const scenario of semanticScenarios) {
    const observed = await executeSemanticScenario(scenario, createSemanticRun)
    semanticCases.push(Object.freeze({
      id: scenario.id,
      status: observed?.passed === true ? 'passed' : 'failed',
      observations: observed?.observations,
    }))
  }
  const shieldCases = []
  for (const scenario of shieldScenarios) {
    const observations = await executeSceneEventShieldScenario(
      scenario,
      createSceneEventShieldRun,
    )
    shieldCases.push(Object.freeze({
      id: scenario.id,
      status: sceneEventShieldScenarioPassed(scenario.id, observations)
        ? 'passed'
        : 'failed',
      observations,
    }))
  }
  const sceneEventShield = {
    status: shieldCases.every(({ status }) => status === 'passed')
      ? 'passed'
      : 'failed',
    rendererIntegration,
    selectionSourceKind: sourceKind,
    actionTypes: sceneActionTypes,
    cases: shieldCases,
  }
  const coverage = verifyRendererJourneyEvidence({
    driver,
    sourceKind,
    semanticCases,
    sceneEventShield,
  })
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
