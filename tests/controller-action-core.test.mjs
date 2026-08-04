import assert from 'node:assert/strict'
import test from 'node:test'

import { createWristMenuRuntime } from '../dist/core/index.js'
import {
  controllerActionSnapshot,
  frameSample,
  targetObservation,
} from '../fixtures/controller-action.mjs'

test('controller commits one Action Item only after release over the owned target', () => {
  const events = []
  const runtime = createWristMenuRuntime({
    snapshot: controllerActionSnapshot,
    onEvent: (event) => events.push(event),
  })

  const revealed = runtime.step(frameSample(1, false), [targetObservation])
  assert.equal(revealed.visible, true)
  assert.equal(revealed.targetable, false)
  assert.equal(revealed.items[0]?.interaction, 'idle')

  const hovered = runtime.step(frameSample(2, false), [targetObservation])
  assert.equal(hovered.targetable, true)
  assert.equal(hovered.items[0]?.interaction, 'hovered')

  const armed = runtime.step(frameSample(3, true), [targetObservation])
  assert.equal(armed.items[0]?.interaction, 'armed')
  assert.equal(runtime.blocksSceneInput('right-controller'), true)

  const committed = runtime.step(frameSample(4, false, true), [targetObservation])
  assert.equal(committed.items[0]?.interaction, 'hovered')
  assert.equal(runtime.blocksSceneInput('right-controller'), false)
  assert.deepEqual(events, [
    {
      type: 'selection-intent',
      intent: {
        type: 'action',
        itemId: 'spawn-cube',
      },
      source: {
        kind: 'controller',
        handedness: 'right',
      },
      menuWrist: 'left',
      time: 64,
    },
  ])

  runtime.step(frameSample(5, false), [targetObservation])
  assert.equal(events.length, 1)
})

test('controller release away from the owned Action Item cancels without an intent', () => {
  const events = []
  const runtime = createWristMenuRuntime({
    snapshot: controllerActionSnapshot,
    onEvent: (event) => events.push(event),
  })

  runtime.step(frameSample(1, false), [])
  runtime.step(frameSample(2, false), [targetObservation])
  runtime.step(frameSample(3, true), [targetObservation])
  runtime.step(frameSample(4, false, true), [])

  assert.deepEqual(events, [
    {
      type: 'selection-cancellation',
      itemId: 'spawn-cube',
      sourceId: 'right-controller',
      reason: 'released-away',
      time: 64,
    },
  ])
})

test('controller loss cancels ownership and a held replacement cannot rearm', () => {
  const events = []
  const runtime = createWristMenuRuntime({
    snapshot: controllerActionSnapshot,
    onEvent: (event) => events.push(event),
  })

  runtime.step(frameSample(1, false), [])
  runtime.step(frameSample(2, false), [targetObservation])
  runtime.step(frameSample(3, true), [targetObservation])
  assert.equal(runtime.blocksSceneInput('right-controller'), true)

  runtime.step(
    { ...frameSample(4, true), selectionSources: [] },
    [],
  )
  assert.equal(runtime.blocksSceneInput('right-controller'), false)
  assert.equal(events[0]?.type, 'selection-cancellation')
  assert.equal(events[0]?.reason, 'lifecycle-interrupted')

  const replacement = {
    ...frameSample(5, true),
    selectionSources: [
      {
        id: 'replacement-controller',
        kind: 'controller',
        handedness: 'right',
        selectPressed: true,
        selectCompleted: false,
      },
    ],
  }
  runtime.step(replacement, [
    { ...targetObservation, sourceId: 'replacement-controller' },
  ])
  assert.equal(runtime.blocksSceneInput('replacement-controller'), false)
  assert.equal(events.length, 1)
})

test('selectend without a successful select cancels instead of committing', () => {
  const events = []
  const runtime = createWristMenuRuntime({
    snapshot: controllerActionSnapshot,
    onEvent: (event) => events.push(event),
  })

  runtime.step(frameSample(1, false), [])
  runtime.step(frameSample(2, false), [targetObservation])
  runtime.step(frameSample(3, true), [targetObservation])
  runtime.step(frameSample(4, false, false), [targetObservation])

  assert.deepEqual(events, [
    {
      type: 'selection-cancellation',
      itemId: 'spawn-cube',
      sourceId: 'right-controller',
      reason: 'action-cancelled',
      time: 64,
    },
  ])
})
