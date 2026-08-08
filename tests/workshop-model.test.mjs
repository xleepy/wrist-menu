import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PROCESSED_PHYSICAL_ACTION_CAPACITY,
  WORKSHOP_OBJECT_CAPACITY,
  createPhysicalActionCoordinator,
  createWorkshopScenario,
  createWorkshopModel,
  reduceWorkshop,
  reduceWorkshopMenuEvent,
  workshopHostSnapshot,
} from '../examples/primitive-workshop/shared/workshop-model.js'
import {
  workshopCapacityPositions,
  workshopPlacementFixtures,
  workshopScenarioNames,
} from '../fixtures/primitive-workshop-lifecycle.mjs'

function transition(model, action, actionId) {
  return reduceWorkshop(model, { actionId, action })
}

test('the Workshop Model exposes a complete scrollable Host Snapshot', () => {
  const model = createWorkshopModel()
  const snapshot = workshopHostSnapshot(model)

  assert.equal(snapshot.activationMode, 'automatic')
  assert.equal(snapshot.wrist, 'left')
  assert.ok(snapshot.menuDefinition.length > 6)
  assert.deepEqual(
    snapshot.menuDefinition.map((entry) => entry.id).filter(Boolean),
    [
      'primitive-choice',
      'spawn-primitive',
      'objects-section',
      'remove-selection',
      'grid-section',
      'snap-to-grid',
      'grid-visible',
      'reset-workshop',
      'wrist-section',
      'menu-wrist',
    ],
  )
  assert.equal(
    snapshot.menuDefinition.find((entry) => entry.id === 'remove-selection')
      .disabled,
    true,
  )
  assert.equal(Object.isFrozen(snapshot), true)
  assert.equal(Object.isFrozen(snapshot.menuDefinition), true)
})

test('the Workshop Model enforces the shared twelve-object capacity fixture', () => {
  let model = createWorkshopModel()

  for (const [index, position] of workshopCapacityPositions.entries()) {
    model = transition(
      model,
      { type: 'place-cursor', position, valid: true },
      `capacity-place-${index}`,
    )
    model = transition(model, { type: 'spawn' }, `capacity-spawn-${index}`)
  }

  assert.equal(WORKSHOP_OBJECT_CAPACITY, 12)
  assert.equal(model.objects.length, 12)
  const snapshot = workshopHostSnapshot(model)
  const spawn = snapshot.menuDefinition.find(
    (entry) => entry.id === 'spawn-primitive',
  )
  assert.equal(spawn.disabled, true)
  assert.equal(spawn.disabledReason, 'Workshop is full')
  assert.equal(
    transition(model, { type: 'spawn' }, 'capacity-overflow'),
    model,
  )

  const occupied = transition(
    createWorkshopModel(),
    {
      type: 'place-cursor',
      position: workshopPlacementFixtures.occupied,
      valid: true,
    },
    'occupied-place',
  )
  const spawned = transition(occupied, { type: 'spawn' }, 'occupied-spawn')
  const blocked = transition(
    spawned,
    {
      type: 'place-cursor',
      position: workshopPlacementFixtures.occupied,
      valid: true,
    },
    'occupied-again',
  )
  const occupiedSpawn = workshopHostSnapshot(blocked).menuDefinition.find(
    (entry) => entry.id === 'spawn-primitive',
  )
  assert.equal(blocked.placementCursor.status, 'occupied')
  assert.equal(occupiedSpawn.disabledReason, 'Choose an empty spot')
  assert.equal(
    transition(blocked, { type: 'spawn' }, 'occupied-spawn-again'),
    blocked,
  )
})

test('disabled actions, reset, empty definitions, and unavailable wrists fail safely', () => {
  const initial = createWorkshopModel()
  const initialSnapshot = workshopHostSnapshot(initial, {
    availableWrists: ['left'],
  })
  const item = (id) =>
    initialSnapshot.menuDefinition.find((entry) => entry.id === id)

  assert.equal(initial.placementCursor.status, 'unavailable')
  assert.equal(item('spawn-primitive').disabledReason, 'Aim at the table first')
  assert.equal(item('remove-selection').disabledReason, 'Select an object first')
  assert.equal(item('reset-workshop').disabledReason, 'Workshop already empty')
  assert.equal(
    item('menu-wrist').options.find((option) => option.value === 'right')
      .disabledReason,
    'Hand not tracked',
  )
  assert.equal(
    transition(initial, { type: 'reset' }, 'disabled-reset'),
    initial,
  )
  assert.deepEqual(
    workshopHostSnapshot(initial, { emptyDefinition: true }).menuDefinition,
    [],
  )

  let changed = transition(
    initial,
    { type: 'set-menu-wrist', wrist: 'right' },
    'reset-wrist',
  )
  changed = transition(
    changed,
    { type: 'choose-primitive', primitive: 'sphere' },
    'reset-primitive',
  )
  const reset = transition(changed, { type: 'reset' }, 'reset-workshop')
  assert.equal(reset.menuWrist, 'right')
  assert.equal(reset.selectedPrimitive, 'cube')
  assert.equal(reset.placementCursor.status, 'unavailable')
})

test('the shared named scenarios are deterministic portable Workshop fixtures', () => {
  assert.deepEqual(
    workshopScenarioNames.map((name) => createWorkshopScenario(name).name),
    ['default', 'full-workshop', 'empty-definition', 'shield'],
  )

  const full = createWorkshopScenario('full-workshop')
  assert.equal(full.model.objects.length, 12)
  assert.equal(
    workshopHostSnapshot(full.model, full.snapshotOptions).menuDefinition.find(
      (entry) => entry.id === 'spawn-primitive',
    ).disabledReason,
    'Workshop is full',
  )

  const emptyDefinition = createWorkshopScenario('empty-definition')
  assert.deepEqual(
    workshopHostSnapshot(
      emptyDefinition.model,
      emptyDefinition.snapshotOptions,
    ).menuDefinition,
    [],
  )

  const shield = createWorkshopScenario('shield')
  assert.equal(shield.model.objects.length, 1)
  assert.equal(shield.shieldObjectId, 'workshop-object-1')
  assert.throws(() => createWorkshopScenario('unknown'), /Unknown Workshop scenario/)
})

test('valid placement deterministically spawns snapped and unsnapped primitives', () => {
  let model = createWorkshopModel()
  model = transition(
    model,
    { type: 'place-cursor', position: [0.37, 0, -0.38], valid: true },
    'place-1',
  )
  model = transition(model, { type: 'spawn' }, 'spawn-1')

  assert.deepEqual(model.objects[0], {
    id: 'workshop-object-1',
    primitive: 'cube',
    position: [0.25, 0, -0.5],
    snapped: true,
  })

  model = transition(
    model,
    { type: 'choose-primitive', primitive: 'sphere' },
    'shape-1',
  )
  model = transition(
    model,
    { type: 'set-snap-to-grid', enabled: false },
    'snap-1',
  )
  model = transition(
    model,
    { type: 'place-cursor', position: [0.63, 0, -0.38], valid: true },
    'place-2',
  )
  model = transition(model, { type: 'spawn' }, 'spawn-2')

  assert.deepEqual(model.objects[1], {
    id: 'workshop-object-2',
    primitive: 'sphere',
    position: [0.63, 0, -0.38],
    snapped: false,
  })
})

test('invalid placement does not spawn or advance the Workshop Model', () => {
  const initial = createWorkshopModel()
  const invalidCursor = transition(
    initial,
    { type: 'place-cursor', position: [3, 0, 3], valid: false },
    'place-invalid',
  )
  const afterSpawn = transition(invalidCursor, { type: 'spawn' }, 'spawn-invalid')

  assert.equal(afterSpawn, invalidCursor)
  assert.equal(afterSpawn.objects.length, 0)
})

test('one physical action causes at most one Workshop Model transition', () => {
  const initial = transition(
    createWorkshopModel(),
    { type: 'place-cursor', position: [0.5, 0, -0.5], valid: true },
    'place-for-exactly-once',
  )
  const spawned = transition(initial, { type: 'spawn' }, 'controller-select-7')
  const duplicate = transition(
    spawned,
    { type: 'spawn' },
    'controller-select-7',
  )

  assert.equal(duplicate, spawned)
  assert.equal(duplicate.revision, initial.revision + 1)
  assert.equal(duplicate.objects.length, 1)
})

test('a processed physical action stays deduplicated after intervening transitions', () => {
  const initial = createWorkshopModel()
  const afterA = transition(
    initial,
    { type: 'choose-primitive', primitive: 'sphere' },
    'physical-a',
  )
  const afterB = transition(
    afterA,
    { type: 'set-grid-visible', visible: false },
    'physical-b',
  )
  const duplicateA = transition(
    afterB,
    { type: 'choose-primitive', primitive: 'cylinder' },
    'physical-a',
  )

  assert.equal(duplicateA, afterB)
  assert.equal(duplicateA.selectedPrimitive, 'sphere')
  assert.equal(duplicateA.gridVisible, false)
  assert.equal(duplicateA.revision, 2)
})

test('processed physical action identities have an explicit bounded lifetime', () => {
  let model = createWorkshopModel()
  for (let index = 0; index <= PROCESSED_PHYSICAL_ACTION_CAPACITY; index += 1) {
    model = transition(
      model,
      { type: 'set-grid-visible', visible: index % 2 === 0 ? false : true },
      `physical-${index}`,
    )
  }

  assert.equal(
    model.processedPhysicalActionIds.length,
    PROCESSED_PHYSICAL_ACTION_CAPACITY,
  )
  assert.equal(model.processedPhysicalActionIds.includes('physical-0'), false)
  assert.equal(model.processedPhysicalActionIds.includes('physical-1'), true)
})

test('semantic Wrist Menu intents cause one Host-controlled transition', () => {
  const event = {
    type: 'selection-intent',
    intent: {
      type: 'choice',
      groupId: 'primitive-choice',
      itemId: 'primitive-cylinder',
      currentValue: 'cube',
      proposedValue: 'cylinder',
    },
    source: { id: 'right-controller', kind: 'controller', handedness: 'right' },
    menuWrist: 'left',
    time: 120,
  }
  const initial = createWorkshopModel()
  const changed = reduceWorkshopMenuEvent(initial, event)
  const duplicate = reduceWorkshopMenuEvent(changed, event)

  assert.equal(changed.selectedPrimitive, 'cylinder')
  assert.equal(changed.revision, 1)
  assert.equal(duplicate, changed)
  assert.equal(
    workshopHostSnapshot(changed).menuDefinition.find(
      (entry) => entry.id === 'primitive-choice',
    ).selectedValue,
    'cylinder',
  )
})

test('menu and scene delivery paths can share one physical action identity', () => {
  const inputSource = {}
  const descriptor = { kind: 'controller', handedness: 'right' }
  const physicalActions = createPhysicalActionCoordinator({
    prefix: 'controller',
  })
  const sharedActionId = physicalActions.selectStart(
    inputSource,
    descriptor,
    {},
  )
  const menuEvent = {
    type: 'selection-intent',
    intent: {
      type: 'choice',
      groupId: 'primitive-choice',
      itemId: 'primitive-cylinder',
      currentValue: 'cube',
      proposedValue: 'cylinder',
    },
    source: { id: 'right-controller', kind: 'controller', handedness: 'right' },
    menuWrist: 'left',
    time: 120,
  }
  physicalActions.bindMenuSource(
    menuEvent.source.id,
    inputSource,
    descriptor,
  )

  const afterMenu = reduceWorkshopMenuEvent(
    createWorkshopModel(),
    menuEvent,
    physicalActions.menuAction(menuEvent),
  )
  const sceneActionId = physicalActions.sceneAction(
    inputSource,
    descriptor,
    {},
  )
  const afterScene = transition(afterMenu, { type: 'spawn' }, sceneActionId)

  assert.equal(sceneActionId, sharedActionId)
  assert.equal(afterScene, afterMenu)
  assert.equal(afterScene.selectedPrimitive, 'cylinder')
  assert.equal(afterScene.objects.length, 0)
  assert.equal(afterScene.revision, 1)
})

test('overlapping XR input sources retain independent physical actions', () => {
  let now = 100
  const physicalActions = createPhysicalActionCoordinator({
    prefix: 'xr',
    lifetimeMs: 20,
    now: () => now,
  })
  const leftSource = {}
  const rightSource = {}
  const descriptor = { kind: 'controller', handedness: 'right' }
  const left = physicalActions.selectStart(leftSource, descriptor, {})
  const right = physicalActions.selectStart(rightSource, descriptor, {})

  physicalActions.selectEnd(leftSource)
  now += 21

  assert.equal(
    physicalActions.sceneAction(rightSource, descriptor, {}),
    right,
  )
  assert.notEqual(
    physicalActions.sceneAction(leftSource, descriptor, {}),
    left,
  )
})

test('distinct menu commit occurrences stay distinct inside the correlation lifetime', () => {
  const physicalActions = createPhysicalActionCoordinator({
    prefix: 'hand',
    lifetimeMs: 250,
    now: () => 100,
  })
  const inputSource = {}
  const descriptor = { kind: 'hand', handedness: 'right' }
  const source = { id: 'hand-source', ...descriptor }
  const firstEvent = {
    type: 'selection-intent',
    intent: { type: 'action', itemId: 'spawn-primitive' },
    source,
    menuWrist: 'left',
    time: 100,
  }
  const secondEvent = { ...firstEvent, time: 101 }
  physicalActions.bindMenuSource(source.id, inputSource, descriptor)

  const first = physicalActions.menuAction(firstEvent)
  const duplicate = physicalActions.menuAction(firstEvent)
  const second = physicalActions.menuAction(secondEvent)

  assert.equal(duplicate, first)
  assert.notEqual(second, first)
})

test('selection, removal, grid visibility, and both menu wrists stay Host-controlled', () => {
  let model = transition(
    createWorkshopModel(),
    { type: 'place-cursor', position: [0.5, 0, -0.5], valid: true },
    'place-1',
  )
  model = transition(model, { type: 'spawn' }, 'spawn-1')
  model = transition(
    model,
    { type: 'select-object', objectId: 'workshop-object-1' },
    'select-1',
  )
  assert.equal(
    workshopHostSnapshot(model).menuDefinition.find(
      (entry) => entry.id === 'remove-selection',
    ).disabled,
    false,
  )

  model = transition(
    model,
    { type: 'set-grid-visible', visible: false },
    'grid-1',
  )
  model = transition(
    model,
    { type: 'set-menu-wrist', wrist: 'right' },
    'wrist-1',
  )
  model = transition(model, { type: 'remove-selection' }, 'remove-1')

  const snapshot = workshopHostSnapshot(model)
  assert.equal(model.gridVisible, false)
  assert.equal(model.menuWrist, 'right')
  assert.equal(model.objects.length, 0)
  assert.equal(model.selectedObjectId, null)
  assert.equal(snapshot.wrist, 'right')
  assert.equal(
    snapshot.menuDefinition.find((entry) => entry.id === 'grid-visible').value,
    false,
  )
  assert.equal(
    snapshot.menuDefinition.find((entry) => entry.id === 'remove-selection')
      .disabled,
    true,
  )
})
