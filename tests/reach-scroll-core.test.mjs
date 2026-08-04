import assert from 'node:assert/strict'
import test from 'node:test'

import {
  VISIBLE_SLOTS,
  createScrollState,
  advanceScrollState,
  releaseScrollOwnership,
  resetScrollState,
  setScrollBarrier,
} from '../dist/core/scroll-state.js'
import {
  createWristMenuRuntimeState,
  disposeWristMenuRuntime,
  stepWristMenuRuntime,
} from '../dist/core/index.js'
import {
  reachScrollSnapshot,
  scrollSource,
  scrollFrame,
  ROW_SPACING,
} from '../fixtures/reach-scroll.mjs'

function createRuntime(onEvent = () => undefined) {
  return createWristMenuRuntimeState({
    snapshot: reachScrollSnapshot,
    onEvent,
  })
}

test('createScrollState exposes a neutral initial state', () => {
  const state = createScrollState()
  assert.deepEqual(state, {
    offset: 0,
    ownerSourceId: null,
    ownerKind: null,
    ownerStartY: 0,
    ownerStartOffset: 0,
    barrierActive: false,
    lastSequence: 0,
  })
})

test('advanceScrollState reports the fixed visibleSlots and totalRows for the current frame', () => {
  const state = createScrollState()
  const result = advanceScrollState(
    state,
    1,
    reachScrollSnapshot.menuDefinition.length,
    [],
  )
  assert.equal(result.visibleSlots, VISIBLE_SLOTS)
  assert.equal(
    result.totalRows,
    reachScrollSnapshot.menuDefinition.length,
  )
  assert.equal(result.scrollOwned, false)
  assert.equal(result.barrierActive, false)
  assert.equal(result.offset, 0)
})

test('a panel-targeting source acquires ownership and translates Y motion into rows', () => {
  const state = createScrollState()
  const totalRows = VISIBLE_SLOTS + 5
  advanceScrollState(state, 1, totalRows, [
    scrollSource({ id: 'right-hand', positionY: 0 }),
  ])
  const moved = advanceScrollState(state, 2, totalRows, [
    scrollSource({ id: 'right-hand', positionY: -ROW_SPACING }),
  ])
  assert.equal(moved.scrollOwned, true)
  assert.equal(moved.offset, 1)
})

test('non-targeting sources never acquire ownership', () => {
  const state = createScrollState()
  const result = advanceScrollState(state, 1, 100, [
    scrollSource({ id: 'right-hand', targetingPanel: false }),
  ])
  assert.equal(result.scrollOwned, false)
  assert.equal(result.offset, 0)
})

test('advanceScrollState clamps to the [0, totalRows - visibleSlots] window on both ends', () => {
  const state = createScrollState()
  const totalRows = VISIBLE_SLOTS + 5
  advanceScrollState(state, 1, totalRows, [
    scrollSource({ id: 'right-hand', positionY: 0 }),
  ])

  const farDown = advanceScrollState(state, 2, totalRows, [
    scrollSource({ id: 'right-hand', positionY: -10 }),
  ])
  assert.equal(farDown.offset, totalRows - VISIBLE_SLOTS)

  const farUp = advanceScrollState(state, 3, totalRows, [
    scrollSource({ id: 'right-hand', positionY: 10 }),
  ])
  assert.equal(farUp.offset, 0)
})

test('ownership releases by id and arms the barrier until the sequence advances', () => {
  const state = createScrollState()
  advanceScrollState(state, 1, 100, [scrollSource({ id: 'right-hand' })])
  releaseScrollOwnership(state, 'right-hand')
  assert.equal(state.ownerSourceId, null)
  assert.equal(state.barrierActive, true)

  const sameSeq = advanceScrollState(state, 1, 100, [
    scrollSource({ id: 'right-hand' }),
  ])
  assert.equal(sameSeq.barrierActive, true)
  assert.equal(sameSeq.scrollOwned, true)

  releaseScrollOwnership(state, 'right-hand')
  const nextSeq = advanceScrollState(state, 2, 100, [
    scrollSource({ id: 'right-hand' }),
  ])
  assert.equal(nextSeq.barrierActive, false)
})

test('releaseScrollOwnership ignores requests for unknown sources', () => {
  const state = createScrollState()
  advanceScrollState(state, 1, 100, [scrollSource({ id: 'right-hand' })])
  releaseScrollOwnership(state, 'wrong-source')
  assert.equal(state.ownerSourceId, 'right-hand')
  assert.equal(state.barrierActive, false)
})

test('a disappeared owner clears ownership without arming the barrier', () => {
  const state = createScrollState()
  advanceScrollState(state, 1, 100, [scrollSource({ id: 'right-hand' })])
  const result = advanceScrollState(state, 2, 100, [])
  assert.equal(result.scrollOwned, false)
  assert.equal(state.ownerSourceId, null)
  assert.equal(state.barrierActive, false)
})

test('setScrollBarrier arms the barrier until the sequence advances', () => {
  const state = createScrollState()
  advanceScrollState(state, 1, 100, [])
  setScrollBarrier(state)
  const held = advanceScrollState(state, 1, 100, [])
  assert.equal(held.barrierActive, true)
  const released = advanceScrollState(state, 2, 100, [])
  assert.equal(released.barrierActive, false)
})

test('resetScrollState restores the neutral initial state', () => {
  const state = createScrollState()
  advanceScrollState(state, 1, 100, [scrollSource({ id: 'right-hand' })])
  releaseScrollOwnership(state, 'right-hand')
  resetScrollState(state)
  assert.deepEqual(
    {
      offset: state.offset,
      ownerSourceId: state.ownerSourceId,
      ownerKind: state.ownerKind,
      ownerStartY: state.ownerStartY,
      ownerStartOffset: state.ownerStartOffset,
      barrierActive: state.barrierActive,
    },
    {
      offset: 0,
      ownerSourceId: null,
      ownerKind: null,
      ownerStartY: 0,
      ownerStartOffset: 0,
      barrierActive: false,
    },
  )
})

test('the runtime exposes scrollOffset and barrier flags on the Presentation Model', () => {
  const runtime = createRuntime()
  const model = stepWristMenuRuntime(
    runtime,
    scrollFrame(1, [scrollSource({ id: 'right-hand', positionY: 0 })]),
    [],
  )
  assert.equal(model.scrollOffset, 0)
  assert.equal(model.visibleSlots, VISIBLE_SLOTS)
  assert.equal(model.totalRows, reachScrollSnapshot.menuDefinition.length)
  assert.equal(model.scrollBarrierActive, false)

  const scrolled = stepWristMenuRuntime(
    runtime,
    scrollFrame(2, [scrollSource({ id: 'right-hand', positionY: -ROW_SPACING })]),
    [],
  )
  assert.equal(scrolled.scrollOffset, 1)
})

test('runtime scroll ownership releases and rearms across the barrier without dropouts', () => {
  const runtime = createRuntime()
  stepWristMenuRuntime(
    runtime,
    scrollFrame(1, [scrollSource({ id: 'right-hand', positionY: 0 })]),
    [],
  )
  stepWristMenuRuntime(runtime, scrollFrame(2, []), [])
  const after = stepWristMenuRuntime(
    runtime,
    scrollFrame(3, [scrollSource({ id: 'right-hand', positionY: 0 })]),
    [],
  )
  assert.equal(after.scrollOffset, 0)
  assert.equal(after.scrollBarrierActive, false)
  disposeWristMenuRuntime(runtime)
})