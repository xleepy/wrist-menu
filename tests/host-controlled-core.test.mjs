import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createWristMenuRuntimeState,
  disposeWristMenuRuntime,
  stepWristMenuRuntime,
  syncWristMenuRuntime,
  wristMenuRuntimeBlocksSceneInput,
} from '../dist/core/index.js'
import {
  controlledFrame,
  hostControlledSnapshot,
  observe,
} from '../fixtures/host-controlled-menu.mjs'

function automaticSnapshot() {
  const snapshot = structuredClone(hostControlledSnapshot)
  snapshot.activationMode = 'automatic'
  snapshot.comfort = {
    ...snapshot.comfort,
    initialDwellMs: 0,
    reacquireDwellMs: 200,
    transitionMs: 0,
  }
  return snapshot
}

function automaticFrame(sequence, selectPressed = false, selectCompleted = false) {
  return {
    ...controlledFrame(sequence, selectPressed, selectCompleted),
    viewerPosition: [0, 0, 1],
  }
}

test('Presentation Model preserves the complete Host-owned Menu Definition order', () => {
  const runtime = createWristMenuRuntimeState({
    snapshot: hostControlledSnapshot,
    onEvent: () => undefined,
  })

  const model = stepWristMenuRuntime(runtime, controlledFrame(1), [])

  assert.deepEqual(
    model.items.map(({ type, id }) => [type, id]),
    [
      ['action', 'reset-workshop'],
      ['separator', 'scene-controls'],
      ['toggle', 'show-grid'],
      ['choice-group', 'primitive-shape'],
      ['action', 'remove-selection'],
    ],
  )
  assert.deepEqual(model.items[2], {
    type: 'toggle',
    id: 'show-grid',
    label: 'Show grid',
    value: true,
    selected: true,
    disabled: false,
    interaction: 'idle',
  })
  assert.equal(model.items[0].label, 'Reset workshop')
  assert.equal(model.items[0].iconKey, 'reset')
  assert.deepEqual(model.items[3], {
    type: 'choice-group',
    id: 'primitive-shape',
    label: 'Primitive shape',
    selectedValue: 'cube',
    options: [
      {
        type: 'choice',
        id: 'shape-cube',
        groupId: 'primitive-shape',
        label: 'Cube',
        value: 'cube',
        selected: true,
        disabled: false,
        interaction: 'idle',
      },
      {
        type: 'choice',
        id: 'shape-sphere',
        groupId: 'primitive-shape',
        label: 'Sphere',
        value: 'sphere',
        selected: false,
        disabled: false,
        interaction: 'idle',
      },
    ],
  })
  assert.deepEqual(model.items[4], {
    type: 'action',
    id: 'remove-selection',
    label: 'Remove selection',
    disabled: true,
    disabledReason: 'Select a Workshop Object first',
    interaction: 'idle',
  })
})

test('sync copies a complete valid snapshot and applies it at one Frame Sample boundary', () => {
  const runtime = createWristMenuRuntimeState({
    snapshot: hostControlledSnapshot,
    onEvent: () => undefined,
  })
  stepWristMenuRuntime(runtime, controlledFrame(1), [])

  const mutable = structuredClone(hostControlledSnapshot)
  mutable.menuDefinition[2].value = false
  syncWristMenuRuntime(runtime, mutable)
  mutable.menuDefinition[2].value = true
  mutable.menuDefinition[2].label = 'Mutated after sync'

  const applied = stepWristMenuRuntime(runtime, controlledFrame(2), [])
  assert.equal(applied.revision, 2)
  assert.equal(applied.items[2].label, 'Show grid')
  assert.equal(applied.items[2].value, false)
  assert.equal(applied.items[2].selected, false)
})

test('invalid snapshots fail without replacing either live or pending Host state', () => {
  const runtime = createWristMenuRuntimeState({
    snapshot: hostControlledSnapshot,
    onEvent: () => undefined,
  })
  stepWristMenuRuntime(runtime, controlledFrame(1), [])

  const valid = structuredClone(hostControlledSnapshot)
  valid.menuDefinition[2].value = false
  syncWristMenuRuntime(runtime, valid)

  const invalid = structuredClone(hostControlledSnapshot)
  invalid.menuDefinition[3].selectedValue = 'cylinder'
  assert.throws(
    () => syncWristMenuRuntime(runtime, invalid),
    /Choice Group primitive-shape selectedValue must match exactly one option/,
  )

  const invalidComfort = structuredClone(hostControlledSnapshot)
  invalidComfort.comfort.enterAngleDegrees = 60
  assert.throws(
    () => syncWristMenuRuntime(runtime, invalidComfort),
    /exitAngleDegrees must be greater than or equal to enterAngleDegrees/,
  )

  const applied = stepWristMenuRuntime(runtime, controlledFrame(2), [])
  assert.equal(applied.items[2].value, false)
  assert.equal(applied.items[3].selectedValue, 'cube')
})

test('content validation rejects unstable, non-portable, and ambiguous definitions', () => {
  const create = (snapshot) =>
    createWristMenuRuntimeState({ snapshot, onEvent: () => undefined })
  const duplicateId = structuredClone(hostControlledSnapshot)
  duplicateId.menuDefinition[3].options[0].id = 'show-grid'
  assert.throws(() => create(duplicateId), /Menu item id must be unique/)

  const callbackContent = structuredClone(hostControlledSnapshot)
  callbackContent.menuDefinition[0].onSelect = () => undefined
  assert.throws(() => create(callbackContent), /unsupported field: onSelect/)

  const symbolContent = structuredClone(hostControlledSnapshot)
  symbolContent.menuDefinition[0][Symbol('onSelect')] = () => undefined
  assert.throws(() => create(symbolContent), /unsupported field: Symbol\(onSelect\)/)

  const hiddenContent = structuredClone(hostControlledSnapshot)
  Object.defineProperty(hiddenContent.menuDefinition[0], 'onSelect', {
    value: () => undefined,
  })
  assert.throws(() => create(hiddenContent), /unsupported field: onSelect/)

  const accessorContent = structuredClone(hostControlledSnapshot)
  Object.defineProperty(accessorContent.menuDefinition[0], 'label', {
    enumerable: true,
    get: () => 'Reset workshop',
  })
  assert.throws(() => create(accessorContent), /field label must be portable data/)

  const callbackSnapshot = {
    ...structuredClone(hostControlledSnapshot),
    onEvent: () => undefined,
  }
  assert.throws(() => create(callbackSnapshot), /unsupported field: onEvent/)

  const unknownComfort = structuredClone(hostControlledSnapshot)
  unknownComfort.comfort.smoothing = 0.5
  assert.throws(
    () => create(unknownComfort),
    /comfort contains unsupported field: smoothing/,
  )

  const accessorComfort = structuredClone(hostControlledSnapshot)
  Object.defineProperty(accessorComfort.comfort, 'transitionMs', {
    enumerable: true,
    get: () => 0,
  })
  assert.throws(
    () => create(accessorComfort),
    /comfort field transitionMs must be portable data/,
  )

  const unknownControllerField = structuredClone(hostControlledSnapshot)
  unknownControllerField.controllerWrist.profile = 'quest-touch'
  assert.throws(
    () => create(unknownControllerField),
    /controllerWrist contains unsupported field: profile/,
  )

  const malformedControllerTuple = structuredClone(hostControlledSnapshot)
  Object.defineProperty(
    malformedControllerTuple.controllerWrist.offsets.left.translationMeters,
    '1',
    { enumerable: true, get: () => 0 },
  )
  assert.throws(
    () => create(malformedControllerTuple),
    /translationMeters field 1 must be portable data/,
  )

  const nonFiniteValue = structuredClone(hostControlledSnapshot)
  nonFiniteValue.menuDefinition[3].options[0].value = Number.NaN
  assert.throws(() => create(nonFiniteValue), /string or finite number/)

  const unexplainedEnabledItem = structuredClone(hostControlledSnapshot)
  unexplainedEnabledItem.menuDefinition[0].disabledReason = 'Unavailable'
  assert.throws(
    () => create(unexplainedEnabledItem),
    /disabledReason requires disabled: true/,
  )

  const sparseDefinition = structuredClone(hostControlledSnapshot)
  delete sparseDefinition.menuDefinition[1]
  assert.throws(
    () => create(sparseDefinition),
    /Menu Definition must be a dense array/,
  )

  const sparseOptions = structuredClone(hostControlledSnapshot)
  delete sparseOptions.menuDefinition[3].options[0]
  assert.throws(
    () => create(sparseOptions),
    /Choice Group primitive-shape options must be a dense array/,
  )

  const empty = create({
    activationMode: 'forced-open',
    wrist: 'left',
    menuDefinition: [],
  })
  assert.equal(stepWristMenuRuntime(empty, controlledFrame(1), []).visible, false)
})

test('rich automatic sync copies content and configuration atomically without reacquisition', () => {
  const initial = automaticSnapshot()
  const runtime = createWristMenuRuntimeState({
    snapshot: initial,
    onEvent: () => undefined,
  })
  stepWristMenuRuntime(runtime, automaticFrame(1), [])
  assert.equal(stepWristMenuRuntime(runtime, automaticFrame(2), []).targetable, true)

  const updated = structuredClone(initial)
  updated.menuDefinition[2].value = false
  updated.menuDefinition[3].selectedValue = 'sphere'
  syncWristMenuRuntime(runtime, updated)

  updated.menuDefinition[2].value = true
  updated.menuDefinition[3].selectedValue = 'cube'
  updated.comfort.enterAngleDegrees = 5
  updated.controllerWrist.offsets.left.translationMeters[0] = 1

  const applied = stepWristMenuRuntime(runtime, automaticFrame(3), [])
  assert.equal(applied.revision, 2)
  assert.equal(applied.visible, true)
  assert.equal(applied.revealPhase, 'visible')
  assert.equal(applied.targetable, false)
  assert.equal(applied.items[2].value, false)
  assert.equal(applied.items[3].selectedValue, 'sphere')
  assert.deepEqual(applied.anchorPose.position, [0, 0, 0])
  assert.equal(stepWristMenuRuntime(runtime, automaticFrame(4), []).targetable, true)
})

test('anchoring sync cancels ownership, reacquires, and preserves callback-queued state', () => {
  const initial = automaticSnapshot()
  const firstUpdate = structuredClone(initial)
  firstUpdate.menuDefinition[2].value = false
  firstUpdate.controllerWrist.offsets.left.translationMeters[0] = 0.1
  const callbackUpdate = structuredClone(firstUpdate)
  callbackUpdate.menuDefinition[2].label = 'Grid from callback'
  let runtime
  runtime = createWristMenuRuntimeState({
    snapshot: initial,
    onEvent: (event) => {
      if (
        event.type === 'selection-cancellation' &&
        event.reason === 'host-snapshot-changed'
      ) {
        syncWristMenuRuntime(runtime, callbackUpdate)
      }
    },
  })
  stepWristMenuRuntime(runtime, automaticFrame(1), [])
  stepWristMenuRuntime(runtime, automaticFrame(2), [observe('show-grid')])
  stepWristMenuRuntime(runtime, automaticFrame(3, true), [observe('show-grid')])
  syncWristMenuRuntime(runtime, firstUpdate)

  const firstBoundary = stepWristMenuRuntime(runtime, automaticFrame(4, true), [])
  assert.equal(firstBoundary.revision, 2)
  assert.equal(firstBoundary.visible, false)
  assert.equal(firstBoundary.revealPhase, 'reacquire-dwell')
  assert.equal(firstBoundary.items[2].value, false)
  assert.equal(firstBoundary.items[2].label, 'Show grid')

  const secondBoundary = stepWristMenuRuntime(runtime, automaticFrame(5), [])
  assert.equal(secondBoundary.revision, 3)
  assert.equal(secondBoundary.items[2].value, false)
  assert.equal(secondBoundary.items[2].label, 'Grid from callback')
})

test('automatic reveal supports nested Choice Option ownership and intent', () => {
  const events = []
  const runtime = createWristMenuRuntimeState({
    snapshot: automaticSnapshot(),
    onEvent: (event) => events.push(event),
  })
  stepWristMenuRuntime(runtime, automaticFrame(1), [])
  stepWristMenuRuntime(runtime, automaticFrame(2), [observe('shape-sphere')])
  stepWristMenuRuntime(runtime, automaticFrame(3, true), [observe('shape-sphere')])
  stepWristMenuRuntime(runtime, automaticFrame(4, false, true), [observe('shape-sphere')])

  assert.equal(wristMenuRuntimeBlocksSceneInput(runtime, 'right-controller'), false)
  assert.deepEqual(
    events.find(({ type }) => type === 'selection-intent')?.intent,
    {
      type: 'choice',
      groupId: 'primitive-shape',
      itemId: 'shape-sphere',
      currentValue: 'cube',
      proposedValue: 'sphere',
    },
  )
})

test('semantically neutral controller defaults do not reacquire automatic reveal', () => {
  const initial = automaticSnapshot()
  delete initial.controllerWrist
  const runtime = createWristMenuRuntimeState({
    snapshot: initial,
    onEvent: () => undefined,
  })
  stepWristMenuRuntime(runtime, automaticFrame(1), [])
  stepWristMenuRuntime(runtime, automaticFrame(2), [])

  syncWristMenuRuntime(runtime, { ...initial, controllerWrist: { preset: 'neutral' } })
  const synchronized = stepWristMenuRuntime(runtime, automaticFrame(3), [])
  assert.equal(synchronized.visible, true)
  assert.equal(synchronized.revealPhase, 'visible')
})

test('toggle and choice Selection Intents propose values without mutating displayed state', () => {
  const events = []
  const runtime = createWristMenuRuntimeState({
    snapshot: hostControlledSnapshot,
    onEvent: (event) => events.push(event),
  })
  stepWristMenuRuntime(runtime, controlledFrame(1), [])
  stepWristMenuRuntime(runtime, controlledFrame(2), [])

  stepWristMenuRuntime(runtime, controlledFrame(3, true), [observe('show-grid')])
  const afterToggle = stepWristMenuRuntime(runtime, controlledFrame(4, false, true), [
    observe('show-grid'),
  ])
  stepWristMenuRuntime(runtime, controlledFrame(5, true), [observe('shape-sphere')])
  const afterChoice = stepWristMenuRuntime(runtime, controlledFrame(6, false, true), [
    observe('shape-sphere'),
  ])

  assert.deepEqual(
    events
      .filter(({ type }) => type === 'selection-intent')
      .map(({ intent }) => intent),
    [
      {
        type: 'toggle',
        itemId: 'show-grid',
        currentValue: true,
        proposedValue: false,
      },
      {
        type: 'choice',
        groupId: 'primitive-shape',
        itemId: 'shape-sphere',
        currentValue: 'cube',
        proposedValue: 'sphere',
      },
    ],
  )
  assert.equal(afterToggle.items[2].value, true)
  assert.equal(afterChoice.items[3].selectedValue, 'cube')
})

test('a Host sync from an event callback waits for the next Frame Sample', () => {
  const updated = structuredClone(hostControlledSnapshot)
  updated.menuDefinition[2].value = false
  let runtime
  runtime = createWristMenuRuntimeState({
    snapshot: hostControlledSnapshot,
    onEvent: (event) => {
      if (event.type === 'selection-intent') syncWristMenuRuntime(runtime, updated)
    },
  })
  stepWristMenuRuntime(runtime, controlledFrame(1), [])
  stepWristMenuRuntime(runtime, controlledFrame(2), [])
  stepWristMenuRuntime(runtime, controlledFrame(3, true), [observe('show-grid')])

  const committingFrame = stepWristMenuRuntime(runtime, controlledFrame(4, false, true), [
    observe('show-grid'),
  ])
  assert.equal(committingFrame.items[2].value, true)
  assert.equal(committingFrame.revision, 1)

  const followingFrame = stepWristMenuRuntime(runtime, controlledFrame(5), [])
  assert.equal(followingFrame.items[2].value, false)
  assert.equal(followingFrame.revision, 2)
})

test('a Host sync from a snapshot-cancellation callback waits another Frame Sample', () => {
  const firstUpdate = structuredClone(hostControlledSnapshot)
  firstUpdate.menuDefinition[2].value = false
  const callbackUpdate = structuredClone(hostControlledSnapshot)
  callbackUpdate.menuDefinition[2].label = 'Grid from callback'
  let runtime
  runtime = createWristMenuRuntimeState({
    snapshot: hostControlledSnapshot,
    onEvent: (event) => {
      if (
        event.type === 'selection-cancellation' &&
        event.reason === 'host-snapshot-changed'
      ) {
        syncWristMenuRuntime(runtime, callbackUpdate)
      }
    },
  })
  stepWristMenuRuntime(runtime, controlledFrame(1), [])
  stepWristMenuRuntime(runtime, controlledFrame(2), [observe('show-grid')])
  stepWristMenuRuntime(runtime, controlledFrame(3, true), [observe('show-grid')])
  syncWristMenuRuntime(runtime, firstUpdate)

  const firstBoundary = stepWristMenuRuntime(runtime, controlledFrame(4, true), [])
  assert.equal(firstBoundary.items[2].value, false)
  assert.equal(firstBoundary.items[2].label, 'Show grid')
  assert.equal(firstBoundary.revision, 2)

  const secondBoundary = stepWristMenuRuntime(runtime, controlledFrame(5), [])
  assert.equal(secondBoundary.items[2].value, true)
  assert.equal(secondBoundary.items[2].label, 'Grid from callback')
  assert.equal(secondBoundary.revision, 3)
})

test('a throwing disposal callback still leaves the Wrist Menu Instance disposed', () => {
  const runtime = createWristMenuRuntimeState({
    snapshot: hostControlledSnapshot,
    onEvent: (event) => {
      if (event.type === 'selection-cancellation' && event.reason === 'disposed') {
        throw new Error('Host disposal callback failed')
      }
    },
  })
  stepWristMenuRuntime(runtime, controlledFrame(1), [])
  stepWristMenuRuntime(runtime, controlledFrame(2), [observe('show-grid')])
  stepWristMenuRuntime(runtime, controlledFrame(3, true), [observe('show-grid')])

  assert.throws(() => disposeWristMenuRuntime(runtime), /Host disposal callback failed/)
  assert.throws(() => stepWristMenuRuntime(runtime, controlledFrame(4), []), /disposed/)
  assert.doesNotThrow(() => disposeWristMenuRuntime(runtime))
})

test('disabled items can be observed but never arm, claim, or emit an intent', () => {
  const events = []
  const runtime = createWristMenuRuntimeState({
    snapshot: hostControlledSnapshot,
    onEvent: (event) => events.push(event),
  })
  stepWristMenuRuntime(runtime, controlledFrame(1), [])

  const hovered = stepWristMenuRuntime(runtime, controlledFrame(2), [
    observe('remove-selection'),
  ])
  const pressed = stepWristMenuRuntime(runtime, controlledFrame(3, true), [
    observe('remove-selection'),
  ])
  stepWristMenuRuntime(runtime, controlledFrame(4, false, true), [
    observe('remove-selection'),
  ])

  assert.equal(hovered.items[4].interaction, 'hovered')
  assert.equal(pressed.items[4].interaction, 'hovered')
  assert.equal(wristMenuRuntimeBlocksSceneInput(runtime, 'right-controller'), false)
  assert.deepEqual(
    events.filter(({ type }) => type !== 'visibility-change'),
    [],
  )
})
