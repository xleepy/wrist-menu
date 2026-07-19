#!/usr/bin/env node
// Deterministic evidence replay, not a production test suite.

import assert from 'node:assert/strict'

import {
  PROFILE_PRESETS,
  advanceAnchorState,
  composeAnchorPose,
  createAnchorState,
  facingAngleDegrees,
  materializeOffset,
  resolvePreset,
  snapshotState,
} from '../src/anchor-model.mjs'

const identityPose = Object.freeze({
  position: [0, 0, 0],
  orientation: [0, 0, 0, 1],
  emulatedPosition: false,
})

const automatic = Object.freeze({
  activationMode: 'automatic',
  presetId: 'tracked-hand-raw-wrist',
})

printHeading('tracked-hand grace expiry and fresh dwell')
replay([
  sample(0, handSource('hand-left-a'), [0, -1, 0]),
  sample(299, handSource('hand-left-a'), [0, -1, 0]),
  sample(300, handSource('hand-left-a'), [0, -1, 0]),
  sample(310, handSource('hand-left-a', null), [0, -1, 0]),
  sample(559, handSource('hand-left-a', null), [0, -1, 0]),
  sample(560, handSource('hand-left-a', null), [0, -1, 0]),
  sample(600, handSource('hand-left-a'), [0, -1, 0]),
  sample(799, handSource('hand-left-a'), [0, -1, 0]),
  sample(800, handSource('hand-left-a'), [0, -1, 0]),
], automatic)

printHeading('brief tracked-hand occlusion keeps visual-only grace through reacquisition')
replay([
  sample(0, handSource('hand-left-brief'), [0, -1, 0]),
  sample(300, handSource('hand-left-brief'), [0, -1, 0]),
  sample(310, handSource('hand-left-brief', null), [0, -1, 0]),
  sample(360, handSource('hand-left-brief'), [0, -1, 0]),
  sample(559, handSource('hand-left-brief'), [0, -1, 0]),
  sample(560, handSource('hand-left-brief'), [0, -1, 0]),
], automatic)

printHeading('same-handed source object replacement')
replay([
  sample(0, handSource('hand-left-a'), [0, -1, 0]),
  sample(300, handSource('hand-left-a'), [0, -1, 0]),
  sample(310, handSource('hand-left-b'), [0, -1, 0]),
  sample(509, handSource('hand-left-b'), [0, -1, 0]),
  sample(510, handSource('hand-left-b'), [0, -1, 0]),
], automatic)

printHeading('controller confidence and handedness')
replay([
  sample(0, controllerSource('controller-left-a', 'left', true), [1, 0, 0]),
  sample(300, controllerSource('controller-left-a', 'left', true), [1, 0, 0]),
  sample(400, controllerSource('controller-left-b', 'left', false), [1, 0, 0]),
  sample(600, controllerSource('controller-left-b', 'left', false), [1, 0, 0]),
  sample(700, controllerSource('controller-none', 'none', false), [0, 0, -1]),
], {
  activationMode: 'automatic',
  presetId: 'controller-neutral-grip-proxy',
})

printHeading('mirrored Touch Plus candidate transforms')
const candidate = PROFILE_PRESETS.find((preset) => preset.id === 'touch-plus-candidate-a')
for (const handedness of ['left', 'right']) {
  const offset = materializeOffset(candidate, handedness)
  const anchor = composeAnchorPose(identityPose, 'controller', handedness, offset)
  process.stdout.write(`${JSON.stringify({
    handedness,
    offset,
    anchorPosition: anchor.position.map(round4),
    surfaceNormal: anchor.surfaceNormal.map(round4),
  })}\n`)
}

printHeading('tracked-hand handedness-independent wrist basis')
const handPreset = PROFILE_PRESETS.find((preset) => preset.id === 'tracked-hand-palm-clearance')
for (const handedness of ['left', 'right']) {
  const offset = materializeOffset(handPreset, handedness)
  const anchor = composeAnchorPose(identityPose, 'hand', handedness, offset)
  process.stdout.write(`${JSON.stringify({
    handedness,
    offset,
    facingAngleDeg: facingAngleDegrees(identityPose, 'hand', handedness, [0, -1, 0]),
    anchorPosition: anchor.position.map(round4),
    surfaceNormal: anchor.surfaceNormal.map(round4),
  })}\n`)
}

printHeading('configurable profile preset resolution')
const observedQuest2Profiles = [
  'oculus-touch-v3',
  'oculus-touch-v2',
  'oculus-touch',
  'generic-trigger-squeeze-thumbstick',
]

assert.equal(
  resolvePreset({
    deviceTarget: 'quest-2',
    sourceKind: 'controller',
    profiles: observedQuest2Profiles,
  }).id,
  'quest-2-touch-candidate-a',
  'Quest 2 uses controller candidate A as its provisional default',
)
assert.equal(
  resolvePreset({
    deviceTarget: 'quest-3',
    sourceKind: 'controller',
    profiles: observedQuest2Profiles,
  }).id,
  'controller-neutral-grip-proxy',
  'overlapping Touch profile aliases do not promote candidate A on other devices',
)

for (const fixture of [
  { deviceTarget: 'quest-2', sourceKind: 'controller', profiles: observedQuest2Profiles },
  { deviceTarget: 'quest-3', sourceKind: 'controller', profiles: observedQuest2Profiles },
  { sourceKind: 'controller', profiles: ['oculus-touch-v3'] },
  { sourceKind: 'hand', profiles: ['generic-hand-select'] },
  { sourceKind: 'controller', profiles: ['unknown-controller'], requestedPresetId: 'quest-2-touch-candidate-a' },
]) {
  const preset = resolvePreset(fixture)
  process.stdout.write(`${JSON.stringify({ fixture, resolvedPresetId: preset.id })}\n`)
}

function replay(frames, configuration) {
  let state = createAnchorState()
  for (const frame of frames) {
    state = advanceAnchorState(state, frame, configuration)
    process.stdout.write(`${JSON.stringify({ timeMs: frame.timeMs, ...snapshotState(state) })}\n`)
  }
}

function sample(timeMs, source, viewerPosition) {
  return { timeMs, visibility: 'visible', source, viewerPosition }
}

function handSource(key, pose = identityPose) {
  return {
    key,
    kind: 'hand',
    handedness: 'left',
    profiles: ['generic-hand-select'],
    pose,
  }
}

function controllerSource(key, handedness, emulatedPosition) {
  return {
    key,
    kind: 'controller',
    handedness,
    profiles: ['oculus-touch-v3'],
    pose: { ...identityPose, emulatedPosition },
  }
}

function printHeading(label) {
  process.stdout.write(`\n=== ${label} ===\n`)
}

function round4(value) {
  return Math.round(value * 10_000) / 10_000
}
