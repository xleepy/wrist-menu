import assert from 'node:assert/strict'
import test from 'node:test'

import { createWristMenuRuntime } from '../dist/core/index.js'
import {
  controllerSample,
  controllerTarget,
  crossInputSnapshot,
  handSample,
  handTarget,
  selectionFrame,
} from '../fixtures/cross-input-selection.mjs'

function createRuntime(onEvent) {
  return createWristMenuRuntime({ snapshot: crossInputSnapshot, onEvent })
}

function semanticEvents(events) {
  return events.filter(
    ({ type }) =>
      type === 'selection-intent' || type === 'selection-cancellation',
  )
}

test('hand press-plane crossing and controller release commit the same semantic intent', () => {
  const controllerEvents = []
  const controller = createRuntime((event) => controllerEvents.push(event))
  controller.step(selectionFrame(1, [controllerSample()]), [])
  controller.step(selectionFrame(2, [controllerSample()]), [
    controllerTarget('first'),
  ])
  controller.step(selectionFrame(3, [controllerSample({ pressed: true })]), [
    controllerTarget('first'),
  ])
  controller.step(
    selectionFrame(4, [controllerSample({ completed: true })]),
    [controllerTarget('first')],
  )

  const handEvents = []
  const hand = createRuntime((event) => handEvents.push(event))
  hand.step(selectionFrame(1, [handSample()]), [])
  hand.step(selectionFrame(2, [handSample()]), [handTarget('first', 'hover')])
  assert.equal(hand.blocksSceneInput('right-hand'), true)
  hand.step(selectionFrame(3, [handSample()]), [handTarget('first', 'pressed')])

  const controllerCommit = semanticEvents(controllerEvents)[0]
  const handCommit = semanticEvents(handEvents)[0]
  assert.deepEqual(controllerCommit.intent, { type: 'action', itemId: 'first' })
  assert.deepEqual(handCommit.intent, controllerCommit.intent)
  assert.deepEqual(controllerCommit.source, {
    id: 'right-controller',
    kind: 'controller',
    handedness: 'right',
  })
  assert.deepEqual(handCommit.source, {
    id: 'right-hand',
    kind: 'hand',
    handedness: 'right',
  })
  assert.equal(hand.blocksSceneInput('right-hand'), true)
  hand.step(selectionFrame(4, [handSample()]), [])
  assert.equal(hand.blocksSceneInput('right-hand'), false)
})

test('an owned source never transfers between Menu Items and must neutralize before rearming', () => {
  const events = []
  const runtime = createRuntime((event) => events.push(event))
  runtime.step(selectionFrame(1, [controllerSample()]), [])
  runtime.step(selectionFrame(2, [controllerSample()]), [
    controllerTarget('first'),
  ])
  runtime.step(selectionFrame(3, [controllerSample({ pressed: true })]), [
    controllerTarget('first'),
  ])

  runtime.step(selectionFrame(4, [controllerSample({ pressed: true })]), [
    controllerTarget('second'),
  ])
  runtime.step(
    selectionFrame(5, [controllerSample({ pressed: true, completed: true })]),
    [controllerTarget('second')],
  )
  assert.equal(runtime.blocksSceneInput('right-controller'), true)
  assert.deepEqual(semanticEvents(events), [
    {
      type: 'selection-cancellation',
      itemId: 'first',
      sourceId: 'right-controller',
      reason: 'target-changed',
      time: 40,
    },
  ])

  runtime.step(selectionFrame(6, [controllerSample()]), [
    controllerTarget('second'),
  ])
  assert.equal(runtime.blocksSceneInput('right-controller'), false)
  runtime.step(selectionFrame(7, [controllerSample({ pressed: true })]), [
    controllerTarget('second'),
  ])
  runtime.step(
    selectionFrame(8, [controllerSample({ completed: true })]),
    [controllerTarget('second')],
  )
  assert.equal(
    semanticEvents(events).filter(({ type }) => type === 'selection-intent')
      .length,
    1,
  )
})

test('a direct hand moving between items cancels and cannot transfer before withdrawal', () => {
  const events = []
  const runtime = createRuntime((event) => events.push(event))
  runtime.step(selectionFrame(1, [handSample()]), [])
  runtime.step(selectionFrame(2, [handSample()]), [handTarget('first', 'hover')])
  runtime.step(selectionFrame(3, [handSample()]), [handTarget('second', 'pressed')])
  runtime.step(selectionFrame(4, [handSample()]), [handTarget('second', 'pressed')])

  assert.deepEqual(semanticEvents(events), [
    {
      type: 'selection-cancellation',
      itemId: 'first',
      sourceId: 'right-hand',
      reason: 'target-changed',
      time: 30,
    },
  ])

  runtime.step(selectionFrame(5, [handSample()]), [])
  runtime.step(selectionFrame(6, [handSample()]), [handTarget('second', 'hover')])
  runtime.step(selectionFrame(7, [handSample()]), [handTarget('second', 'pressed')])
  assert.equal(
    semanticEvents(events).filter(({ type }) => type === 'selection-intent')
      .length,
    1,
  )
})

test('tracking loss and source replacement cancel without rearming inside the Hit Region', () => {
  const events = []
  const runtime = createRuntime((event) => events.push(event))
  runtime.step(selectionFrame(1, [handSample()]), [])
  runtime.step(selectionFrame(2, [handSample()]), [handTarget('first', 'hover')])
  runtime.step(selectionFrame(3, []), [])

  const replacement = handSample('replacement-hand')
  runtime.step(selectionFrame(4, [replacement]), [
    handTarget('second', 'pressed', replacement.id),
  ])
  runtime.step(selectionFrame(5, [replacement]), [
    handTarget('second', 'pressed', replacement.id),
  ])
  assert.deepEqual(semanticEvents(events), [
    {
      type: 'selection-cancellation',
      itemId: 'first',
      sourceId: 'right-hand',
      reason: 'lifecycle-interrupted',
      time: 30,
    },
  ])

  runtime.step(selectionFrame(6, [replacement]), [])
  runtime.step(selectionFrame(7, [replacement]), [
    handTarget('second', 'pressed', replacement.id),
  ])
  assert.equal(
    semanticEvents(events).filter(({ type }) => type === 'selection-intent')
      .length,
    1,
  )
})

for (const [label, nextSnapshot] of [
  [
    'menu closure',
    { ...crossInputSnapshot, activationMode: 'forced-closed' },
  ],
  [
    'wrist switching',
    { ...crossInputSnapshot, wrist: 'right' },
  ],
  [
    'Menu Definition replacement',
    {
      ...crossInputSnapshot,
      menuDefinition: [crossInputSnapshot.menuDefinition[1]],
    },
  ],
]) {
  test(`${label} cancels ownership and a held controller cannot rearm`, () => {
    const events = []
    const runtime = createRuntime((event) => events.push(event))
    runtime.step(selectionFrame(1, [controllerSample()]), [])
    runtime.step(selectionFrame(2, [controllerSample()]), [
      controllerTarget('first'),
    ])
    runtime.step(selectionFrame(3, [controllerSample({ pressed: true })]), [
      controllerTarget('first'),
    ])
    runtime.sync(nextSnapshot)
    runtime.step(selectionFrame(4, [controllerSample({ pressed: true })]), [
      controllerTarget('second'),
    ])

    assert.equal(runtime.blocksSceneInput('right-controller'), false)
    assert.equal(
      semanticEvents(events).filter(({ type }) => type === 'selection-intent')
        .length,
      0,
    )
    assert.equal(
      semanticEvents(events).at(-1)?.reason,
      'host-snapshot-changed',
    )
  })
}

test('disabled items may hover but neither source can commit or claim them', () => {
  for (const [source, observations] of [
    [
      'right-controller',
      [
        [controllerSample(), controllerTarget('disabled')],
        [controllerSample({ pressed: true }), controllerTarget('disabled')],
        [controllerSample({ completed: true }), controllerTarget('disabled')],
      ],
    ],
    [
      'right-hand',
      [
        [handSample(), handTarget('disabled', 'hover')],
        [handSample(), handTarget('disabled', 'pressed')],
      ],
    ],
  ]) {
    const events = []
    const runtime = createRuntime((event) => events.push(event))
    runtime.step(
      selectionFrame(1, [observations[0][0]]),
      [],
    )
    for (let index = 0; index < observations.length; index += 1) {
      const [sample, observation] = observations[index]
      const model = runtime.step(selectionFrame(index + 2, [sample]), [observation])
      assert.equal(model.items[2].interaction, 'hovered')
      assert.equal(runtime.blocksSceneInput(source), false)
    }
    assert.deepEqual(semanticEvents(events), [])
  }
})

test('a throwing commit callback leaves a hand neutral and never retries the intent', () => {
  let commits = 0
  const runtime = createRuntime((event) => {
    if (event.type === 'selection-intent') {
      commits += 1
      throw new Error('Host callback failed')
    }
  })
  runtime.step(selectionFrame(1, [handSample()]), [])
  runtime.step(selectionFrame(2, [handSample()]), [handTarget('first', 'hover')])
  assert.throws(
    () =>
      runtime.step(selectionFrame(3, [handSample()]), [
        handTarget('first', 'pressed'),
      ]),
    /Host callback failed/,
  )
  assert.equal(runtime.blocksSceneInput('right-hand'), true)
  runtime.step(selectionFrame(4, [handSample()]), [handTarget('first', 'pressed')])
  assert.equal(commits, 1)
  runtime.step(selectionFrame(5, [handSample()]), [])
  assert.equal(runtime.blocksSceneInput('right-hand'), false)
})
