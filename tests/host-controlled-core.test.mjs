import assert from 'node:assert/strict'
import test from 'node:test'

import { createWristMenuRuntime } from '../dist/core/index.js'
import {
  controlledFrame,
  hostControlledSnapshot,
  observe,
} from '../fixtures/host-controlled-menu.mjs'

test('Presentation Model preserves the complete Host-owned Menu Definition order', () => {
  const runtime = createWristMenuRuntime({
    snapshot: hostControlledSnapshot,
    onEvent: () => undefined,
  })

  const model = runtime.step(controlledFrame(1), [])

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
  const runtime = createWristMenuRuntime({
    snapshot: hostControlledSnapshot,
    onEvent: () => undefined,
  })
  runtime.step(controlledFrame(1), [])

  const mutable = structuredClone(hostControlledSnapshot)
  mutable.menuDefinition[2].value = false
  runtime.sync(mutable)
  mutable.menuDefinition[2].value = true
  mutable.menuDefinition[2].label = 'Mutated after sync'

  const applied = runtime.step(controlledFrame(2), [])
  assert.equal(applied.revision, 2)
  assert.equal(applied.items[2].label, 'Show grid')
  assert.equal(applied.items[2].value, false)
  assert.equal(applied.items[2].selected, false)
})

test('invalid snapshots fail without replacing either live or pending Host state', () => {
  const runtime = createWristMenuRuntime({
    snapshot: hostControlledSnapshot,
    onEvent: () => undefined,
  })
  runtime.step(controlledFrame(1), [])

  const valid = structuredClone(hostControlledSnapshot)
  valid.menuDefinition[2].value = false
  runtime.sync(valid)

  const invalid = structuredClone(hostControlledSnapshot)
  invalid.menuDefinition[3].selectedValue = 'cylinder'
  assert.throws(
    () => runtime.sync(invalid),
    /Choice Group primitive-shape selectedValue must match exactly one option/,
  )

  const applied = runtime.step(controlledFrame(2), [])
  assert.equal(applied.items[2].value, false)
  assert.equal(applied.items[3].selectedValue, 'cube')
})

test('content validation rejects unstable, non-portable, and ambiguous definitions', () => {
  const create = (snapshot) =>
    createWristMenuRuntime({ snapshot, onEvent: () => undefined })
  const duplicateId = structuredClone(hostControlledSnapshot)
  duplicateId.menuDefinition[3].options[0].id = 'show-grid'
  assert.throws(() => create(duplicateId), /Menu item id must be unique/)

  const callbackContent = structuredClone(hostControlledSnapshot)
  callbackContent.menuDefinition[0].onSelect = () => undefined
  assert.throws(() => create(callbackContent), /unsupported field: onSelect/)

  const nonFiniteValue = structuredClone(hostControlledSnapshot)
  nonFiniteValue.menuDefinition[3].options[0].value = Number.NaN
  assert.throws(() => create(nonFiniteValue), /string or finite number/)

  const unexplainedEnabledItem = structuredClone(hostControlledSnapshot)
  unexplainedEnabledItem.menuDefinition[0].disabledReason = 'Unavailable'
  assert.throws(
    () => create(unexplainedEnabledItem),
    /disabledReason requires disabled: true/,
  )

  const empty = create({
    activationMode: 'forced-open',
    wrist: 'left',
    menuDefinition: [],
  })
  assert.equal(empty.step(controlledFrame(1), []).visible, false)
})

test('toggle and choice Selection Intents propose values without mutating displayed state', () => {
  const events = []
  const runtime = createWristMenuRuntime({
    snapshot: hostControlledSnapshot,
    onEvent: (event) => events.push(event),
  })
  runtime.step(controlledFrame(1), [])
  runtime.step(controlledFrame(2), [])

  runtime.step(controlledFrame(3, true), [observe('show-grid')])
  const afterToggle = runtime.step(controlledFrame(4, false, true), [
    observe('show-grid'),
  ])
  runtime.step(controlledFrame(5, true), [observe('shape-sphere')])
  const afterChoice = runtime.step(controlledFrame(6, false, true), [
    observe('shape-sphere'),
  ])

  assert.deepEqual(
    events.map(({ intent }) => intent),
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
  runtime = createWristMenuRuntime({
    snapshot: hostControlledSnapshot,
    onEvent: (event) => {
      if (event.type === 'selection-intent') runtime.sync(updated)
    },
  })
  runtime.step(controlledFrame(1), [])
  runtime.step(controlledFrame(2), [])
  runtime.step(controlledFrame(3, true), [observe('show-grid')])

  const committingFrame = runtime.step(controlledFrame(4, false, true), [
    observe('show-grid'),
  ])
  assert.equal(committingFrame.items[2].value, true)
  assert.equal(committingFrame.revision, 1)

  const followingFrame = runtime.step(controlledFrame(5), [])
  assert.equal(followingFrame.items[2].value, false)
  assert.equal(followingFrame.revision, 2)
})

test('disabled items can be observed but never arm, claim, or emit an intent', () => {
  const events = []
  const runtime = createWristMenuRuntime({
    snapshot: hostControlledSnapshot,
    onEvent: (event) => events.push(event),
  })
  runtime.step(controlledFrame(1), [])

  const hovered = runtime.step(controlledFrame(2), [
    observe('remove-selection'),
  ])
  const pressed = runtime.step(controlledFrame(3, true), [
    observe('remove-selection'),
  ])
  runtime.step(controlledFrame(4, false, true), [
    observe('remove-selection'),
  ])

  assert.equal(hovered.items[4].interaction, 'hovered')
  assert.equal(pressed.items[4].interaction, 'hovered')
  assert.equal(runtime.blocksSceneInput('right-controller'), false)
  assert.deepEqual(events, [])
})
