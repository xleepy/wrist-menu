import assert from 'node:assert/strict'
import test from 'node:test'
import { Raycaster, Vector3 } from 'three'

import {
  defaultThemeTokens,
  VISIBLE_SLOTS,
} from '../dist/core/index.js'
import {
  defaultThreeWristMenuPresentationFactory,
} from '../dist/three/index.js'

function rowAction(index, overrides = {}) {
  return {
    type: 'action',
    id: `row-${index}`,
    label: `Row ${index}`,
    disabled: false,
    interaction: 'idle',
    ...overrides,
  }
}

function manyActions(count) {
  return Array.from({ length: count }, (_, index) => rowAction(index))
}

function presentationModel(items, overrides = {}) {
  return {
    visible: true,
    targetable: true,
    opacity: 1,
    revealPhase: 'visible',
    anchorPose: { position: [0, 0, 0], orientation: [0, 0, 0, 1] },
    revision: 1,
    items,
    scrollOffset: 0,
    totalRows: items.length,
    visibleSlots: VISIBLE_SLOTS,
    scrollOwned: false,
    scrollBarrierActive: false,
    theme: defaultThemeTokens,
    ...overrides,
  }
}

function visibleRowIds(presentation) {
  return presentation.root.children
    .filter(({ name, visible }) =>
      visible && /^wrist-menu-(?:action|toggle|choice)-visual:/.test(name))
    .sort((left, right) => right.position.y - left.position.y)
    .map(({ name }) => name.slice(name.indexOf(':') + 1))
}

test('the default presentation exposes only the current Menu Viewport rows', () => {
  const items = manyActions(VISIBLE_SLOTS + 5)
  const presentation = defaultThreeWristMenuPresentationFactory(
    presentationModel(items),
  )

  const visible = visibleRowIds(presentation)
  assert.ok(visible.length > 0 && visible.length <= VISIBLE_SLOTS)
  assert.equal(visible[0], 'row-0')
  const targetable = presentation.hitRegions.map(({ itemId }) => itemId)
  assert.ok(targetable.length > 0)
  assert.ok(targetable.every((itemId) => visible.includes(itemId)))
  assert.equal(presentation.menuViewport.object.name, 'wrist-menu-reach-viewport')
  presentation.dispose()
})

test('scroll updates rebind the fixed presentation to the newly visible rows', () => {
  const items = manyActions(VISIBLE_SLOTS + 5)
  const initial = presentationModel(items)
  const presentation = defaultThreeWristMenuPresentationFactory(initial)
  const before = visibleRowIds(presentation)

  presentation.update({ ...initial, scrollOffset: 2 })

  const after = visibleRowIds(presentation)
  assert.notDeepEqual(after, before)
  assert.equal(after[0], 'row-2')
  assert.ok(
    presentation.hitRegions.every(({ itemId }) => after.includes(itemId)),
  )
  presentation.dispose()
})

test('separators and Choice Group headers never declare Hit Regions', () => {
  const items = [
    rowAction(0, { id: 'action-one', label: 'Action One' }),
    { type: 'separator', id: 'sep', label: 'Section' },
    {
      type: 'choice-group',
      id: 'shape',
      label: 'Shape',
      selectedValue: 'cube',
      options: [
        { id: 'opt-cube', label: 'Cube', value: 'cube', selected: true, disabled: false, interaction: 'idle' },
        { id: 'opt-sphere', label: 'Sphere', value: 'sphere', selected: false, disabled: false, interaction: 'idle' },
      ],
    },
    rowAction(1, { id: 'action-two', label: 'Action Two' }),
  ]
  const presentation = defaultThreeWristMenuPresentationFactory(
    presentationModel(items),
  )

  const targetable = presentation.hitRegions.map(({ itemId }) => itemId)
  assert.ok(targetable.includes('action-one'))
  assert.ok(targetable.includes('opt-cube'))
  assert.ok(targetable.includes('opt-sphere'))
  assert.equal(targetable.includes('sep'), false)
  assert.equal(targetable.includes('shape'), false)
  presentation.dispose()
})

test('Presentation Model updates expose the latest interaction and Menu Value cues', () => {
  const items = [
    rowAction(0, { id: 'spawn', label: 'Spawn', interaction: 'hovered' }),
    {
      type: 'toggle',
      id: 'grid',
      label: 'Grid',
      value: false,
      selected: false,
      interaction: 'idle',
      disabled: false,
    },
  ]
  const initial = presentationModel(items)
  const presentation = defaultThreeWristMenuPresentationFactory(initial)

  const hoveredRow = presentation.root.getObjectByName(
    'wrist-menu-action-visual:spawn',
  )
  assert.deepEqual(hoveredRow.userData.wristMenuAtlasStateCues, ['hovered'])

  const toggleRow = presentation.root.getObjectByName(
    'wrist-menu-toggle-visual:grid',
  )
  assert.equal(toggleRow.userData.wristMenuValue, false)
  assert.equal(toggleRow.userData.wristMenuSelected, false)

  presentation.update({
    ...initial,
    items: items.map((item) =>
      item.id === 'grid'
        ? { ...item, value: true, selected: true, interaction: 'armed' }
        : { ...item, interaction: 'idle' }),
  })
  assert.equal(toggleRow.userData.wristMenuValue, true)
  assert.equal(toggleRow.userData.wristMenuSelected, true)
  assert.deepEqual(toggleRow.userData.wristMenuAtlasStateCues, [
    'selected',
    'selection-ownership',
  ])
  presentation.dispose()
})

test('the default Presentation adapter applies model targetability itself', () => {
  const initial = presentationModel([rowAction(0)])
  const presentation = defaultThreeWristMenuPresentationFactory(initial)
  const target = presentation.hitRegions[0].object
  presentation.root.updateMatrixWorld(true)
  const targetPosition = target.getWorldPosition(new Vector3())
  const ray = new Raycaster(
    new Vector3(targetPosition.x, targetPosition.y, targetPosition.z + 1),
    new Vector3(0, 0, -1),
  )

  assert.ok(ray.intersectObject(presentation.root, true).length > 0)
  presentation.update({ ...initial, targetable: false })
  assert.equal(ray.intersectObject(presentation.root, true).length, 0)
  presentation.dispose()
})
