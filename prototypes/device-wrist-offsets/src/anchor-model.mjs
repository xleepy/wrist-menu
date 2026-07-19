// THROWAWAY PROTOTYPE LOGIC. Do not ship this module as package code.
//
// Question: which per-device/per-profile wrist offsets and fail-closed tracking rules
// remain comfortable on physical Quest hardware? Candidate A is the provisional Quest 2
// default; the remaining values are calibration hypotheses. The pure state transition
// boundary is deliberately production-shaped so deterministic traces and the WebXR harness
// exercise the same rules.

export const PROVISIONAL_REVEAL_TUNING = Object.freeze({
  enterAngleDeg: 35,
  exitAngleDeg: 50,
  initialDwellMs: 300,
  reacquireDwellMs: 200,
  visualGraceMs: 250,
})

export const DEVICE_TARGETS = Object.freeze([
  Object.freeze({ id: 'quest-2', label: 'Meta Quest 2 (provisional evidence lane)' }),
  Object.freeze({ id: 'quest-3', label: 'Meta Quest 3' }),
  Object.freeze({ id: 'quest-3s', label: 'Meta Quest 3S' }),
  Object.freeze({ id: 'other', label: 'Other / diagnostic only' }),
])

// Candidate geometry is intentionally small and explicit. `mirrorX` and `mirrorRoll`
// turn one hypothesis into handedness-specific concrete offsets. Device defaults require
// an explicit device target because Meta's compatibility profile aliases overlap devices.
export const PROFILE_PRESETS = deepFreeze([
  {
    id: 'tracked-hand-raw-wrist',
    label: 'Tracked hand: raw wrist joint',
    sourceKind: 'hand',
    profilePatterns: ['generic-hand', 'generic-hand-select', 'generic-hand-select-grasp'],
    autoMatch: true,
    hypothesis: 'Use the standard wrist joint with no translation or corrective rotation.',
    offset: {
      translationMeters: [0, 0, 0],
      rotationDegrees: [0, 0, 0],
      mirrorX: false,
      mirrorRoll: false,
    },
  },
  {
    id: 'tracked-hand-palm-clearance',
    label: 'Tracked hand: 18 mm palm clearance',
    sourceKind: 'hand',
    profilePatterns: ['generic-hand', 'generic-hand-select', 'generic-hand-select-grasp'],
    autoMatch: false,
    hypothesis: 'Move 18 mm along wrist local -Y and 30 mm toward the palm to reduce clipping.',
    offset: {
      translationMeters: [0, -0.018, -0.03],
      rotationDegrees: [0, 0, 0],
      mirrorX: false,
      mirrorRoll: false,
    },
  },
  {
    id: 'controller-neutral-grip-proxy',
    label: 'Controller: neutral grip proxy',
    sourceKind: 'controller',
    profilePatterns: [
      'oculus-touch',
      'oculus-touch-v2',
      'oculus-touch-v3',
      'meta-quest-touch-pro',
      'generic-trigger-squeeze-thumbstick',
    ],
    autoMatch: true,
    hypothesis: 'Place the approximate wrist 90 mm along grip local +Y with no lateral bias.',
    offset: {
      translationMeters: [0, 0.09, 0],
      rotationDegrees: [0, 0, 0],
      mirrorX: false,
      mirrorRoll: false,
    },
  },
  {
    id: 'quest-2-touch-candidate-a',
    label: 'Quest 2 Touch candidate A: inward / 96 mm (provisional default)',
    sourceKind: 'controller',
    profilePatterns: ['oculus-touch-v2'],
    autoMatch: false,
    defaultDeviceTargets: ['quest-2'],
    hypothesis: 'Mirror 20 mm of lateral bias and 8 degrees of roll around a 96 mm arm offset.',
    offset: {
      translationMeters: [0.02, 0.096, 0.008],
      rotationDegrees: [0, 0, 8],
      mirrorX: true,
      mirrorRoll: true,
    },
  },
  {
    id: 'touch-plus-candidate-a',
    label: 'Touch Plus candidate A: inward / 90 mm',
    sourceKind: 'controller',
    profilePatterns: ['oculus-touch-v3', 'meta-quest-touch-plus'],
    autoMatch: false,
    hypothesis: 'Mirror 25 mm of lateral bias and 10 degrees of roll around a 90 mm arm offset.',
    offset: {
      translationMeters: [0.025, 0.09, 0.01],
      rotationDegrees: [0, 0, 10],
      mirrorX: true,
      mirrorRoll: true,
    },
  },
  {
    id: 'touch-plus-candidate-b',
    label: 'Touch Plus candidate B: long / 108 mm',
    sourceKind: 'controller',
    profilePatterns: ['oculus-touch-v3', 'meta-quest-touch-plus'],
    autoMatch: false,
    hypothesis: 'Use a longer arm offset, slight rear shift, and a smaller mirrored roll.',
    offset: {
      translationMeters: [0.012, 0.108, -0.012],
      rotationDegrees: [0, 0, 6],
      mirrorX: true,
      mirrorRoll: true,
    },
  },
])

export function presetsForSourceKind(sourceKind) {
  return PROFILE_PRESETS.filter((preset) => preset.sourceKind === sourceKind)
}

export function isPresetDefaultForDevice(preset, deviceTarget) {
  return preset.defaultDeviceTargets?.includes(deviceTarget) ?? false
}

export function resolvePreset({
  deviceTarget = null,
  sourceKind,
  profiles = [],
  requestedPresetId = null,
}) {
  const requested = PROFILE_PRESETS.find(
    (preset) => preset.id === requestedPresetId && preset.sourceKind === sourceKind,
  )
  if (requested) return requested

  const deviceDefault = PROFILE_PRESETS.find(
    (preset) =>
      preset.sourceKind === sourceKind &&
      isPresetDefaultForDevice(preset, deviceTarget),
  )
  if (deviceDefault) return deviceDefault

  const matched = PROFILE_PRESETS.find(
    (preset) =>
      preset.sourceKind === sourceKind &&
      preset.autoMatch &&
      preset.profilePatterns.some((pattern) => profiles.includes(pattern)),
  )
  if (matched) return matched

  return presetsForSourceKind(sourceKind)[0]
}

export function materializeOffset(presetOrOffset, handedness) {
  const source = presetOrOffset.offset ?? presetOrOffset
  const sideSign = handedness === 'right' ? -1 : 1
  const translation = [...source.translationMeters]
  const rotation = [...source.rotationDegrees]

  if (source.mirrorX) translation[0] *= sideSign
  if (source.mirrorRoll) rotation[2] *= sideSign

  return {
    translationMeters: translation,
    rotationDegrees: rotation,
  }
}

export function createAnchorState() {
  return {
    visibility: 'visible',
    hasEverBound: false,
    sourceKey: null,
    sourceKind: null,
    handedness: null,
    profiles: [],
    confidence: 'none',
    status: 'unbound',
    revealLatched: false,
    freshDwellRequired: false,
    dwellStartedAtMs: null,
    lostAtMs: null,
    graceUntilMs: null,
    lastValidAtMs: null,
    lastValidAnchorPose: null,
    anchorPose: null,
    facingAngleDeg: null,
    visible: false,
    interactive: false,
    heldPose: false,
    graceRemainingMs: null,
    dwellRemainingMs: null,
    transition: 'initialised',
    cancellationReason: null,
  }
}

export function advanceAnchorState(previous, frame, configuration) {
  const tuning = { ...PROVISIONAL_REVEAL_TUNING, ...configuration.tuning }
  const next = cloneState(previous)
  next.visibility = frame.visibility
  next.transition = 'steady'
  next.cancellationReason = null
  next.graceRemainingMs = null
  next.dwellRemainingMs = null

  if (frame.visibility === 'hidden') {
    return suspend(next, 'suspended-hidden', 'session-hidden', true)
  }

  if (frame.visibility === 'visible-blurred') {
    next.revealLatched = false
    next.freshDwellRequired = true
    next.dwellStartedAtMs = null
    next.status = 'suspended-blurred'
    next.interactive = false
    next.heldPose = Boolean(next.anchorPose && previous.visible)
    next.visible = next.heldPose
    next.transition = 'session-visible-blurred'
    next.cancellationReason = 'xr-lifecycle-interruption'
    return next
  }

  const visibilityResumed = previous.visibility !== 'visible' && frame.visibility === 'visible'
  if (visibilityResumed) {
    next.revealLatched = false
    next.freshDwellRequired = true
    next.dwellStartedAtMs = null
    next.anchorPose = null
    next.lastValidAnchorPose = null
    next.transition = 'session-visible-reacquire'
    next.cancellationReason = 'xr-lifecycle-interruption'
  }

  const source = frame.source
  const poseRequired = configuration.activationMode === 'automatic'
    ? source?.pose && frame.viewerPosition
    : source?.pose

  if (!source || !poseRequired) {
    return applyPoseLoss(next, previous, frame.timeMs, tuning.visualGraceMs)
  }

  const firstBinding = previous.sourceKey === null
  const sourceReplaced = previous.sourceKey !== null && previous.sourceKey !== source.key
  const reacquired =
    !sourceReplaced &&
    previous.sourceKey === source.key &&
    ['grace', 'lost', 'suspended-hidden', 'suspended-blurred'].includes(previous.status)
  const cachedGracePose = previous.heldPose ? previous.anchorPose : null

  next.hasEverBound = true
  next.sourceKey = source.key
  next.sourceKind = source.kind
  next.handedness = source.handedness
  next.profiles = [...source.profiles]
  next.confidence = source.pose.emulatedPosition ? 'low' : 'high'

  const offset = configuration.offset ?? materializeOffset(
    resolvePreset({
      deviceTarget: configuration.deviceTarget,
      sourceKind: source.kind,
      profiles: source.profiles,
      requestedPresetId: configuration.presetId,
    }),
    source.handedness,
  )
  const anchorPose = composeAnchorPose(source.pose, source.kind, source.handedness, offset)
  next.anchorPose = anchorPose
  next.lastValidAnchorPose = anchorPose
  next.lastValidAtMs = frame.timeMs
  next.lostAtMs = null
  next.heldPose = false
  next.facingAngleDeg = frame.viewerPosition
    ? facingAngleDegrees(source.pose, source.kind, source.handedness, frame.viewerPosition)
    : null

  if (sourceReplaced) {
    next.graceUntilMs = null
    next.revealLatched = false
    next.freshDwellRequired = true
    next.dwellStartedAtMs = null
    next.visible = false
    next.interactive = false
    next.transition = 'source-replaced'
    next.cancellationReason = 'webxr-source-replacement'
  } else if (reacquired || visibilityResumed) {
    next.revealLatched = false
    next.freshDwellRequired = true
    next.dwellStartedAtMs = null
    next.transition = 'pose-reacquired'
    next.cancellationReason = 'tracking-reacquisition'
  } else if (firstBinding) {
    next.transition = 'source-bound'
  }

  if (configuration.activationMode === 'calibration') {
    next.graceUntilMs = null
    next.status = next.confidence === 'high' ? 'calibrating' : 'low-confidence'
    next.visible = true
    next.interactive = false
    next.revealLatched = false
    next.freshDwellRequired = false
    next.dwellStartedAtMs = null
    return next
  }

  if (next.confidence !== 'high' || source.handedness === 'none') {
    next.status = 'low-confidence'
    next.visible = false
    next.interactive = false
    next.revealLatched = false
    next.dwellStartedAtMs = null
    next.transition = source.handedness === 'none' ? 'unsupported-handedness' : 'emulated-position'
    next.cancellationReason = 'automatic-activation-ineligible'
    return holdRemainingVisualGrace(next, cachedGracePose, frame.timeMs)
  }

  const evaluated = evaluateAutomaticReveal(next, previous, frame.timeMs, tuning, {
    sourceReplaced,
    reacquired: reacquired || visibilityResumed,
  })
  return holdRemainingVisualGrace(evaluated, cachedGracePose, frame.timeMs)
}

export function composeAnchorPose(sourcePose, sourceKind, handedness, offset) {
  const sourceOrientation = normalizeQuaternion(sourcePose.orientation)
  const offsetOrientation = quaternionFromEulerDegrees(offset.rotationDegrees)
  const surfaceBasis = sourceKind === 'hand'
    ? quaternionFromEulerDegrees([90, 0, 0])
    : quaternionFromEulerDegrees([0, handedness === 'left' ? 90 : -90, 0])
  const orientation = normalizeQuaternion(
    multiplyQuaternions(multiplyQuaternions(sourceOrientation, offsetOrientation), surfaceBasis),
  )
  const translated = rotateVector(sourceOrientation, offset.translationMeters)
  const position = sourcePose.position.map((value, index) => value + translated[index])

  return {
    position,
    orientation,
    surfaceNormal: rotateVector(orientation, [0, 0, 1]),
  }
}

export function facingAngleDegrees(sourcePose, sourceKind, handedness, viewerPosition) {
  const localPalmNormal = sourceKind === 'hand'
    ? [0, -1, 0]
    : handedness === 'left'
      ? [1, 0, 0]
      : [-1, 0, 0]
  const palmNormal = normalizeVector(rotateVector(sourcePose.orientation, localPalmNormal))
  const towardViewer = normalizeVector(
    viewerPosition.map((value, index) => value - sourcePose.position[index]),
  )
  const dot = clamp(dotProduct(palmNormal, towardViewer), -1, 1)
  return (Math.acos(dot) * 180) / Math.PI
}

export function snapshotState(state) {
  return {
    status: state.status,
    sourceKey: state.sourceKey,
    sourceKind: state.sourceKind,
    handedness: state.handedness,
    confidence: state.confidence,
    visible: state.visible,
    interactive: state.interactive,
    heldPose: state.heldPose,
    facingAngleDeg: roundMaybe(state.facingAngleDeg, 1),
    dwellRemainingMs: state.dwellRemainingMs,
    graceRemainingMs: state.graceRemainingMs,
    transition: state.transition,
    cancellationReason: state.cancellationReason,
    anchorPosition: state.anchorPose?.position.map((value) => roundMaybe(value, 4)) ?? null,
  }
}

function evaluateAutomaticReveal(next, previous, timeMs, tuning, interruption) {
  const angle = next.facingAngleDeg
  const insideEnter = angle !== null && angle <= tuning.enterAngleDeg
  const insideExit = angle !== null && angle <= tuning.exitAngleDeg

  if (!interruption.sourceReplaced && !interruption.reacquired && previous.revealLatched && insideExit) {
    next.revealLatched = true
    next.status = 'revealed'
    next.visible = true
    next.interactive = true
    next.dwellStartedAtMs = null
    next.transition = 'inside-exit-hysteresis'
    return next
  }

  next.revealLatched = false
  next.visible = false
  next.interactive = false

  if (!insideEnter) {
    next.status = 'outside-enter-angle'
    next.dwellStartedAtMs = null
    next.dwellRemainingMs = null
    if (next.transition === 'steady') next.transition = 'outside-enter-angle'
    return next
  }

  const requiredDwellMs = next.freshDwellRequired
    ? tuning.reacquireDwellMs
    : tuning.initialDwellMs
  if (next.dwellStartedAtMs === null || interruption.sourceReplaced || interruption.reacquired) {
    next.dwellStartedAtMs = timeMs
  }

  const elapsed = timeMs - next.dwellStartedAtMs
  next.dwellRemainingMs = Math.max(0, requiredDwellMs - elapsed)
  next.status = next.freshDwellRequired ? 'reacquire-dwell' : 'initial-dwell'

  if (elapsed < requiredDwellMs) {
    if (next.transition === 'steady') next.transition = 'dwell-progress'
    return next
  }

  next.revealLatched = true
  next.freshDwellRequired = false
  next.dwellStartedAtMs = null
  next.dwellRemainingMs = null
  next.status = 'revealed'
  next.visible = true
  next.interactive = true
  next.transition = 'dwell-satisfied'
  return next
}

function applyPoseLoss(next, previous, timeMs, graceMs) {
  if (previous.sourceKey === null && !previous.lastValidAnchorPose) {
    next.status = 'unbound'
    next.visible = false
    next.interactive = false
    next.heldPose = false
    next.transition = 'awaiting-source-pose'
    return next
  }

  const lossStartedAt = previous.lostAtMs ?? timeMs
  const graceUntilMs = previous.graceUntilMs ?? lossStartedAt + graceMs
  next.lostAtMs = lossStartedAt
  next.graceUntilMs = graceUntilMs
  next.revealLatched = false
  next.freshDwellRequired = true
  next.dwellStartedAtMs = null
  next.interactive = false
  next.cancellationReason = 'tracking-lost'
  next.anchorPose = previous.lastValidAnchorPose

  if (previous.visible && previous.lastValidAnchorPose && timeMs < graceUntilMs) {
    next.status = 'grace'
    next.visible = true
    next.heldPose = true
    next.graceRemainingMs = Math.max(0, graceUntilMs - timeMs)
    next.transition = previous.status === 'grace' ? 'visual-grace-progress' : 'tracking-lost-grace'
    return next
  }

  next.status = 'lost'
  next.visible = false
  next.heldPose = false
  next.graceRemainingMs = null
  next.graceUntilMs = null
  next.transition = previous.status === 'lost' ? 'pose-still-lost' : 'visual-grace-expired'
  return next
}

function suspend(next, status, transition, clearPose) {
  next.status = status
  next.revealLatched = false
  next.freshDwellRequired = true
  next.dwellStartedAtMs = null
  next.visible = false
  next.interactive = false
  next.heldPose = false
  next.transition = transition
  next.cancellationReason = 'xr-lifecycle-interruption'
  if (clearPose) {
    next.anchorPose = null
    next.lastValidAnchorPose = null
    next.graceUntilMs = null
  }
  return next
}

function holdRemainingVisualGrace(next, cachedGracePose, timeMs) {
  if (next.visible && next.interactive) {
    next.graceUntilMs = null
    next.heldPose = false
    next.graceRemainingMs = null
    return next
  }

  if (cachedGracePose && next.graceUntilMs !== null && timeMs < next.graceUntilMs) {
    next.anchorPose = clonePose(cachedGracePose)
    next.visible = true
    next.interactive = false
    next.heldPose = true
    next.graceRemainingMs = Math.max(0, next.graceUntilMs - timeMs)
    next.transition = `${next.transition}+visual-grace`
    return next
  }

  next.graceUntilMs = null
  next.heldPose = false
  next.graceRemainingMs = null
  return next
}

function cloneState(state) {
  return {
    ...state,
    profiles: [...state.profiles],
    anchorPose: clonePose(state.anchorPose),
    lastValidAnchorPose: clonePose(state.lastValidAnchorPose),
  }
}

function clonePose(pose) {
  if (!pose) return null
  return {
    position: [...pose.position],
    orientation: [...pose.orientation],
    surfaceNormal: [...pose.surfaceNormal],
  }
}

function quaternionFromEulerDegrees([xDegrees, yDegrees, zDegrees]) {
  const x = (xDegrees * Math.PI) / 180
  const y = (yDegrees * Math.PI) / 180
  const z = (zDegrees * Math.PI) / 180
  const qx = [Math.sin(x / 2), 0, 0, Math.cos(x / 2)]
  const qy = [0, Math.sin(y / 2), 0, Math.cos(y / 2)]
  const qz = [0, 0, Math.sin(z / 2), Math.cos(z / 2)]
  return normalizeQuaternion(multiplyQuaternions(multiplyQuaternions(qx, qy), qz))
}

function multiplyQuaternions([ax, ay, az, aw], [bx, by, bz, bw]) {
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ]
}

function normalizeQuaternion(quaternion) {
  const length = Math.hypot(...quaternion) || 1
  return quaternion.map((value) => value / length)
}

function rotateVector(quaternion, vector) {
  const [x, y, z, w] = normalizeQuaternion(quaternion)
  const [vx, vy, vz] = vector
  const tx = 2 * (y * vz - z * vy)
  const ty = 2 * (z * vx - x * vz)
  const tz = 2 * (x * vy - y * vx)
  return [
    vx + w * tx + (y * tz - z * ty),
    vy + w * ty + (z * tx - x * tz),
    vz + w * tz + (x * ty - y * tx),
  ]
}

function normalizeVector(vector) {
  const length = Math.hypot(...vector) || 1
  return vector.map((value) => value / length)
}

function dotProduct(left, right) {
  return left.reduce((total, value, index) => total + value * right[index], 0)
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value))
}

function roundMaybe(value, digits) {
  if (value === null || value === undefined) return null
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    Object.values(value).forEach(deepFreeze)
  }
  return value
}
