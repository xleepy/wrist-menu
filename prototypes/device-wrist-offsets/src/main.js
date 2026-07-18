import * as THREE from 'three'
import { VRButton } from 'three/addons/webxr/VRButton.js'
import {
  DEVICE_TARGETS,
  PROFILE_PRESETS,
  PROVISIONAL_REVEAL_TUNING,
  advanceAnchorState,
  createAnchorState,
  materializeOffset,
  presetsForSourceKind,
  snapshotState,
} from './anchor-model.mjs'
import { captureBrowserErrors, createVrTestLogger } from './vr-test-logger.mjs'
import './style.css'

const prototypeIdentity = Object.freeze({
  issue: 'https://github.com/xleepy/wrist-menu/issues/12',
  branch: 'prototype/issue-12-device-wrist-offsets',
  artifact: 'prototypes/device-wrist-offsets',
})

const vrTestLogger = import.meta.env.DEV
  ? createVrTestLogger({
      prototype: prototypeIdentity,
      userAgent: navigator.userAgent,
      secureContext: window.isSecureContext,
    })
  : null
if (vrTestLogger) {
  captureBrowserErrors(vrTestLogger)
  window.__VR_TEST_LOG__ = vrTestLogger.record
}

const elements = Object.fromEntries([
  'device-target', 'os-version', 'browser-version', 'run-label', 'source-kind',
  'menu-wrist', 'activation-mode', 'profile-preset', 'preset-status',
  'preset-hypothesis', 'offset-x', 'offset-y', 'offset-z', 'rotation-x',
  'rotation-y', 'rotation-z', 'grace-ms', 'reacquire-ms', 'probe-haptics',
  'state-readout', 'state-dot', 'condition', 'verdict', 'observation-note',
  'record-observation', 'copy-evidence', 'clear-run', 'copy-status',
  'observation-count', 'event-log', 'xr-entry', 'canvas-shell',
].map((id) => [id, document.getElementById(id)]))

for (const device of DEVICE_TARGETS) {
  elements['device-target'].append(new Option(device.label, device.id))
}
elements['device-target'].value = 'quest-2'

let anchorState = createAnchorState()
let concreteOffset = null
let pendingSelection = null
let activeSession = null
let activeSourceSnapshot = null
let lastStateSignature = ''
let lastPanelSignature = ''
let lastUiRenderAt = -Infinity
let nextSourceId = 1
const sourceIds = new WeakMap()
const sourceSnapshots = new Map()

const run = {
  startedAt: new Date().toISOString(),
  events: [],
  observations: [],
  hapticProbes: [],
}

populatePresetOptions()
applySelectedPreset('prototype-initialised')
wireControls()

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x081019)
scene.fog = new THREE.Fog(0x081019, 3, 9)

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.01, 30)
camera.position.set(0, 1.55, 2.2)
camera.lookAt(0, 1.25, 0)

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.xr.enabled = true
elements['canvas-shell'].append(renderer.domElement)

scene.add(new THREE.HemisphereLight(0xbde8ff, 0x15202b, 2.5))
const grid = new THREE.GridHelper(8, 32, 0x225577, 0x172432)
scene.add(grid)

const panelTextureCanvas = document.createElement('canvas')
panelTextureCanvas.width = 768
panelTextureCanvas.height = 480
const panelTexture = new THREE.CanvasTexture(panelTextureCanvas)
panelTexture.colorSpace = THREE.SRGBColorSpace
panelTexture.minFilter = THREE.LinearFilter

const panelMaterial = new THREE.MeshBasicMaterial({
  map: panelTexture,
  transparent: true,
  opacity: 1,
  side: THREE.DoubleSide,
  depthTest: false,
})
const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.19, 0.119), panelMaterial)
panel.renderOrder = 20

const panelBack = new THREE.Mesh(
  new THREE.PlaneGeometry(0.198, 0.127),
  new THREE.MeshBasicMaterial({ color: 0x4d9aba, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthTest: false }),
)
panelBack.position.z = -0.0015
panelBack.renderOrder = 19

const anchorGroup = new THREE.Group()
anchorGroup.add(panelBack, panel, new THREE.AxesHelper(0.085))
scene.add(anchorGroup)

const previewMarker = new THREE.Mesh(
  new THREE.IcosahedronGeometry(0.04, 1),
  new THREE.MeshBasicMaterial({ color: 0x72d8ff, wireframe: true }),
)
previewMarker.position.set(0, 1.25, 0)
scene.add(previewMarker)

const vrButton = VRButton.createButton(renderer, {
  optionalFeatures: ['hand-tracking', 'local-floor'],
})
elements['xr-entry'].append(vrButton)

renderer.xr.addEventListener('sessionstart', onSessionStart)
renderer.xr.addEventListener('sessionend', onSessionEnd)
renderer.setAnimationLoop(renderFrame)
window.addEventListener('resize', resize)

drawPanelTexture()
renderStateReadout()
renderEventLog()
logEvent('prototype-ready', {
  secureContext: window.isSecureContext,
  webxrAvailable: Boolean(navigator.xr),
})

function wireControls() {
  elements['source-kind'].addEventListener('change', () => {
    populatePresetOptions()
    applySelectedPreset('anchor-source-changed')
    resetForConfigurationChange('anchor-source-changed')
  })
  elements['menu-wrist'].addEventListener('change', () => {
    applySelectedPreset('menu-wrist-changed')
    resetForConfigurationChange('menu-wrist-changed')
  })
  elements['activation-mode'].addEventListener('change', () => {
    resetForConfigurationChange('activation-mode-changed')
  })
  elements['profile-preset'].addEventListener('change', () => {
    applySelectedPreset('profile-preset-changed')
    resetForConfigurationChange('profile-preset-changed')
  })

  for (const id of ['offset-x', 'offset-y', 'offset-z', 'rotation-x', 'rotation-y', 'rotation-z']) {
    elements[id].addEventListener('input', () => {
      concreteOffset = readConcreteOffset()
      logConfigurationChange('offset-edited')
    })
  }

  for (const id of ['grace-ms', 'reacquire-ms']) {
    elements[id].addEventListener('change', () => logConfigurationChange('timing-edited'))
  }

  elements['record-observation'].addEventListener('click', recordObservation)
  elements['copy-evidence'].addEventListener('click', copyEvidence)
  elements['clear-run'].addEventListener('click', clearRun)
}

function populatePresetOptions() {
  const sourceKind = elements['source-kind'].value
  const previousValue = elements['profile-preset'].value
  elements['profile-preset'].replaceChildren()
  for (const preset of presetsForSourceKind(sourceKind)) {
    elements['profile-preset'].append(new Option(preset.label, preset.id))
  }
  const stillAvailable = presetsForSourceKind(sourceKind).some((preset) => preset.id === previousValue)
  if (stillAvailable) elements['profile-preset'].value = previousValue
}

function applySelectedPreset(reason) {
  const preset = selectedPreset()
  const handedness = elements['menu-wrist'].value
  concreteOffset = materializeOffset(preset, handedness)
  const [x, y, z] = concreteOffset.translationMeters
  const [rx, ry, rz] = concreteOffset.rotationDegrees
  elements['offset-x'].value = x
  elements['offset-y'].value = y
  elements['offset-z'].value = z
  elements['rotation-x'].value = rx
  elements['rotation-y'].value = ry
  elements['rotation-z'].value = rz
  elements['preset-hypothesis'].textContent = `${preset.hypothesis} Actual XRInputSource.profiles are captured in evidence; this candidate is not a default.`
  elements['preset-status'].textContent = preset.autoMatch ? 'neutral baseline · unvalidated' : 'manual candidate · unvalidated'
  logConfigurationChange(reason)
}

function selectedPreset() {
  return PROFILE_PRESETS.find((preset) => preset.id === elements['profile-preset'].value)
    ?? presetsForSourceKind(elements['source-kind'].value)[0]
}

function readConcreteOffset() {
  return {
    translationMeters: [
      finiteNumber(elements['offset-x'].value),
      finiteNumber(elements['offset-y'].value),
      finiteNumber(elements['offset-z'].value),
    ],
    rotationDegrees: [
      finiteNumber(elements['rotation-x'].value),
      finiteNumber(elements['rotation-y'].value),
      finiteNumber(elements['rotation-z'].value),
    ],
  }
}

function currentConfiguration() {
  return {
    deviceTarget: elements['device-target'].value,
    sourceKind: elements['source-kind'].value,
    menuWrist: elements['menu-wrist'].value,
    activationMode: elements['activation-mode'].value,
    presetId: selectedPreset().id,
    offset: structuredClone(concreteOffset),
    tuning: {
      ...PROVISIONAL_REVEAL_TUNING,
      visualGraceMs: nonNegativeNumber(elements['grace-ms'].value),
      reacquireDwellMs: nonNegativeNumber(elements['reacquire-ms'].value),
    },
  }
}

function onSessionStart() {
  activeSession = renderer.xr.getSession()
  anchorState = createAnchorState()
  activeSession.addEventListener('inputsourceschange', onInputSourcesChange)
  activeSession.addEventListener('visibilitychange', onVisibilityChange)
  activeSession.addEventListener('selectstart', onSelectStart)
  activeSession.addEventListener('selectend', onSelectEnd)
  activeSession.addEventListener('select', onSelect)
  logEvent('xr-session-start', {
    frameRate: activeSession.frameRate ?? null,
    enabledFeatures: activeSession.enabledFeatures ? [...activeSession.enabledFeatures] : null,
    visibilityState: activeSession.visibilityState,
  })
}

function onSessionEnd() {
  cancelPendingSelection('session-ended')
  logEvent('xr-session-end', {})
  activeSession = null
  activeSourceSnapshot = null
  anchorState = createAnchorState()
}

function onInputSourcesChange(event) {
  const added = [...event.added].map(captureInputSource)
  const removed = [...event.removed].map(captureInputSource)
  if (pendingSelection && removed.some((source) => source.key === pendingSelection.sourceKey)) {
    cancelPendingSelection('selection-source-removed')
  }
  logEvent('input-sources-change', { added, removed })
}

function onVisibilityChange() {
  logEvent('xr-visibility-change', { visibilityState: activeSession?.visibilityState ?? null })
}

function onSelectStart(event) {
  const source = captureInputSource(event.inputSource)
  const oppositeHand = source.handedness !== elements['menu-wrist'].value && source.handedness !== 'none'
  if (!anchorState.interactive || !oppositeHand) {
    logEvent('selection-not-armed', {
      sourceKey: source.key,
      reason: anchorState.interactive ? 'not-opposite-handed' : 'anchor-non-interactive',
    })
    return
  }

  pendingSelection = { sourceKey: source.key, startedAt: performance.now() }
  logEvent('selection-armed', { sourceKey: source.key })
}

function onSelectEnd(event) {
  const sourceKey = sourceKeyFor(event.inputSource)
  if (!pendingSelection || pendingSelection.sourceKey !== sourceKey) return
  if (!anchorState.interactive) {
    cancelPendingSelection('anchor-became-non-interactive')
    return
  }
  logEvent('selection-commit-probe', { sourceKey })
  pendingSelection = null
}

async function onSelect(event) {
  if (!elements['probe-haptics'].checked) return
  await probeHaptic(event.inputSource)
}

function renderFrame(timeMs, xrFrame) {
  if (xrFrame && activeSession) {
    const referenceSpace = renderer.xr.getReferenceSpace()
    const viewerPose = referenceSpace ? xrFrame.getViewerPose(referenceSpace) : null
    const viewerPosition = viewerPose ? pointToArray(viewerPose.transform.position) : null
    const inputSource = findAnchorInputSource(activeSession.inputSources)
    const source = inputSource && referenceSpace
      ? sampleInputSource(xrFrame, referenceSpace, inputSource)
      : null

    activeSourceSnapshot = inputSource ? captureInputSource(inputSource) : null
    anchorState = advanceAnchorState(anchorState, {
      timeMs,
      visibility: activeSession.visibilityState ?? 'visible',
      viewerPosition,
      source,
    }, currentConfiguration())

    if (!anchorState.interactive && pendingSelection) {
      cancelPendingSelection(anchorState.cancellationReason ?? 'anchor-non-interactive')
    }

    applyAnchorState()
    recordStateTransition(timeMs)
  } else {
    renderDesktopPreview(timeMs)
  }

  if (timeMs - lastUiRenderAt > 100) {
    renderStateReadout()
    renderEventLog()
    lastUiRenderAt = timeMs
  }
  renderer.render(scene, camera)
}

function findAnchorInputSource(inputSources) {
  const expectedKind = elements['source-kind'].value
  const wrist = elements['menu-wrist'].value
  return [...inputSources].find((source) => {
    const kind = source.hand ? 'hand' : 'controller'
    return kind === expectedKind && source.handedness === wrist && (kind === 'hand' || source.gripSpace)
  }) ?? null
}

function sampleInputSource(frame, referenceSpace, inputSource) {
  const kind = inputSource.hand ? 'hand' : 'controller'
  const xrPose = kind === 'hand'
    ? frame.getJointPose(inputSource.hand.get('wrist'), referenceSpace)
    : frame.getPose(inputSource.gripSpace, referenceSpace)

  return {
    key: sourceKeyFor(inputSource),
    kind,
    handedness: inputSource.handedness,
    profiles: [...inputSource.profiles],
    pose: xrPose ? {
      position: pointToArray(xrPose.transform.position),
      orientation: quaternionToArray(xrPose.transform.orientation),
      emulatedPosition: Boolean(xrPose.emulatedPosition),
    } : null,
  }
}

function captureInputSource(inputSource) {
  const gamepad = inputSource.gamepad
  const snapshot = {
    key: sourceKeyFor(inputSource),
    handedness: inputSource.handedness,
    kind: inputSource.hand ? 'hand' : 'controller',
    targetRayMode: inputSource.targetRayMode,
    profiles: [...inputSource.profiles],
    hasGripSpace: Boolean(inputSource.gripSpace),
    hasHand: Boolean(inputSource.hand),
    gamepadMapping: gamepad?.mapping ?? null,
    haptics: describeHaptics(gamepad),
    lastSeenAt: new Date().toISOString(),
  }
  sourceSnapshots.set(snapshot.key, snapshot)
  return snapshot
}

function sourceKeyFor(inputSource) {
  if (!sourceIds.has(inputSource)) {
    const kind = inputSource.hand ? 'hand' : 'controller'
    sourceIds.set(inputSource, `${kind}:${inputSource.handedness}:${nextSourceId++}`)
  }
  return sourceIds.get(inputSource)
}

function describeHaptics(gamepad) {
  if (!gamepad) return { available: false, actuatorCount: 0, effects: [] }
  const actuators = [...(gamepad.hapticActuators ?? [])]
  if (gamepad.vibrationActuator && !actuators.includes(gamepad.vibrationActuator)) {
    actuators.push(gamepad.vibrationActuator)
  }
  return {
    available: actuators.some((actuator) => typeof actuator.pulse === 'function' || typeof actuator.playEffect === 'function'),
    actuatorCount: actuators.length,
    effects: [...new Set(actuators.flatMap((actuator) => actuator.effects ?? []))],
  }
}

async function probeHaptic(inputSource) {
  const source = captureInputSource(inputSource)
  const gamepad = inputSource.gamepad
  const actuators = [...(gamepad?.hapticActuators ?? [])]
  if (gamepad?.vibrationActuator && !actuators.includes(gamepad.vibrationActuator)) {
    actuators.push(gamepad.vibrationActuator)
  }
  const actuator = actuators[0]
  const record = {
    at: new Date().toISOString(),
    sourceKey: source.key,
    capability: source.haptics,
    outcome: 'unsupported',
  }

  try {
    if (typeof actuator?.pulse === 'function') {
      const result = await actuator.pulse(0.35, 30)
      record.outcome = result === false ? 'pulse-returned-false' : 'pulse-requested'
    } else if (typeof actuator?.playEffect === 'function') {
      const effect = actuator.effects?.includes('dual-rumble')
        ? 'dual-rumble'
        : actuator.effects?.[0]
      if (effect) {
        const result = await actuator.playEffect(effect, {
          duration: 30,
          strongMagnitude: 0.35,
          weakMagnitude: 0.35,
        })
        record.outcome = result === false ? 'effect-returned-false' : `effect-requested:${effect}`
      }
    }
  } catch (error) {
    record.outcome = `rejected:${error instanceof Error ? error.message : String(error)}`
  }

  run.hapticProbes.push(record)
  logEvent('haptic-probe', record)
}

function applyAnchorState() {
  const pose = anchorState.anchorPose
  anchorGroup.visible = anchorState.visible && Boolean(pose)
  if (pose) {
    anchorGroup.position.fromArray(pose.position)
    anchorGroup.quaternion.fromArray(pose.orientation)
  }

  const isGrace = anchorState.heldPose || anchorState.status === 'grace'
  const isLowConfidence = anchorState.confidence === 'low'
  panelMaterial.opacity = isGrace ? 0.48 : isLowConfidence ? 0.55 : 1
  panelBack.material.color.setHex(isGrace ? 0xe7b85a : isLowConfidence ? 0xe17844 : anchorState.interactive ? 0x56df8b : 0x4d9aba)

  const signature = JSON.stringify([
    anchorState.status,
    anchorState.sourceKey,
    anchorState.handedness,
    anchorState.visible,
    anchorState.interactive,
    anchorState.heldPose,
    anchorState.facingAngleDeg === null ? null : Math.round(anchorState.facingAngleDeg),
    selectedPreset().id,
  ])
  if (signature !== lastPanelSignature) {
    drawPanelTexture()
    lastPanelSignature = signature
  }
}

function drawPanelTexture() {
  const context = panelTextureCanvas.getContext('2d')
  const grace = anchorState.heldPose || anchorState.status === 'grace'
  context.fillStyle = grace ? '#4b3817' : '#0d1b26'
  context.fillRect(0, 0, panelTextureCanvas.width, panelTextureCanvas.height)
  context.strokeStyle = grace ? '#f1c66f' : '#72d8ff'
  context.lineWidth = 12
  context.strokeRect(12, 12, panelTextureCanvas.width - 24, panelTextureCanvas.height - 24)

  context.fillStyle = '#eaf7ff'
  context.font = '700 45px system-ui, sans-serif'
  context.fillText('WRIST CALIBRATION', 48, 78)
  context.font = '600 31px ui-monospace, monospace'
  const lines = [
    `${elements['menu-wrist'].value.toUpperCase()} · ${elements['source-kind'].value.toUpperCase()}`,
    `state  ${anchorState.status}`,
    `pose   ${anchorState.confidence} confidence`,
    `input  ${anchorState.interactive ? 'INTERACTIVE' : 'SAFE / BLOCKED'}`,
    `angle  ${anchorState.facingAngleDeg === null ? '—' : `${anchorState.facingAngleDeg.toFixed(1)}°`}`,
    `preset ${selectedPreset().id}`,
  ]
  lines.forEach((line, index) => context.fillText(line, 48, 150 + index * 50))
  panelTexture.needsUpdate = true
}

function renderDesktopPreview(timeMs) {
  previewMarker.rotation.x = timeMs * 0.0002
  previewMarker.rotation.y = timeMs * 0.0003
  anchorGroup.visible = true
  anchorGroup.position.set(0, 1.35, 0.25)
  anchorGroup.quaternion.identity()
  panelMaterial.opacity = 0.72
  panelBack.material.color.setHex(0x4d9aba)
}

function recordStateTransition(timeMs) {
  const signature = JSON.stringify([
    anchorState.status,
    anchorState.sourceKey,
    anchorState.visible,
    anchorState.interactive,
    anchorState.transition,
    anchorState.cancellationReason,
  ])
  if (signature === lastStateSignature) return
  lastStateSignature = signature
  logEvent('anchor-state', { xrTimeMs: Math.round(timeMs), ...snapshotState(anchorState) })
}

function renderStateReadout() {
  const state = snapshotState(anchorState)
  const profileText = activeSourceSnapshot?.profiles?.join(', ') || '—'
  const hapticText = activeSourceSnapshot
    ? JSON.stringify(activeSourceSnapshot.haptics)
    : '—'
  const rows = {
    status: state.status,
    source: state.sourceKey ?? '—',
    profiles: profileText,
    handedness: state.handedness ?? '—',
    confidence: state.confidence,
    'facing angle': state.facingAngleDeg === null ? '—' : `${state.facingAngleDeg}°`,
    visible: String(state.visible),
    interactive: String(state.interactive),
    'held transform': String(state.heldPose),
    'dwell remaining': state.dwellRemainingMs === null ? '—' : `${state.dwellRemainingMs} ms`,
    'grace remaining': state.graceRemainingMs === null ? '—' : `${state.graceRemainingMs} ms`,
    haptics: hapticText,
    'last cancellation': state.cancellationReason ?? '—',
    'anchor position': state.anchorPosition ? `[${state.anchorPosition.join(', ')}]` : '—',
  }

  elements['state-readout'].replaceChildren(...Object.entries(rows).map(([term, value]) => {
    const container = document.createElement('div')
    const dt = document.createElement('dt')
    const dd = document.createElement('dd')
    dt.textContent = term
    dd.textContent = value
    container.append(dt, dd)
    return container
  }))

  elements['state-dot'].className = `status-dot ${state.interactive ? 'live' : state.visible ? 'warn' : ''}`
  elements['observation-count'].textContent = `${run.observations.length} recorded`
}

function recordObservation() {
  const osVersion = elements['os-version'].value.trim()
  const browserVersion = elements['browser-version'].value.trim()
  const note = elements['observation-note'].value.trim()
  if (!osVersion || !browserVersion) {
    elements['copy-status'].textContent = 'Enter exact Horizon OS and Meta Quest Browser versions before recording.'
    return
  }
  if (!note) {
    elements['copy-status'].textContent = 'Add the physical tester’s own note; the agent cannot supply it.'
    return
  }

  run.observations.push({
    at: new Date().toISOString(),
    condition: elements['condition'].value,
    verdict: elements['verdict'].value,
    note,
    device: {
      target: elements['device-target'].value,
      horizonOsVersion: osVersion,
      browserVersion,
      runLabel: elements['run-label'].value.trim(),
    },
    configuration: currentConfiguration(),
    source: activeSourceSnapshot,
    state: snapshotState(anchorState),
  })
  elements['observation-note'].value = ''
  elements['copy-status'].textContent = 'Observation recorded in memory.'
  logEvent('physical-observation-recorded', {
    condition: elements['condition'].value,
    verdict: elements['verdict'].value,
  })
  renderStateReadout()
}

async function copyEvidence() {
  logEvent('evidence-copy-requested', { observationCount: run.observations.length })
  const evidence = JSON.stringify(buildEvidence(), null, 2)
  try {
    await navigator.clipboard.writeText(evidence)
    elements['copy-status'].textContent = 'Evidence JSON copied. Paste it into issue 12.'
  } catch {
    const fallback = document.createElement('textarea')
    fallback.value = evidence
    document.body.append(fallback)
    fallback.select()
    document.execCommand('copy')
    fallback.remove()
    elements['copy-status'].textContent = 'Evidence JSON copied with the fallback clipboard path.'
  }
}

function buildEvidence() {
  return {
    schemaVersion: 1,
    prototype: prototypeIdentity,
    caveats: [
      'This artifact is a throwaway calibration harness, not production package code.',
      'Candidate offsets are hypotheses until physical feedback accepts them.',
      'Quest 2 evidence is provisional and does not imply a support guarantee.',
      'Quest 3 and Quest 3S remain the version-1 release-device gates.',
    ],
    run: {
      startedAt: run.startedAt,
      copiedAt: new Date().toISOString(),
      label: elements['run-label'].value.trim(),
    },
    device: {
      target: elements['device-target'].value,
      horizonOsVersion: elements['os-version'].value.trim(),
      browserVersion: elements['browser-version'].value.trim(),
    },
    runtime: {
      userAgent: navigator.userAgent,
      secureContext: window.isSecureContext,
      webxrAvailable: Boolean(navigator.xr),
      frameRate: activeSession?.frameRate ?? null,
      enabledFeatures: activeSession?.enabledFeatures ? [...activeSession.enabledFeatures] : null,
    },
    currentConfiguration: currentConfiguration(),
    currentState: snapshotState(anchorState),
    inputSources: [...sourceSnapshots.values()],
    observations: run.observations,
    hapticProbes: run.hapticProbes,
    lifecycleEvents: run.events,
  }
}

function clearRun() {
  run.startedAt = new Date().toISOString()
  run.events.length = 0
  run.observations.length = 0
  run.hapticProbes.length = 0
  sourceSnapshots.clear()
  elements['observation-note'].value = ''
  elements['copy-status'].textContent = 'In-memory evidence cleared. No persisted data existed.'
  logEvent('run-cleared', {})
  renderStateReadout()
}

function resetForConfigurationChange(reason) {
  cancelPendingSelection(reason)
  const hadBinding = anchorState.hasEverBound || anchorState.sourceKey !== null
  anchorState = createAnchorState()
  anchorState.hasEverBound = hadBinding
  anchorState.freshDwellRequired = hadBinding
  anchorState.transition = reason
  lastStateSignature = ''
  logConfigurationChange(reason)
}

function cancelPendingSelection(reason) {
  if (!pendingSelection) return
  logEvent('selection-cancelled', { sourceKey: pendingSelection.sourceKey, reason })
  pendingSelection = null
}

function logConfigurationChange(reason) {
  if (!concreteOffset) return
  logEvent('configuration-change', { reason, configuration: currentConfiguration() })
}

function logEvent(type, details) {
  run.events.push({ at: new Date().toISOString(), type, details })
  if (run.events.length > 300) run.events.splice(0, run.events.length - 300)
  vrTestLogger?.record(`prototype.${type}`, details)
}

function renderEventLog() {
  elements['event-log'].textContent = run.events.slice(-24).map((event) => {
    const time = event.at.slice(11, 23)
    return `${time}  ${event.type}  ${JSON.stringify(event.details)}`
  }).join('\n') || 'No events yet.'
}

function resize() {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
}

function pointToArray(point) {
  return [point.x, point.y, point.z]
}

function quaternionToArray(quaternion) {
  return [quaternion.x, quaternion.y, quaternion.z, quaternion.w]
}

function finiteNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function nonNegativeNumber(value) {
  return Math.max(0, finiteNumber(value))
}
