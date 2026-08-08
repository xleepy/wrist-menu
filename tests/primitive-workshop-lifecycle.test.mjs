import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  createWristMenuRuntimeState,
  disposeWristMenuRuntime,
  stepWristMenuRuntime,
  wristMenuRuntimeBlocksSceneInput,
  WRIST_MENU_PACKAGE_VERSION,
} from '../dist/core/index.js'
import {
  createWorkshopModel,
  createWorkshopScenario,
  reduceWorkshop,
  workshopHostSnapshot,
} from '../examples/primitive-workshop/shared/workshop-model.js'
import {
  workshopInputLanes,
  workshopScenarioNames,
} from '../fixtures/primitive-workshop-lifecycle.mjs'
import {
  controllerSample,
  controllerTarget,
  selectionFrame,
} from '../fixtures/cross-input-selection.mjs'

class FakeSession {
  constructor(inputSources = []) {
    this.inputSources = inputSources
    this.visibilityState = 'visible'
    this.listeners = new Map()
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener)
  }

  dispatch(type) {
    for (const listener of this.listeners.get(type) ?? []) listener({ type })
  }

  replaceSources(inputSources) {
    this.inputSources = inputSources
    this.dispatch('inputsourceschange')
  }

  setVisibility(visibilityState) {
    this.visibilityState = visibilityState
    this.dispatch('visibilitychange')
  }
}

function inputSource(handedness, kind) {
  return {
    handedness,
    ...(kind === 'hand' ? { hand: {} } : {}),
  }
}

const variantAdapters = [
  {
    name: 'vanilla',
    load: () =>
      import('../examples/primitive-workshop/vanilla/lifecycle.js'),
  },
  {
    name: 'react',
    load: () => import('../examples/primitive-workshop/react/lifecycle.js'),
  },
]

for (const variant of variantAdapters) {
  test(`${variant.name} preserves the Workshop Model through interruption and re-entry`, async () => {
    const { createWorkshopLifecycle } = await variant.load()
    const cleared = []
    const lifecycle = createWorkshopLifecycle({
      clearTransientInteraction: (reason) => cleared.push(reason),
    })
    const cursorModel = reduceWorkshop(createWorkshopModel(), {
      actionId: 'lifecycle-valid-cursor',
      action: { type: 'place-cursor', position: [0.5, 0, -0.5], valid: true },
    })
    const preservedModel = reduceWorkshop(cursorModel, {
      actionId: 'lifecycle-model-change',
      action: { type: 'choose-primitive', primitive: 'sphere' },
    })

    lifecycle.beginSessionRequest()
    lifecycle.sessionRejected(new Error('Permission denied'))
    assert.equal(lifecycle.snapshot().runtimeStatus, 'rejected')
    assert.match(lifecycle.snapshot().diagnostic.message, /Permission denied/)
    assert.equal(lifecycle.snapshot().diagnostic.nextAction, 'Retry Enter VR')

    lifecycle.beginSessionRequest()
    const handSession = new FakeSession([
      inputSource('left', 'hand'),
      inputSource('right', 'hand'),
    ])
    lifecycle.sessionActivated(handSession)
    lifecycle.markCursorAvailable()
    assert.equal(lifecycle.snapshot().inputMode, 'hand')
    assert.deepEqual(lifecycle.snapshot().availableWrists, ['left', 'right'])
    assert.equal(lifecycle.snapshot().cursorAvailable, true)

    handSession.setVisibility('visible-blurred')
    assert.equal(lifecycle.snapshot().runtimeStatus, 'blurred')
    assert.equal(lifecycle.snapshot().cursorAvailable, false)
    handSession.setVisibility('hidden')
    assert.equal(lifecycle.snapshot().runtimeStatus, 'hidden')
    handSession.setVisibility('visible')

    handSession.replaceSources([
      inputSource('left', 'controller'),
      inputSource('right', 'controller'),
    ])
    assert.equal(lifecycle.snapshot().inputMode, 'controller')
    assert.equal(lifecycle.snapshot().cursorAvailable, false)
    assert.ok(cleared.includes('input-mode-changed'))
    assert.equal(preservedModel.placementCursor.valid, true)
    assert.equal(
      workshopHostSnapshot(preservedModel, {
        cursorAvailable: lifecycle.snapshot().cursorAvailable,
      }).menuDefinition.find((entry) => entry.id === 'spawn-primitive')
        .disabledReason,
      'Aim at the table first',
    )

    handSession.replaceSources([])
    assert.equal(lifecycle.snapshot().runtimeStatus, 'tracking-lost')
    assert.equal(lifecycle.snapshot().diagnostic.nextAction, 'Restore tracking')

    handSession.dispatch('end')
    assert.equal(lifecycle.snapshot().runtimeStatus, 'ended')
    assert.equal(lifecycle.snapshot().diagnostic.nextAction, 'Enter VR again')

    lifecycle.beginSessionRequest()
    const reentered = new FakeSession([inputSource('right', 'hand')])
    lifecycle.sessionActivated(reentered)
    assert.equal(lifecycle.snapshot().runtimeStatus, 'active')
    assert.equal(lifecycle.snapshot().sessionRevision, 2)
    assert.equal(lifecycle.snapshot().cursorAvailable, false)
    assert.equal(preservedModel.selectedPrimitive, 'sphere')
    assert.equal(preservedModel.revision, 2)
    lifecycle.dispose()
  })

  test(`${variant.name} accepts hand and controller sources on both menu wrists`, async () => {
    const { createWorkshopLifecycle } = await variant.load()
    for (const lane of workshopInputLanes) {
      const lifecycle = createWorkshopLifecycle()
      lifecycle.beginSessionRequest()
      const session = new FakeSession([
        inputSource('left', lane.kind),
        inputSource('right', lane.kind),
      ])
      lifecycle.sessionActivated(session)
      const state = lifecycle.snapshot()
      assert.equal(state.inputMode, lane.kind)
      assert.ok(state.availableWrists.includes(lane.menuWrist))
      lifecycle.dispose()
    }
  })
}

test('the long Workshop Menu scrolls continuously in every shared input lane', () => {
  const menuDefinition = workshopHostSnapshot(createWorkshopModel()).menuDefinition
  assert.ok(menuDefinition.length > 6)

  for (const [index, lane] of workshopInputLanes.entries()) {
    const runtime = createWristMenuRuntimeState({
      snapshot: {
        ...workshopHostSnapshot(createWorkshopModel()),
        wrist: lane.menuWrist,
        activationMode: 'forced-open',
      },
      onEvent: () => undefined,
    })
    const handedness = lane.menuWrist === 'left' ? 'right' : 'left'
    const source = {
      id: `${lane.kind}-${handedness}`,
      kind: lane.kind,
      handedness,
      positionY: 0,
      targetingPanel: true,
    }
    const frame = (sequence, positionY) => ({
      sequence,
      time: sequence * 10,
      visibility: 'visible',
      viewerPosition: null,
      lifecycleRevision: 0,
      wristSources: [],
      selectionSources: [],
      scrollSources: [{ ...source, positionY }],
    })
    stepWristMenuRuntime(runtime, frame(index * 2 + 1, 0), [])
    const scrolled = stepWristMenuRuntime(
      runtime,
      frame(index * 2 + 2, -0.08),
      [],
    )
    assert.ok(scrolled.scrollOffset > 0, JSON.stringify(lane))
    disposeWristMenuRuntime(runtime)
  }
})

test('the deployed fixture vocabulary remains stable', () => {
  assert.deepEqual(workshopScenarioNames, [
    'default',
    'full-workshop',
    'empty-definition',
    'shield',
  ])
})

test('the public diagnostic version matches the packed package manifest', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  )
  assert.equal(WRIST_MENU_PACKAGE_VERSION, manifest.version)
})

test('the empty-definition fixture has no panel interaction or scene claim', () => {
  const scenario = createWorkshopScenario('empty-definition')
  const runtime = createWristMenuRuntimeState({
    snapshot: {
      ...workshopHostSnapshot(scenario.model, scenario.snapshotOptions),
      activationMode: 'forced-open',
      comfort: { transitionMs: 0 },
      controllerWrist: {
        offsets: {
          left: { translationMeters: [0, 0, 0], rotationDegrees: [0, 0, 0] },
        },
      },
    },
    onEvent: () => assert.fail('an empty Menu Definition cannot emit an intent'),
  })
  const presentation = stepWristMenuRuntime(
    runtime,
    selectionFrame(1, [controllerSample({ pressed: true })]),
    [controllerTarget('grid-visible')],
  )

  assert.deepEqual(presentation.items, [])
  assert.equal(
    wristMenuRuntimeBlocksSceneInput(runtime, 'right-controller'),
    false,
  )
  disposeWristMenuRuntime(runtime)
})

test('the shield fixture keeps a behind-menu scene action claimed by the menu', () => {
  const scenario = createWorkshopScenario('shield')
  const runtime = createWristMenuRuntimeState({
    snapshot: {
      ...workshopHostSnapshot(scenario.model, scenario.snapshotOptions),
      activationMode: 'forced-open',
      comfort: { transitionMs: 0 },
      controllerWrist: {
        offsets: {
          left: { translationMeters: [0, 0, 0], rotationDegrees: [0, 0, 0] },
        },
      },
    },
    onEvent: () => undefined,
  })
  stepWristMenuRuntime(runtime, selectionFrame(1, [controllerSample()]), [])
  stepWristMenuRuntime(
    runtime,
    selectionFrame(2, [controllerSample()]),
    [controllerTarget('grid-visible')],
  )
  stepWristMenuRuntime(
    runtime,
    selectionFrame(3, [controllerSample({ pressed: true })]),
    [controllerTarget('grid-visible')],
  )

  assert.equal(scenario.shieldObjectId, 'workshop-object-1')
  assert.equal(
    wristMenuRuntimeBlocksSceneInput(runtime, 'right-controller'),
    true,
  )
  disposeWristMenuRuntime(runtime)
})
