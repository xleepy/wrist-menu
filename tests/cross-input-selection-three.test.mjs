import assert from 'node:assert/strict'
import test from 'node:test'
import { Scene } from 'three'

import {
  createThreeWristMenuState,
  disposeThreeWristMenu,
  threeWristMenuBlocksSceneInput,
  updateThreeWristMenu,
} from '../dist/three/index.js'
import { crossInputSnapshot } from '../fixtures/cross-input-selection.mjs'
import {
  createControllerHapticFixture,
  createHandXrFixture,
} from '../fixtures/cross-input-xr.mjs'
import { createEquivalentPresentationFactory } from '../fixtures/presentation-factory.mjs'

test('vanilla integration samples an inclusive fingertip press plane and latches until withdrawal', () => {
  const events = []
  const fixture = createHandXrFixture()
  const menu = createThreeWristMenuState({
    renderer: fixture.renderer,
    snapshot: crossInputSnapshot,
    onEvent: (event) => events.push(event),
  })
  new Scene().add(menu.presentation.group)

  updateThreeWristMenu(menu, { time: 10, frame: fixture.frame })
  fixture.setFingertipZ(0.03)
  updateThreeWristMenu(menu, { time: 20, frame: fixture.frame })
  assert.equal(threeWristMenuBlocksSceneInput(menu, fixture.handSource), true)
  assert.equal(events.some(({ type }) => type === 'selection-intent'), false)

  // Hit Region front plane is z=0.012; radius=0.005 makes z=0.017 inclusive.
  fixture.setFingertipZ(0.017)
  updateThreeWristMenu(menu, { time: 30, frame: fixture.frame })
  updateThreeWristMenu(menu, { time: 40, frame: fixture.frame })
  assert.deepEqual(
    events.filter(({ type }) => type === 'selection-intent').map(({ source }) => source),
    [{ id: 'input-source-2', kind: 'hand', handedness: 'right' }],
  )
  assert.equal(threeWristMenuBlocksSceneInput(menu, fixture.handSource), true)

  fixture.setFingertipZ(0.01701)
  updateThreeWristMenu(menu, { time: 50, frame: fixture.frame })
  assert.equal(
    events.filter(({ type }) => type === 'selection-intent').length,
    1,
  )

  fixture.setFingertipZ(0.05)
  updateThreeWristMenu(menu, { time: 60, frame: fixture.frame })
  assert.equal(threeWristMenuBlocksSceneInput(menu, fixture.handSource), false)
  disposeThreeWristMenu(menu)
})

for (const presentationKind of ['default', 'custom']) {
test(`${presentationKind} presentation cancels a direct-hand approach on tracking loss`, () => {
  const events = []
  const fixture = createHandXrFixture()
  const presentationLog = { name: `tracking-loss-${presentationKind}` }
  const menu = createThreeWristMenuState({
    renderer: fixture.renderer,
    snapshot: crossInputSnapshot,
    onEvent: (event) => events.push(event),
    presentationFactory:
      presentationKind === 'custom'
        ? createEquivalentPresentationFactory(presentationLog)
        : undefined,
  })

  updateThreeWristMenu(menu, { time: 10, frame: fixture.frame })
  fixture.setFingertipZ(0.03)
  updateThreeWristMenu(menu, { time: 20, frame: fixture.frame })
  fixture.setFingertipTracked(false)
  updateThreeWristMenu(menu, { time: 30, frame: fixture.frame })
  assert.equal(
    events.find(({ type }) => type === 'selection-cancellation')?.reason,
    'lifecycle-interrupted',
  )

  fixture.setFingertipZ(0.017)
  fixture.setFingertipTracked(true)
  updateThreeWristMenu(menu, { time: 40, frame: fixture.frame })
  assert.equal(events.some(({ type }) => type === 'selection-intent'), false)
  disposeThreeWristMenu(menu)
  if (presentationKind === 'custom') {
    assert.equal(presentationLog.disposals, 1)
  }
})
}

test('optional controller haptic rejection cannot prevent or duplicate semantic delivery', async () => {
  let requests = 0
  const fixture = createControllerHapticFixture({
    pulse(intensity, duration) {
      requests += 1
      assert.equal(intensity, 0.35)
      assert.equal(duration, 20)
      return Promise.reject(new Error('not supported'))
    },
  })
  const events = []
  const menu = createThreeWristMenuState({
    renderer: fixture.renderer,
    snapshot: crossInputSnapshot,
    onEvent: (event) => events.push(event),
  })

  updateThreeWristMenu(menu, { time: 10, frame: fixture.frame })
  updateThreeWristMenu(menu, { time: 20, frame: fixture.frame })
  fixture.session.dispatch('selectstart', fixture.controller)
  updateThreeWristMenu(menu, { time: 30, frame: fixture.frame })
  fixture.session.dispatch('select', fixture.controller)
  fixture.session.dispatch('selectend', fixture.controller)
  updateThreeWristMenu(menu, { time: 40, frame: fixture.frame })
  await Promise.resolve()

  assert.equal(requests, 1)
  assert.equal(
    events.filter(({ type }) => type === 'selection-intent').length,
    1,
  )
  disposeThreeWristMenu(menu)
})

test('Wrist Menu Events and controller haptics follow current instance state when the Host callback throws', () => {
  let requests = 0
  const fixture = createControllerHapticFixture({
    pulse() {
      requests += 1
      return true
    },
  })
  const initialEvents = []
  const replacementEvents = []
  const menu = createThreeWristMenuState({
    renderer: fixture.renderer,
    snapshot: crossInputSnapshot,
    onEvent: (event) => initialEvents.push(event),
  })
  menu.onEvent = (event) => {
    replacementEvents.push(event)
    if (event.type === 'selection-intent') {
      throw new Error('replacement Host callback failed')
    }
  }
  menu.inputSourceById = new Map()

  updateThreeWristMenu(menu, { time: 10, frame: fixture.frame })
  updateThreeWristMenu(menu, { time: 20, frame: fixture.frame })
  fixture.session.dispatch('selectstart', fixture.controller)
  updateThreeWristMenu(menu, { time: 30, frame: fixture.frame })
  fixture.session.dispatch('select', fixture.controller)
  fixture.session.dispatch('selectend', fixture.controller)
  assert.throws(
    () => updateThreeWristMenu(menu, { time: 40, frame: fixture.frame }),
    /replacement Host callback failed/,
  )

  assert.equal(requests, 1)
  assert.equal(
    initialEvents.filter(({ type }) => type === 'selection-intent').length,
    0,
  )
  assert.equal(
    replacementEvents.filter(({ type }) => type === 'selection-intent').length,
    1,
  )
  disposeThreeWristMenu(menu)
})

for (const presentationKind of ['default', 'custom']) {
test(`${presentationKind} presentation disabled controller targets never request haptics`, () => {
  let requests = 0
  const fixture = createControllerHapticFixture({
    pulse() {
      requests += 1
      throw new Error('must not be called')
    },
  })
  const events = []
  const presentationLog = { name: `disabled-${presentationKind}` }
  const menu = createThreeWristMenuState({
    renderer: fixture.renderer,
    snapshot: {
      ...crossInputSnapshot,
      menuDefinition: [crossInputSnapshot.menuDefinition[2]],
    },
    onEvent: (event) => events.push(event),
    presentationFactory:
      presentationKind === 'custom'
        ? createEquivalentPresentationFactory(presentationLog)
        : undefined,
  })

  updateThreeWristMenu(menu, { time: 10, frame: fixture.frame })
  updateThreeWristMenu(menu, { time: 20, frame: fixture.frame })
  fixture.session.dispatch('selectstart', fixture.controller)
  updateThreeWristMenu(menu, { time: 30, frame: fixture.frame })
  fixture.session.dispatch('select', fixture.controller)
  fixture.session.dispatch('selectend', fixture.controller)
  updateThreeWristMenu(menu, { time: 40, frame: fixture.frame })

  assert.equal(requests, 0)
  assert.equal(events.some(({ type }) => type === 'selection-intent'), false)
  disposeThreeWristMenu(menu)
  if (presentationKind === 'custom') {
    assert.equal(presentationLog.disposals, 1)
  }
})
}
