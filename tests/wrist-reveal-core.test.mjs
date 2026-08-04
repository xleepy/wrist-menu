import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createWristMenuRuntime,
  defaultRevealConfiguration,
} from '../dist/core/index.js'
import {
  automaticHandSnapshot,
  identityPose,
  wristFrame,
} from '../fixtures/wrist-reveal.mjs'

function createRuntime(snapshot = automaticHandSnapshot) {
  const events = []
  const runtime = createWristMenuRuntime({
    snapshot,
    onEvent: (event) => events.push(event),
  })
  return { events, runtime }
}

test('automatic reveal applies dwell, hysteresis, and ordinary transitions by XR time', () => {
  const { runtime } = createRuntime()

  assert.deepEqual(defaultRevealConfiguration, {
    enterAngleDegrees: 35,
    exitAngleDegrees: 50,
    initialDwellMs: 300,
    reacquireDwellMs: 200,
    visualGraceMs: 250,
    transitionMs: 150,
  })

  assert.equal(runtime.step(wristFrame({ sequence: 1, time: 0 }), []).revealPhase, 'dwelling')
  assert.equal(runtime.step(wristFrame({ sequence: 2, time: 299 }), []).visible, false)

  const showing = runtime.step(wristFrame({ sequence: 3, time: 300 }), [])
  assert.equal(showing.revealPhase, 'showing')
  assert.equal(showing.opacity, 0)

  assert.equal(runtime.step(wristFrame({ sequence: 4, time: 375 }), []).opacity, 0.5)
  const revealed = runtime.step(wristFrame({ sequence: 5, time: 450 }), [])
  assert.equal(revealed.opacity, 1)
  assert.equal(revealed.targetable, false)
  assert.equal(runtime.step(wristFrame({ sequence: 6, time: 451 }), []).targetable, true)

  const withinHysteresis = wristFrame({ sequence: 7, time: 500 })
  withinHysteresis.viewerPosition = [0, -Math.cos(Math.PI / 4), Math.sin(Math.PI / 4)]
  assert.equal(runtime.step(withinHysteresis, []).revealPhase, 'visible')

  const outsideExit = wristFrame({ sequence: 8, time: 510 })
  outsideExit.viewerPosition = [0, -Math.cos((51 * Math.PI) / 180), Math.sin((51 * Math.PI) / 180)]
  assert.equal(runtime.step(outsideExit, []).revealPhase, 'hiding')
  assert.equal(runtime.step({ ...outsideExit, sequence: 9, time: 585 }, []).opacity, 0.5)
  assert.equal(runtime.step({ ...outsideExit, sequence: 10, time: 660 }, []).visible, false)
})

test('fixed and irregular frame traces converge at the same absolute times', () => {
  const replay = (times) => {
    const { runtime } = createRuntime()
    let model
    for (const [index, time] of times.entries()) {
      model = runtime.step(wristFrame({ sequence: index + 1, time }), [])
    }
    return {
      opacity: model.opacity,
      phase: model.revealPhase,
      visible: model.visible,
    }
  }

  assert.deepEqual(
    replay([0, 50, 100, 150, 200, 250, 300, 350, 400, 450]),
    replay([0, 73, 161, 299, 367, 450]),
  )
})

test('visibility events report automatic reveal and hide transitions', () => {
  const { events, runtime } = createRuntime()
  runtime.step(wristFrame({ sequence: 1, time: 0 }), [])
  runtime.step(wristFrame({ sequence: 2, time: 450 }), [])

  const outsideExit = wristFrame({ sequence: 3, time: 500 })
  outsideExit.viewerPosition = [0, 0, 1]
  runtime.step(outsideExit, [])
  runtime.step({ ...outsideExit, sequence: 4, time: 650 }, [])

  assert.deepEqual(
    events.filter(({ type }) => type === 'visibility-change'),
    [
      {
        type: 'visibility-change',
        visible: true,
        reason: 'automatic',
        time: 450,
      },
      {
        type: 'visibility-change',
        visible: false,
        reason: 'automatic',
        time: 650,
      },
    ],
  )
})

test('tracking loss is visual-only for 250 ms and reacquisition needs a fresh 200 ms dwell', () => {
  const { runtime } = createRuntime()
  for (const [sequence, time] of [0, 300, 450, 451].map((time, index) => [index + 1, time])) {
    runtime.step(wristFrame({ sequence, time }), [])
  }

  const lost = runtime.step(wristFrame({ sequence: 5, time: 500, pose: null }), [])
  assert.equal(lost.visible, true)
  assert.equal(lost.targetable, false)
  assert.equal(lost.revealPhase, 'tracking-grace')
  assert.equal(runtime.step(wristFrame({ sequence: 6, time: 749, pose: null }), []).visible, true)
  assert.equal(runtime.step(wristFrame({ sequence: 7, time: 750, pose: null }), []).visible, false)

  assert.equal(runtime.step(wristFrame({ sequence: 8, time: 800 }), []).revealPhase, 'reacquire-dwell')
  assert.equal(runtime.step(wristFrame({ sequence: 9, time: 999 }), []).visible, false)
  assert.equal(runtime.step(wristFrame({ sequence: 10, time: 1000 }), []).revealPhase, 'showing')
  assert.equal(runtime.step(wristFrame({ sequence: 11, time: 1150 }), []).opacity, 1)
})

for (const [label, frameOverrides] of [
  [
    'emulated wrist pose',
    { pose: { ...identityPose, emulatedPosition: true } },
  ],
  ['missing viewer pose', { viewerPosition: null }],
]) {
  test(`${label} enters the same 250 ms non-interactive tracking grace`, () => {
    const { runtime } = createRuntime()
    runtime.step(wristFrame({ sequence: 1, time: 0 }), [])
    runtime.step(wristFrame({ sequence: 2, time: 450 }), [])
    runtime.step(wristFrame({ sequence: 3, time: 451 }), [])

    const confidenceLost = runtime.step(
      wristFrame({ sequence: 4, time: 500, ...frameOverrides }),
      [],
    )
    assert.equal(confidenceLost.revealPhase, 'tracking-grace')
    assert.equal(confidenceLost.visible, true)
    assert.equal(confidenceLost.targetable, false)
    assert.equal(
      runtime.step(
        wristFrame({ sequence: 5, time: 749, ...frameOverrides }),
        [],
      ).visible,
      true,
    )
    assert.equal(
      runtime.step(
        wristFrame({ sequence: 6, time: 750, ...frameOverrides }),
        [],
      ).visible,
      false,
    )
  })
}

test('source replacement and lifecycle reset cancel and require fresh acquisition', () => {
  const { events, runtime } = createRuntime()
  runtime.step(wristFrame({ sequence: 1, time: 0 }), [])
  runtime.step(wristFrame({ sequence: 2, time: 300 }), [])
  runtime.step(wristFrame({ sequence: 3, time: 450 }), [])
  runtime.step(wristFrame({ sequence: 4, time: 451 }), [])

  const replaced = runtime.step(
    wristFrame({ sequence: 5, time: 500, sourceId: 'left-hand-replacement' }),
    [],
  )
  assert.equal(replaced.visible, false)
  assert.equal(replaced.revealPhase, 'reacquire-dwell')
  assert.equal(
    events.find(
      (event) =>
        event.type === 'visibility-change' && event.visible === false,
    )?.reason,
    'source-replaced',
  )

  runtime.step(wristFrame({ sequence: 6, time: 700, sourceId: 'left-hand-replacement' }), [])
  runtime.step(wristFrame({ sequence: 7, time: 850, sourceId: 'left-hand-replacement' }), [])
  const reset = runtime.step(
    wristFrame({
      sequence: 8,
      time: 900,
      sourceId: 'left-hand-replacement',
      lifecycleRevision: 1,
    }),
    [],
  )
  assert.equal(reset.visible, false)
  assert.equal(reset.revealPhase, 'reacquire-dwell')
})

test('explicit default comfort values do not trigger semantic reacquisition', () => {
  const { runtime } = createRuntime()
  runtime.step(wristFrame({ sequence: 1, time: 0 }), [])
  runtime.step(wristFrame({ sequence: 2, time: 450 }), [])
  runtime.step(wristFrame({ sequence: 3, time: 451 }), [])

  runtime.sync({
    ...automaticHandSnapshot,
    comfort: { ...defaultRevealConfiguration },
  })
  const synchronized = runtime.step(wristFrame({ sequence: 4, time: 452 }), [])

  assert.equal(synchronized.visible, true)
  assert.equal(synchronized.revealPhase, 'visible')
})

test('Controller Wrist Proxy presets mirror Quest 2 candidate A and leave unknown devices neutral', () => {
  const modelFor = (wrist, controllerWrist) => {
    const { runtime } = createRuntime({
      ...automaticHandSnapshot,
      activationMode: 'forced-open',
      wrist,
      controllerWrist,
    })
    runtime.step(
      wristFrame({
        sequence: 1,
        time: 0,
        wrist,
        sourceId: `${wrist}-controller`,
        kind: 'controller',
        viewerPosition: null,
      }),
      [],
    )
    return runtime.step(
      wristFrame({
        sequence: 2,
        time: 150,
        wrist,
        sourceId: `${wrist}-controller`,
        kind: 'controller',
        viewerPosition: null,
      }),
      [],
    )
  }

  assert.deepEqual(modelFor('left', { deviceTarget: 'quest-2' }).anchorPose.position, [0.02, 0.096, 0.008])
  assert.deepEqual(modelFor('right', { deviceTarget: 'quest-2' }).anchorPose.position, [-0.02, 0.096, 0.008])
  assert.deepEqual(modelFor('left', { deviceTarget: 'unknown' }).anchorPose.position, [0, 0.09, 0])

  const explicit = modelFor('right', {
    deviceTarget: 'quest-2',
    offsets: {
      right: { translationMeters: [1, 2, 3], rotationDegrees: [0, 0, 0] },
    },
  })
  assert.deepEqual(explicit.anchorPose.position, [1, 2, 3])
})

test('forced modes bypass facing confidence but never XR lifecycle safety', () => {
  const { runtime } = createRuntime({
    ...automaticHandSnapshot,
    activationMode: 'forced-open',
    controllerWrist: { deviceTarget: 'unknown' },
  })
  const lowConfidencePose = { ...identityPose, emulatedPosition: true }

  runtime.step(wristFrame({ sequence: 1, time: 0, kind: 'controller', pose: lowConfidencePose, viewerPosition: null }), [])
  assert.equal(runtime.step(wristFrame({ sequence: 2, time: 150, kind: 'controller', pose: lowConfidencePose, viewerPosition: null }), []).visible, true)
  assert.equal(runtime.step(wristFrame({ sequence: 3, time: 151, kind: 'controller', pose: lowConfidencePose, viewerPosition: null, visibility: 'hidden' }), []).visible, false)

  runtime.sync({ ...automaticHandSnapshot, activationMode: 'disabled' })
  const disabled = runtime.step(wristFrame({ sequence: 4, time: 200 }), [])
  assert.equal(disabled.visible, false)
  assert.equal(disabled.targetable, false)
})

test('forced closed uses the ordinary hide transition', () => {
  const { runtime } = createRuntime({
    ...automaticHandSnapshot,
    activationMode: 'forced-open',
  })
  runtime.step(wristFrame({ sequence: 1, time: 0 }), [])
  runtime.step(wristFrame({ sequence: 2, time: 150 }), [])

  runtime.sync({ ...automaticHandSnapshot, activationMode: 'forced-closed' })
  const hiding = runtime.step(wristFrame({ sequence: 3, time: 200 }), [])
  assert.equal(hiding.revealPhase, 'hiding')
  assert.equal(hiding.opacity, 1)
  assert.equal(runtime.step(wristFrame({ sequence: 4, time: 275 }), []).opacity, 0.5)
  assert.equal(runtime.step(wristFrame({ sequence: 5, time: 350 }), []).visible, false)
})

test('disposal remains terminal when a cancellation callback throws', () => {
  const runtime = createWristMenuRuntime({
    snapshot: {
      ...automaticHandSnapshot,
      activationMode: 'forced-open',
      comfort: { transitionMs: 0 },
      controllerWrist: {
        offsets: {
          left: {
            translationMeters: [0, 0, 0],
            rotationDegrees: [0, 0, 0],
          },
        },
      },
    },
    onEvent(event) {
      if (event.type === 'selection-cancellation') throw new Error('host failure')
    },
  })
  const selectionSources = [
    {
      id: 'right-controller',
      kind: 'controller',
      handedness: 'right',
      selectPressed: false,
      selectCompleted: false,
    },
  ]
  const observation = {
    sourceId: 'right-controller',
    kind: 'controller-target-ray',
    itemId: 'spawn-cube',
  }
  runtime.step(wristFrame({ sequence: 1, time: 0, kind: 'controller', selectionSources }), [])
  runtime.step(wristFrame({ sequence: 2, time: 1, kind: 'controller', selectionSources }), [observation])
  runtime.step(
    wristFrame({
      sequence: 3,
      time: 2,
      kind: 'controller',
      selectionSources: [{ ...selectionSources[0], selectPressed: true }],
    }),
    [observation],
  )

  assert.throws(() => runtime.dispose(), /host failure/)
  assert.throws(
    () => runtime.step(wristFrame({ sequence: 4, time: 3 }), []),
    /disposed/,
  )
})
