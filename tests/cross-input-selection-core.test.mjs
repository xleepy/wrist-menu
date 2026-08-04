import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createWristMenuRuntimeState,
  stepWristMenuRuntime,
  syncWristMenuRuntime,
  wristMenuRuntimeBlocksSceneInput,
} from '../dist/core/index.js'
import {
  controllerSample,
  controllerTarget,
  crossInputSnapshot,
  handSample,
  handTarget,
  selectionFrame,
} from '../fixtures/cross-input-selection.mjs'

function createRuntime(onEvent) {
  return createWristMenuRuntimeState({ snapshot: crossInputSnapshot, onEvent })
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
  stepWristMenuRuntime(controller, selectionFrame(1, [controllerSample()]), [])
  stepWristMenuRuntime(controller, selectionFrame(2, [controllerSample()]), [
    controllerTarget('first'),
  ])
  stepWristMenuRuntime(controller, selectionFrame(3, [controllerSample({ pressed: true })]), [
    controllerTarget('first'),
  ])
  stepWristMenuRuntime(
    controller,
    selectionFrame(4, [controllerSample({ completed: true })]),
    [controllerTarget('first')],
  )

  const handEvents = []
  const hand = createRuntime((event) => handEvents.push(event))
  stepWristMenuRuntime(hand, selectionFrame(1, [handSample()]), [])
  stepWristMenuRuntime(hand, selectionFrame(2, [handSample()]), [handTarget('first', 'hover')])
  assert.equal(wristMenuRuntimeBlocksSceneInput(hand, 'right-hand'), true)
  stepWristMenuRuntime(hand, selectionFrame(3, [handSample()]), [handTarget('first', 'pressed')])

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
  assert.equal(wristMenuRuntimeBlocksSceneInput(hand, 'right-hand'), true)
  stepWristMenuRuntime(hand, selectionFrame(4, [handSample()]), [])
  assert.equal(wristMenuRuntimeBlocksSceneInput(hand, 'right-hand'), false)
})

test('an owned source never transfers between Menu Items and must neutralize before rearming', () => {
  const events = []
  const runtime = createRuntime((event) => events.push(event))
  stepWristMenuRuntime(runtime, selectionFrame(1, [controllerSample()]), [])
  stepWristMenuRuntime(runtime, selectionFrame(2, [controllerSample()]), [
    controllerTarget('first'),
  ])
  stepWristMenuRuntime(runtime, selectionFrame(3, [controllerSample({ pressed: true })]), [
    controllerTarget('first'),
  ])

  stepWristMenuRuntime(runtime, selectionFrame(4, [controllerSample({ pressed: true })]), [
    controllerTarget('second'),
  ])
  stepWristMenuRuntime(
    runtime,
    selectionFrame(5, [controllerSample({ pressed: true, completed: true })]),
    [controllerTarget('second')],
  )
  assert.equal(wristMenuRuntimeBlocksSceneInput(runtime, 'right-controller'), true)
  assert.deepEqual(semanticEvents(events), [
    {
      type: 'selection-cancellation',
      itemId: 'first',
      sourceId: 'right-controller',
      reason: 'target-changed',
      time: 40,
    },
  ])

  stepWristMenuRuntime(runtime, selectionFrame(6, [controllerSample()]), [
    controllerTarget('second'),
  ])
  assert.equal(wristMenuRuntimeBlocksSceneInput(runtime, 'right-controller'), false)
  stepWristMenuRuntime(runtime, selectionFrame(7, [controllerSample({ pressed: true })]), [
    controllerTarget('second'),
  ])
  stepWristMenuRuntime(
    runtime,
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
  stepWristMenuRuntime(runtime, selectionFrame(1, [handSample()]), [])
  stepWristMenuRuntime(runtime, selectionFrame(2, [handSample()]), [handTarget('first', 'hover')])
  stepWristMenuRuntime(runtime, selectionFrame(3, [handSample()]), [handTarget('second', 'pressed')])
  stepWristMenuRuntime(runtime, selectionFrame(4, [handSample()]), [handTarget('second', 'pressed')])

  assert.deepEqual(semanticEvents(events), [
    {
      type: 'selection-cancellation',
      itemId: 'first',
      sourceId: 'right-hand',
      reason: 'target-changed',
      time: 30,
    },
  ])

  stepWristMenuRuntime(runtime, selectionFrame(5, [handSample()]), [])
  stepWristMenuRuntime(runtime, selectionFrame(6, [handSample()]), [handTarget('second', 'hover')])
  stepWristMenuRuntime(runtime, selectionFrame(7, [handSample()]), [handTarget('second', 'pressed')])
  assert.equal(
    semanticEvents(events).filter(({ type }) => type === 'selection-intent')
      .length,
    1,
  )
})

test('tracking loss and source replacement cancel without rearming inside the Hit Region', () => {
  const events = []
  const runtime = createRuntime((event) => events.push(event))
  stepWristMenuRuntime(runtime, selectionFrame(1, [handSample()]), [])
  stepWristMenuRuntime(runtime, selectionFrame(2, [handSample()]), [handTarget('first', 'hover')])
  stepWristMenuRuntime(runtime, selectionFrame(3, []), [])

  const replacement = handSample('replacement-hand')
  stepWristMenuRuntime(runtime, selectionFrame(4, [replacement]), [
    handTarget('second', 'pressed', replacement.id),
  ])
  stepWristMenuRuntime(runtime, selectionFrame(5, [replacement]), [
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

  stepWristMenuRuntime(runtime, selectionFrame(6, [replacement]), [])
  stepWristMenuRuntime(runtime, selectionFrame(7, [replacement]), [
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
    stepWristMenuRuntime(runtime, selectionFrame(1, [controllerSample()]), [])
    stepWristMenuRuntime(runtime, selectionFrame(2, [controllerSample()]), [
      controllerTarget('first'),
    ])
    stepWristMenuRuntime(runtime, selectionFrame(3, [controllerSample({ pressed: true })]), [
      controllerTarget('first'),
    ])
    syncWristMenuRuntime(runtime, nextSnapshot)
    stepWristMenuRuntime(runtime, selectionFrame(4, [controllerSample({ pressed: true })]), [
      controllerTarget('second'),
    ])

    assert.equal(wristMenuRuntimeBlocksSceneInput(runtime, 'right-controller'), false)
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
    stepWristMenuRuntime(
      runtime,
      selectionFrame(1, [observations[0][0]]),
      [],
    )
    for (let index = 0; index < observations.length; index += 1) {
      const [sample, observation] = observations[index]
      const model = stepWristMenuRuntime(runtime, selectionFrame(index + 2, [sample]), [observation])
      assert.equal(model.items[2].interaction, 'hovered')
      assert.equal(wristMenuRuntimeBlocksSceneInput(runtime, source), false)
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
  stepWristMenuRuntime(runtime, selectionFrame(1, [handSample()]), [])
  stepWristMenuRuntime(runtime, selectionFrame(2, [handSample()]), [handTarget('first', 'hover')])
  assert.throws(
    () =>
      stepWristMenuRuntime(runtime, selectionFrame(3, [handSample()]), [
        handTarget('first', 'pressed'),
      ]),
    /Host callback failed/,
  )
  assert.equal(wristMenuRuntimeBlocksSceneInput(runtime, 'right-hand'), true)
  stepWristMenuRuntime(runtime, selectionFrame(4, [handSample()]), [handTarget('first', 'pressed')])
  assert.equal(commits, 1)
  stepWristMenuRuntime(runtime, selectionFrame(5, [handSample()]), [])
  assert.equal(wristMenuRuntimeBlocksSceneInput(runtime, 'right-hand'), false)
})
