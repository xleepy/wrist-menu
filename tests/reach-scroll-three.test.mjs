import assert from 'node:assert/strict'
import test from 'node:test'

import { WristMenuPresentation } from '../dist/three/wrist-menu-presentation.js'
import { VISIBLE_SLOTS } from '../dist/core/scroll-state.js'

const POOL_SIZE = VISIBLE_SLOTS

function rowAction(index) {
  return { type: 'action', id: `row-${index}`, label: `Row ${index}`, disabled: false }
}

function manyActions(count) {
  return Array.from({ length: count }, (_, index) => rowAction(index))
}

function visibleRowNames(presentation) {
  return presentation.group.children
    .filter(
      (child) =>
        child.name.startsWith('wrist-menu-action-visual:') && child.visible,
    )
    .map((child) => child.name)
}

test('the WristMenuPresentation pool allocates exactly VISIBLE_SLOTS hit regions', () => {
  const presentation = new WristMenuPresentation()
  assert.equal(presentation.hitRegions.length, POOL_SIZE)
  assert.equal(presentation.panelMesh.name, 'wrist-menu-command-slab')
  presentation.dispose()
})

test('renderItems binds at most POOL_SIZE rows from the presentation model', () => {
  const presentation = new WristMenuPresentation()
  presentation.renderItems(manyActions(POOL_SIZE + 5))
  const names = visibleRowNames(presentation)
  assert.equal(names.length, POOL_SIZE)
  assert.ok(names[0].endsWith(':row-0'))
  presentation.dispose()
})

test('setScrollOffset rebinds the pool to the new scroll window', () => {
  const presentation = new WristMenuPresentation()
  presentation.renderItems(manyActions(POOL_SIZE + 5))
  presentation.setScrollOffset(2)
  const names = visibleRowNames(presentation)
  assert.ok(names[0].endsWith(':row-2'))
  presentation.dispose()
})

test('separators and choice-group headers never expose interactive hit regions', () => {
  const presentation = new WristMenuPresentation()
  presentation.renderItems([
    { type: 'action', id: 'action-one', label: 'Action One', disabled: false },
    { type: 'separator', id: 'sep', label: 'Section' },
    {
      type: 'choice-group',
      id: 'shape',
      label: 'Shape',
      selectedValue: 'cube',
      options: [
        { id: 'opt-cube', label: 'Cube', value: 'cube', disabled: false },
        { id: 'opt-sphere', label: 'Sphere', value: 'sphere', disabled: false },
      ],
    },
    { type: 'action', id: 'action-two', label: 'Action Two', disabled: false },
  ])

  const interactiveIds = new Set([
    'action-one',
    'action-two',
    'opt-cube',
    'opt-sphere',
  ])
  for (const hit of presentation.hitRegions) {
    if (!hit.visible) continue
    const id = hit.userData['wristMenuItemId']
    assert.ok(
      interactiveIds.has(id),
      `unexpected interactive hit region id: ${id}`,
    )
  }
  presentation.dispose()
})

test('only fully-on-panel interactive rows expose visible hit regions', () => {
  const presentation = new WristMenuPresentation()
  presentation.renderItems(manyActions(POOL_SIZE + 5))
  presentation.setScrollOffset(0)

  const visibleHits = presentation.hitRegions.filter((hit) => hit.visible)
  assert.ok(
    visibleHits.length > 0 && visibleHits.length <= POOL_SIZE,
    `expected only pooled hit regions to be visible, got ${visibleHits.length}`,
  )
  for (const hit of visibleHits) {
    assert.equal(typeof hit.userData['wristMenuItemId'], 'string')
    assert.equal(typeof hit.userData['wristMenuDisabled'], 'boolean')
  }
  presentation.dispose()
})

test('setModel updates the bound interactive rows with the latest interaction state', () => {
  const presentation = new WristMenuPresentation()
  const items = [
    {
      type: 'action',
      id: 'spawn',
      label: 'Spawn',
      interaction: 'hovered',
      disabled: false,
    },
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
  presentation.renderItems(items)
  presentation.setModel(
    {
      visible: true,
      targetable: true,
      opacity: 1,
      revealPhase: 'visible',
      anchorPose: { position: [0, 0, 0], orientation: [0, 0, 0, 1] },
      revision: 1,
      items,
      scrollOffset: 0,
      totalRows: 2,
      visibleSlots: VISIBLE_SLOTS,
      scrollBarrierActive: false,
    },
    true,
  )

  const hoveredRow = presentation.group.children.find(
    (child) =>
      child.name === 'wrist-menu-action-visual:spawn' && child.visible,
  )
  assert.ok(hoveredRow !== undefined)
  assert.equal(hoveredRow.material.color.getHex(), 0x1d4438)

  const toggleRow = presentation.group.children.find(
    (child) =>
      child.name === 'wrist-menu-toggle-visual:grid' && child.visible,
  )
  assert.ok(toggleRow !== undefined)
  assert.equal(toggleRow.userData['wristMenuValue'], false)
  assert.equal(toggleRow.userData['wristMenuSelected'], false)
  presentation.dispose()
})
