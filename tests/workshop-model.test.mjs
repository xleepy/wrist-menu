import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PROCESSED_PHYSICAL_ACTION_CAPACITY,
  createPhysicalActionIdentitySource,
  createWorkshopModel,
  reduceWorkshop,
  reduceWorkshopMenuEvent,
  workshopHostSnapshot,
} from '../examples/primitive-workshop/shared/workshop-model.js'

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
      'spawn-primitive',
      'objects-section',
      'remove-selection',
      'primitive-section',
      'primitive-choice',
      'grid-section',
      'grid-visible',
      'snap-to-grid',
      'wrist-section',
      'menu-wrist',
      'reset-workshop',
    ],
  )
  assert.equal(snapshot.menuDefinition[2].disabled, true)
  assert.equal(Object.isFrozen(snapshot), true)
  assert.equal(Object.isFrozen(snapshot.menuDefinition), true)
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
  model = transition(model, { type: 'spawn' }, 'spawn-2')

  assert.deepEqual(model.objects[1], {
    id: 'workshop-object-2',
    primitive: 'sphere',
    position: [0.37, 0, -0.38],
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
  const initial = createWorkshopModel()
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
    workshopHostSnapshot(changed).menuDefinition[4].selectedValue,
    'cylinder',
  )
})

test('menu and scene delivery paths can share one physical action identity', () => {
  const identitySource = createPhysicalActionIdentitySource('controller')
  const sharedActionId = identitySource.begin()
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

  const afterMenu = reduceWorkshopMenuEvent(
    createWorkshopModel(),
    menuEvent,
    sharedActionId,
  )
  const afterScene = transition(afterMenu, { type: 'spawn' }, sharedActionId)

  assert.equal(identitySource.current(), sharedActionId)
  assert.equal(afterScene, afterMenu)
  assert.equal(afterScene.selectedPrimitive, 'cylinder')
  assert.equal(afterScene.objects.length, 0)
  assert.equal(afterScene.revision, 1)
})

test('a physical action identity source ends only the matching current identity', () => {
  const identitySource = createPhysicalActionIdentitySource('xr')
  const first = identitySource.begin()
  const second = identitySource.begin()

  identitySource.end(first)
  assert.equal(identitySource.current(), second)
  identitySource.end(second)
  assert.equal(identitySource.current(), null)
})

test('selection, removal, grid visibility, and both menu wrists stay Host-controlled', () => {
  let model = transition(createWorkshopModel(), { type: 'spawn' }, 'spawn-1')
  model = transition(
    model,
    { type: 'select-object', objectId: 'workshop-object-1' },
    'select-1',
  )
  assert.equal(
    workshopHostSnapshot(model).menuDefinition[2].disabled,
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
  assert.equal(snapshot.menuDefinition[6].value, false)
  assert.equal(snapshot.menuDefinition[2].disabled, true)
})
