// THROWAWAY PROTOTYPE. The reducer is portable; the surrounding terminal lab is disposable.
// Question: can explicit, independently visible activation and presentation states make
// wrist reveal, occlusion grace, host overrides, and lifecycle precedence feel coherent?

export const HOST_MODES = Object.freeze([
  'automatic',
  'forced-open',
  'forced-closed',
  'disabled',
])

export const SESSION_VISIBILITIES = Object.freeze([
  'visible',
  'visible-blurred',
  'hidden',
])

export const CONTROLLER_CONFIDENCES = Object.freeze(['high', 'low'])

export const CONTROLLER_OFFSETS = Object.freeze([
  Object.freeze({
    name: 'neutral',
    translationMeters: Object.freeze([0, 0.09, 0]),
    rotationDeg: Object.freeze([0, 0, 0]),
  }),
  Object.freeze({
    name: 'inward',
    translationMeters: Object.freeze([0.035, 0.08, 0.015]),
    rotationDeg: Object.freeze([0, 0, 12]),
  }),
  Object.freeze({
    name: 'outward',
    translationMeters: Object.freeze([-0.035, 0.1, -0.015]),
    rotationDeg: Object.freeze([0, 0, -12]),
  }),
])

// These values only make the lab immediately operable. They are deliberately not defaults.
export const ILLUSTRATIVE_TUNING = Object.freeze({
  enterAngleDeg: 35,
  exitAngleDeg: 50,
  dwellMs: 300,
  reacquireDwellMs: 200,
  graceMs: 250,
  transitionMs: 150,
  smallTickMs: 50,
  largeTickMs: 250,
})

const HAND_ANCHORS = Object.freeze({
  left: Object.freeze([-0.22, 1.25, -0.38]),
  right: Object.freeze([0.22, 1.25, -0.38]),
})

const CONTROLLER_GRIPS = Object.freeze({
  left: Object.freeze([-0.24, 1.22, -0.36]),
  right: Object.freeze([0.24, 1.22, -0.36]),
})

export function facingScoreFromAngle(angleDeg) {
  return Math.cos((angleDeg * Math.PI) / 180)
}

export function createPrototypeState() {
  const state = {
    timeMs: 0,
    sessionVisibility: 'visible',
    hostMode: 'automatic',
    menuWrist: 'left',
    sourceKind: 'hand',
    tuning: { ...ILLUSTRATIVE_TUNING },
    samples: {
      hand: {
        tracked: true,
        facingAngleDeg: 65,
      },
      controller: {
        tracked: true,
        facingAngleDeg: 65,
        confidence: 'high',
        offsetName: 'neutral',
      },
    },
    tracking: {
      status: 'tracked',
      lastValidAtMs: 0,
      lastLostAtMs: null,
      reacquiredAtMs: null,
      freshDwellRequired: false,
    },
    activation: {
      phase: 'idle',
      sinceMs: null,
      requiredDwellMs: null,
      reason: 'outside-enter-angle',
    },
    presentation: {
      phase: 'hidden',
      sinceMs: 0,
      fromOpacity: 0,
      graceUntilMs: null,
      heldPose: false,
    },
    output: {
      selectedPoseTracked: true,
      automaticEligible: true,
      facingAngleDeg: 65,
      facingScore: facingScoreFromAngle(65),
      anchorPosition: [...HAND_ANCHORS.left],
      controllerOffset: null,
      opacity: 0,
      interactive: false,
      dwellRemainingMs: null,
      graceRemainingMs: null,
      transitionRemainingMs: null,
      reason: 'outside-enter-angle',
      tuningWarning: null,
    },
    lastAction: 'prototype initialised',
  }

  return evaluate(state, null, { type: 'INITIALISE' })
}

export function wristRevealReducer(state, action) {
  if (action.type === 'RESET') {
    return createPrototypeState()
  }

  const next = cloneState(state)
  applyAction(next, action)
  next.lastAction = action.label ?? describeAction(action)
  return evaluate(next, state, action)
}

export function getSelectedSample(state) {
  return state.samples[state.sourceKind]
}

export function getControllerOffset(state) {
  const offset = CONTROLLER_OFFSETS.find(
    (candidate) => candidate.name === state.samples.controller.offsetName,
  ) ?? CONTROLLER_OFFSETS[0]
  const handednessSign = state.menuWrist === 'left' ? 1 : -1

  return {
    name: offset.name,
    translationMeters: [
      offset.translationMeters[0] * handednessSign,
      offset.translationMeters[1],
      offset.translationMeters[2],
    ],
    rotationDeg: [
      offset.rotationDeg[0],
      offset.rotationDeg[1],
      offset.rotationDeg[2] * handednessSign,
    ],
  }
}

function cloneState(state) {
  return {
    ...state,
    tuning: { ...state.tuning },
    samples: {
      hand: { ...state.samples.hand },
      controller: { ...state.samples.controller },
    },
    tracking: { ...state.tracking },
    activation: { ...state.activation },
    presentation: { ...state.presentation },
    output: {
      ...state.output,
      anchorPosition: [...state.output.anchorPosition],
      controllerOffset: state.output.controllerOffset
        ? {
            ...state.output.controllerOffset,
            translationMeters: [...state.output.controllerOffset.translationMeters],
            rotationDeg: [...state.output.controllerOffset.rotationDeg],
          }
        : null,
    },
  }
}

function applyAction(state, action) {
  switch (action.type) {
    case 'TICK':
      state.timeMs += Math.max(0, action.ms)
      return
    case 'SET_SOURCE':
      state.sourceKind = action.sourceKind
      return
    case 'SET_WRIST':
      state.menuWrist = action.wrist
      return
    case 'SET_TRACKING':
      state.samples[action.sourceKind ?? state.sourceKind].tracked = action.tracked
      return
    case 'SET_FACING_ANGLE':
      state.samples[action.sourceKind ?? state.sourceKind].facingAngleDeg = clamp(
        action.angleDeg,
        0,
        180,
      )
      return
    case 'ADJUST_FACING_ANGLE': {
      const sample = state.samples[state.sourceKind]
      sample.facingAngleDeg = clamp(sample.facingAngleDeg + action.deltaDeg, 0, 180)
      return
    }
    case 'SET_SESSION_VISIBILITY':
      state.sessionVisibility = action.visibility
      return
    case 'SET_HOST_MODE':
      state.hostMode = action.hostMode
      return
    case 'SET_CONTROLLER_CONFIDENCE':
      state.samples.controller.confidence = action.confidence
      return
    case 'SET_CONTROLLER_OFFSET':
      state.samples.controller.offsetName = action.offsetName
      return
    case 'ADJUST_TUNING': {
      const current = state.tuning[action.field]
      const isAngle = action.field.endsWith('AngleDeg')
      state.tuning[action.field] = clamp(
        current + action.delta,
        0,
        isAngle ? 180 : Number.MAX_SAFE_INTEGER,
      )
      return
    }
    case 'SET_TUNING':
      state.tuning[action.field] = action.value
      return
    default:
      return
  }
}

function evaluate(state, previous, action) {
  const sample = getSelectedSample(state)
  const facingScore = facingScoreFromAngle(sample.facingAngleDeg)
  const controllerOffset = getControllerOffset(state)
  const selectedPoseTracked = sample.tracked
  const automaticEligible =
    selectedPoseTracked &&
    (state.sourceKind === 'hand' || state.samples.controller.confidence === 'high')
  const previousOpacity = previous?.output.opacity ?? state.output.opacity
  const selectedSourceChanged =
    previous &&
    (previous.sourceKind !== state.sourceKind || previous.menuWrist !== state.menuWrist)
  const visibilityResumed =
    previous &&
    previous.sessionVisibility !== 'visible' &&
    state.sessionVisibility === 'visible'
  const previousSample = previous ? getSelectedSample(previous) : null
  const trackingLost =
    previous &&
    previous.sourceKind === state.sourceKind &&
    previous.menuWrist === state.menuWrist &&
    previousSample.tracked &&
    !selectedPoseTracked
  const trackingReacquired =
    previous &&
    previous.sourceKind === state.sourceKind &&
    previous.menuWrist === state.menuWrist &&
    !previousSample.tracked &&
    selectedPoseTracked

  if (trackingLost) {
    state.tracking.status = 'lost'
    state.tracking.lastLostAtMs = state.timeMs
    state.tracking.freshDwellRequired = true
    resetActivation(state, 'tracking-lost')
  } else if (trackingReacquired || selectedSourceChanged || visibilityResumed) {
    state.tracking.status = selectedPoseTracked ? 'reacquired' : 'lost'
    state.tracking.reacquiredAtMs = selectedPoseTracked ? state.timeMs : null
    state.tracking.freshDwellRequired = true
    resetActivation(state, 'fresh-dwell-required')
  } else if (selectedPoseTracked) {
    state.tracking.status = 'tracked'
  } else {
    state.tracking.status = 'lost'
  }

  if (selectedPoseTracked && state.sessionVisibility === 'visible') {
    state.tracking.lastValidAtMs = state.timeMs
  }

  state.output = {
    ...state.output,
    selectedPoseTracked,
    automaticEligible,
    facingAngleDeg: sample.facingAngleDeg,
    facingScore,
    anchorPosition: deriveAnchorPosition(state, controllerOffset),
    controllerOffset: state.sourceKind === 'controller' ? controllerOffset : null,
    tuningWarning:
      state.tuning.exitAngleDeg < state.tuning.enterAngleDeg
        ? 'exit angle is stricter than enter angle; hysteresis is inverted'
        : null,
  }

  if (state.sessionVisibility === 'hidden') {
    state.tracking.status = 'suspended-hidden'
    resetActivation(state, 'session-hidden')
    hideImmediately(state, 'session-hidden')
    return finishOutput(state)
  }

  if (state.sessionVisibility === 'visible-blurred') {
    state.tracking.status = 'suspended-blurred'
    state.activation = {
      phase: 'paused',
      sinceMs: state.timeMs,
      requiredDwellMs: null,
      reason: 'session-visible-blurred',
    }
    state.output.opacity = previousOpacity
    state.output.interactive = false
    state.output.dwellRemainingMs = null
    state.output.graceRemainingMs = remainingGrace(state)
    state.output.transitionRemainingMs = null
    state.output.reason = 'session-visible-blurred'
    return finishOutput(state)
  }

  if (visibilityResumed && previousOpacity > 0) {
    startGrace(state, previousOpacity)
  }

  if (state.hostMode === 'disabled') {
    resetActivation(state, 'host-disabled')
    hideImmediately(state, 'host-disabled')
    return finishOutput(state)
  }

  if (state.hostMode === 'forced-closed') {
    blockActivation(state, 'host-forced-closed')
    advancePresentation(state, false, previousOpacity, 'host-forced-closed')
    return finishOutput(state)
  }

  if (!selectedPoseTracked) {
    resetActivation(state, 'tracking-lost')
    advanceTrackingGrace(state, previousOpacity)
    return finishOutput(state)
  }

  if (state.hostMode === 'forced-open') {
    state.activation = {
      phase: 'active',
      sinceMs: state.activation.phase === 'active' ? state.activation.sinceMs : state.timeMs,
      requiredDwellMs: null,
      reason: 'host-forced-open',
    }
    advancePresentation(state, true, previousOpacity, 'host-forced-open')
    return finishOutput(state)
  }

  if (!automaticEligible) {
    blockActivation(state, 'controller-confidence-too-low-for-automatic')
    advancePresentation(state, false, previousOpacity, state.activation.reason)
    return finishOutput(state)
  }

  updateAutomaticActivation(state)
  const targetVisible = state.activation.phase === 'active'
  const graceStillHolding =
    state.presentation.phase === 'grace' &&
    state.presentation.graceUntilMs !== null &&
    state.timeMs < state.presentation.graceUntilMs

  if (!targetVisible && graceStillHolding) {
    state.output.opacity = previousOpacity
    state.output.interactive = false
    state.output.reason = `${state.activation.reason}; visual-grace`
  } else {
    advancePresentation(state, targetVisible, previousOpacity, state.activation.reason)
  }

  return finishOutput(state)
}

function updateAutomaticActivation(state) {
  const { enterAngleDeg, exitAngleDeg } = state.tuning
  const angle = state.output.facingAngleDeg
  const insideEnter = angle <= enterAngleDeg
  const insideExit = angle <= exitAngleDeg

  if (state.activation.phase === 'active') {
    if (insideExit) {
      state.activation.reason = 'inside-exit-angle-latch'
      return
    }

    resetActivation(state, 'crossed-exit-angle')
    return
  }

  if (state.activation.phase === 'dwelling') {
    if (!insideEnter) {
      resetActivation(state, 'dwell-cancelled-outside-enter-angle')
      return
    }

    const elapsed = state.timeMs - state.activation.sinceMs
    if (elapsed >= state.activation.requiredDwellMs) {
      state.activation = {
        phase: 'active',
        sinceMs: state.timeMs,
        requiredDwellMs: null,
        reason: 'dwell-satisfied',
      }
      state.tracking.freshDwellRequired = false
      return
    }

    state.activation.reason = 'dwelling-inside-enter-angle'
    return
  }

  if (!insideEnter) {
    resetActivation(state, 'outside-enter-angle')
    return
  }

  const requiredDwellMs = state.tracking.freshDwellRequired
    ? state.tuning.reacquireDwellMs
    : state.tuning.dwellMs

  if (requiredDwellMs === 0) {
    state.activation = {
      phase: 'active',
      sinceMs: state.timeMs,
      requiredDwellMs: null,
      reason: 'zero-dwell-satisfied',
    }
    state.tracking.freshDwellRequired = false
    return
  }

  state.activation = {
    phase: 'dwelling',
    sinceMs: state.timeMs,
    requiredDwellMs,
    reason: state.tracking.freshDwellRequired
      ? 'fresh-dwell-after-reacquisition'
      : 'dwell-started',
  }
}

function advanceTrackingGrace(state, previousOpacity) {
  if (previousOpacity <= 0) {
    hideImmediately(state, 'tracking-lost-while-hidden')
    return
  }

  if (state.presentation.phase !== 'grace') {
    startGrace(state, previousOpacity)
  }

  if (state.timeMs < state.presentation.graceUntilMs) {
    state.output.opacity = previousOpacity
    state.output.interactive = false
    state.output.reason = 'tracking-lost; visual-grace-only'
    return
  }

  advancePresentation(state, false, previousOpacity, 'tracking-grace-expired')
}

function startGrace(state, opacity) {
  state.presentation = {
    phase: 'grace',
    sinceMs: state.timeMs,
    fromOpacity: opacity,
    graceUntilMs: state.timeMs + state.tuning.graceMs,
    heldPose: true,
  }
  state.output.opacity = opacity
  state.output.interactive = false
}

function advancePresentation(state, targetVisible, previousOpacity, reason) {
  const duration = state.tuning.transitionMs

  if (targetVisible) {
    if (state.presentation.phase === 'visible') {
      state.output.opacity = 1
      state.output.reason = reason
      return
    }

    if (state.presentation.phase !== 'showing') {
      state.presentation = {
        phase: 'showing',
        sinceMs: state.timeMs,
        fromOpacity: previousOpacity,
        graceUntilMs: null,
        heldPose: false,
      }
    }

    const progress = duration === 0
      ? 1
      : clamp((state.timeMs - state.presentation.sinceMs) / duration, 0, 1)
    state.output.opacity = mix(state.presentation.fromOpacity, 1, progress)
    state.output.reason = reason

    if (progress >= 1) {
      state.presentation.phase = 'visible'
      state.presentation.sinceMs = state.timeMs
      state.presentation.fromOpacity = 1
    }
    return
  }

  if (state.presentation.phase === 'hidden') {
    state.output.opacity = 0
    state.output.reason = reason
    return
  }

  if (state.presentation.phase !== 'hiding') {
    state.presentation = {
      phase: 'hiding',
      sinceMs: state.timeMs,
      fromOpacity: previousOpacity,
      graceUntilMs: null,
      heldPose: state.presentation.heldPose,
    }
  }

  const progress = duration === 0
    ? 1
    : clamp((state.timeMs - state.presentation.sinceMs) / duration, 0, 1)
  state.output.opacity = mix(state.presentation.fromOpacity, 0, progress)
  state.output.reason = reason

  if (progress >= 1) {
    hideImmediately(state, reason)
  }
}

function hideImmediately(state, reason) {
  state.presentation = {
    phase: 'hidden',
    sinceMs: state.timeMs,
    fromOpacity: 0,
    graceUntilMs: null,
    heldPose: false,
  }
  state.output.opacity = 0
  state.output.interactive = false
  state.output.reason = reason
}

function finishOutput(state) {
  const dwellRemainingMs = state.activation.phase === 'dwelling'
    ? Math.max(
        0,
        state.activation.requiredDwellMs - (state.timeMs - state.activation.sinceMs),
      )
    : null
  const graceRemainingMs = remainingGrace(state)
  let transitionRemainingMs = null

  if (state.presentation.phase === 'showing' || state.presentation.phase === 'hiding') {
    transitionRemainingMs = Math.max(
      0,
      state.tuning.transitionMs - (state.timeMs - state.presentation.sinceMs),
    )
  }

  state.output.dwellRemainingMs = dwellRemainingMs
  state.output.graceRemainingMs = graceRemainingMs
  state.output.transitionRemainingMs = transitionRemainingMs
  state.output.interactive =
    state.sessionVisibility === 'visible' &&
    state.output.selectedPoseTracked &&
    state.activation.phase === 'active' &&
    state.presentation.phase === 'visible'
  return state
}

function remainingGrace(state) {
  return state.presentation.phase === 'grace' && state.presentation.graceUntilMs !== null
    ? Math.max(0, state.presentation.graceUntilMs - state.timeMs)
    : null
}

function resetActivation(state, reason) {
  state.activation = {
    phase: 'idle',
    sinceMs: null,
    requiredDwellMs: null,
    reason,
  }
}

function blockActivation(state, reason) {
  state.activation = {
    phase: 'blocked',
    sinceMs: state.timeMs,
    requiredDwellMs: null,
    reason,
  }
}

function deriveAnchorPosition(state, controllerOffset) {
  if (state.sourceKind === 'hand') {
    return [...HAND_ANCHORS[state.menuWrist]]
  }

  const grip = CONTROLLER_GRIPS[state.menuWrist]
  return grip.map((component, index) => component + controllerOffset.translationMeters[index])
}

function describeAction(action) {
  switch (action.type) {
    case 'TICK':
      return `advanced prototype clock by ${action.ms} ms`
    case 'SET_SOURCE':
      return `selected ${action.sourceKind} pose samples`
    case 'SET_WRIST':
      return `moved menu to ${action.wrist} wrist`
    case 'SET_TRACKING':
      return `${action.sourceKind ?? 'selected source'} tracking ${action.tracked ? 'acquired' : 'lost'}`
    case 'SET_FACING_ANGLE':
      return `set facing angle to ${action.angleDeg} degrees`
    case 'ADJUST_FACING_ANGLE':
      return `adjusted facing angle by ${action.deltaDeg} degrees`
    case 'SET_SESSION_VISIBILITY':
      return `session visibility is ${action.visibility}`
    case 'SET_HOST_MODE':
      return `Host Application mode is ${action.hostMode}`
    case 'SET_CONTROLLER_CONFIDENCE':
      return `controller wrist confidence is ${action.confidence}`
    case 'SET_CONTROLLER_OFFSET':
      return `controller offset sample is ${action.offsetName}`
    case 'ADJUST_TUNING':
      return `adjusted ${action.field} by ${action.delta}`
    case 'SET_TUNING':
      return `set ${action.field} to ${action.value}`
    default:
      return action.type.toLowerCase()
  }
}

function mix(from, to, amount) {
  return from + (to - from) * amount
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value))
}
