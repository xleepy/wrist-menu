import type {
  ActivationMode,
  RevealConfiguration,
} from './activation-config.js'
import type { ResolvedWristAnchor, WristAnchorPose } from './wrist-anchor.js'

export type RevealPhase =
  | 'hidden'
  | 'dwelling'
  | 'reacquire-dwell'
  | 'showing'
  | 'visible'
  | 'hiding'
  | 'tracking-grace'
  | 'suspended'

export type VisibilityChangeReason =
  | 'automatic'
  | 'forced-open'
  | 'forced-closed'
  | 'disabled'
  | 'empty-definition'
  | 'tracking-lost'
  | 'source-replaced'
  | 'host-snapshot-changed'
  | 'lifecycle-interrupted'

export type RevealState = {
  initialized: boolean
  phase: RevealPhase
  opacity: number
  anchorPose: WristAnchorPose | null
  lastValidAnchorPose: WristAnchorPose | null
  boundSourceId: string | null
  trackingLost: boolean
  freshDwellRequired: boolean
  dwellStartedAt: number | null
  revealLatched: boolean
  lossStartedAt: number | null
  transitionStartedAt: number | null
  transitionFromOpacity: number
  visibilityReason: VisibilityChangeReason
}

export type RevealInput = Readonly<{
  time: number
  visibility: 'visible' | 'visible-blurred' | 'hidden'
  activationMode: ActivationMode
  hasContent: boolean
  resetReason: 'host-snapshot-changed' | 'lifecycle-interrupted' | null
  sourcePresent: boolean
  anchor: ResolvedWristAnchor | undefined
  configuration: RevealConfiguration
}>

export type RevealOutput = Readonly<{
  phase: RevealPhase
  opacity: number
  visible: boolean
  interactive: boolean
  anchorPose: WristAnchorPose | null
  visibilityReason: VisibilityChangeReason
}>

export function createRevealState(): RevealState {
  return {
    initialized: false,
    phase: 'hidden',
    opacity: 0,
    anchorPose: null,
    lastValidAnchorPose: null,
    boundSourceId: null,
    trackingLost: false,
    freshDwellRequired: false,
    dwellStartedAt: null,
    revealLatched: false,
    lossStartedAt: null,
    transitionStartedAt: null,
    transitionFromOpacity: 0,
    visibilityReason: 'automatic',
  }
}

export function advanceRevealState(
  state: RevealState,
  input: RevealInput,
): RevealOutput {
  advanceTransition(state, input.time, input.configuration.transitionMs)

  const resetHidVisiblePresentation =
    input.resetReason !== null && state.opacity > 0
  if (input.resetReason !== null) {
    resetForFreshAcquisition(state)
    hideImmediately(state)
    state.visibilityReason = input.resetReason
  }
  state.initialized = true

  if (!input.hasContent || input.activationMode === 'disabled') {
    state.visibilityReason = input.hasContent ? 'disabled' : 'empty-definition'
    hideImmediately(state)
    return output(state, false)
  }
  if (input.visibility === 'hidden') {
    state.visibilityReason = 'lifecycle-interrupted'
    resetForFreshAcquisition(state)
    hideImmediately(state)
    state.phase = 'suspended'
    return output(state, false)
  }
  if (input.visibility === 'visible-blurred') {
    state.visibilityReason = 'lifecycle-interrupted'
    state.revealLatched = false
    state.freshDwellRequired = true
    state.dwellStartedAt = null
    state.phase = 'suspended'
    return output(state, false)
  }

  const sourceReplaced =
    input.anchor !== undefined &&
    state.boundSourceId !== null &&
    state.boundSourceId !== input.anchor.sourceId
  const replacementHidVisiblePresentation = sourceReplaced && state.opacity > 0
  const preserveInterruptionReason =
    resetHidVisiblePresentation || replacementHidVisiblePresentation
  if (sourceReplaced) {
    resetForFreshAcquisition(state)
    hideImmediately(state)
    state.visibilityReason = 'source-replaced'
  }

  if (input.anchor === undefined) {
    if (input.sourcePresent || state.boundSourceId !== null) {
      state.visibilityReason = 'tracking-lost'
      applyTrackingLoss(state, input.time, input.configuration.visualGraceMs)
    } else {
      hideImmediately(state)
    }
    return output(state, false)
  }

  const wasTrackingLost = state.trackingLost
  state.boundSourceId = input.anchor.sourceId
  state.anchorPose = input.anchor.anchorPose
  state.lastValidAnchorPose = input.anchor.anchorPose
  state.trackingLost = false
  state.lossStartedAt = null
  if (wasTrackingLost) {
    state.freshDwellRequired = true
    state.dwellStartedAt = null
    state.revealLatched = false
  }

  if (input.activationMode === 'forced-closed') {
    if (!preserveInterruptionReason) {
      state.visibilityReason = 'forced-closed'
    }
    state.revealLatched = false
    state.dwellStartedAt = null
    startHiding(state, input.time, input.configuration.transitionMs)
    return output(state, false)
  }

  if (input.activationMode === 'forced-open') {
    if (!preserveInterruptionReason) {
      state.visibilityReason = 'forced-open'
    }
    state.revealLatched = true
    state.dwellStartedAt = null
    startShowing(state, input.time, input.configuration.transitionMs)
    return output(state, state.phase === 'visible')
  }

  if (
    !input.anchor.automaticEligible ||
    input.anchor.facingAngleDegrees === null
  ) {
    if (!preserveInterruptionReason) {
      state.visibilityReason = 'tracking-lost'
    }
    state.revealLatched = false
    state.dwellStartedAt = null
    hideImmediately(state)
    return output(state, false)
  }

  const angle = input.anchor.facingAngleDegrees
  if (state.revealLatched && angle <= input.configuration.exitAngleDegrees) {
    if (!preserveInterruptionReason) {
      state.visibilityReason = 'automatic'
    }
    startShowing(state, input.time, input.configuration.transitionMs)
    return output(state, state.phase === 'visible')
  }
  if (state.revealLatched) {
    if (!preserveInterruptionReason) {
      state.visibilityReason = 'automatic'
    }
    state.revealLatched = false
    state.dwellStartedAt = null
    startHiding(state, input.time, input.configuration.transitionMs)
    return output(state, false)
  }

  if (angle > input.configuration.enterAngleDegrees) {
    if (!preserveInterruptionReason) {
      state.visibilityReason = 'automatic'
    }
    state.dwellStartedAt = null
    if (state.opacity > 0) startHiding(state, input.time, input.configuration.transitionMs)
    else state.phase = 'hidden'
    return output(state, false)
  }

  const requiredDwell = state.freshDwellRequired
    ? input.configuration.reacquireDwellMs
    : input.configuration.initialDwellMs
  if (state.dwellStartedAt === null) state.dwellStartedAt = input.time
  const elapsed = input.time - state.dwellStartedAt
  if (elapsed < requiredDwell) {
    if (!preserveInterruptionReason) {
      state.visibilityReason = 'automatic'
    }
    state.phase = state.freshDwellRequired ? 'reacquire-dwell' : 'dwelling'
    return output(state, false)
  }

  state.revealLatched = true
  if (!preserveInterruptionReason) {
    state.visibilityReason = 'automatic'
  }
  state.freshDwellRequired = false
  const revealStartedAt = state.dwellStartedAt + requiredDwell
  state.dwellStartedAt = null
  startShowing(state, revealStartedAt, input.configuration.transitionMs)
  advanceTransition(state, input.time, input.configuration.transitionMs)
  return output(state, state.phase === 'visible')
}

function applyTrackingLoss(
  state: RevealState,
  time: number,
  graceMs: number,
): void {
  if (!state.trackingLost) {
    state.trackingLost = true
    state.lossStartedAt = time
    state.freshDwellRequired = true
    state.dwellStartedAt = null
    state.revealLatched = false
  }
  const elapsed = time - (state.lossStartedAt ?? time)
  if (state.opacity > 0 && state.lastValidAnchorPose !== null && elapsed < graceMs) {
    state.anchorPose = state.lastValidAnchorPose
    state.phase = 'tracking-grace'
    state.transitionStartedAt = null
    return
  }
  hideImmediately(state)
}

function startShowing(
  state: RevealState,
  time: number,
  transitionMs: number,
): void {
  if (state.phase === 'visible') {
    state.opacity = 1
    return
  }
  if (state.phase !== 'showing') {
    state.phase = 'showing'
    state.transitionStartedAt = time
    state.transitionFromOpacity = state.opacity
  }
  advanceTransition(state, time, transitionMs)
}

function startHiding(
  state: RevealState,
  time: number,
  transitionMs: number,
): void {
  if (state.opacity <= 0) {
    hideImmediately(state)
    return
  }
  if (state.phase !== 'hiding') {
    state.phase = 'hiding'
    state.transitionStartedAt = time
    state.transitionFromOpacity = state.opacity
  }
  advanceTransition(state, time, transitionMs)
}

function advanceTransition(
  state: RevealState,
  time: number,
  transitionMs: number,
): void {
  if (
    (state.phase !== 'showing' && state.phase !== 'hiding') ||
    state.transitionStartedAt === null
  ) {
    return
  }
  const progress =
    transitionMs === 0
      ? 1
      : Math.min(1, Math.max(0, (time - state.transitionStartedAt) / transitionMs))
  if (state.phase === 'showing') {
    state.opacity = mix(state.transitionFromOpacity, 1, progress)
    if (progress === 1) {
      state.phase = 'visible'
      state.transitionStartedAt = null
      state.transitionFromOpacity = 1
    }
  } else {
    state.opacity = mix(state.transitionFromOpacity, 0, progress)
    if (progress === 1) hideImmediately(state)
  }
}

function resetForFreshAcquisition(state: RevealState): void {
  state.boundSourceId = null
  state.trackingLost = false
  state.freshDwellRequired = true
  state.dwellStartedAt = null
  state.revealLatched = false
  state.lossStartedAt = null
  state.anchorPose = null
  state.lastValidAnchorPose = null
}

function hideImmediately(state: RevealState): void {
  state.phase = 'hidden'
  state.opacity = 0
  state.transitionStartedAt = null
  state.transitionFromOpacity = 0
}

function output(state: RevealState, interactive: boolean): RevealOutput {
  return Object.freeze({
    phase: state.phase,
    opacity: state.opacity,
    visible: state.opacity > 0,
    interactive,
    anchorPose: state.anchorPose,
    visibilityReason: state.visibilityReason,
  })
}

function mix(from: number, to: number, progress: number): number {
  return from + (to - from) * progress
}
