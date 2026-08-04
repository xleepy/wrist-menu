import assert from 'node:assert/strict'
import test from 'node:test'
import { Scene } from 'three'

import { createThreeWristMenu } from '../dist/three/index.js'
import { crossInputSnapshot } from '../fixtures/cross-input-selection.mjs'
import {
  createControllerHapticFixture,
  createHandXrFixture,
} from '../fixtures/cross-input-xr.mjs'

test('vanilla integration samples an inclusive fingertip press plane and latches until withdrawal', () => {
  const events = []
  const fixture = createHandXrFixture()
  const menu = createThreeWristMenu({
    renderer: fixture.renderer,
    snapshot: crossInputSnapshot,
    onEvent: (event) => events.push(event),
  })
  new Scene().add(menu.group)

  menu.update({ time: 10, frame: fixture.frame })
  fixture.setFingertipZ(0.03)
  menu.update({ time: 20, frame: fixture.frame })
  assert.equal(menu.blocksSceneInput(fixture.handSource), true)
  assert.equal(events.some(({ type }) => type === 'selection-intent'), false)

  // Hit Region front plane is z=0.012; radius=0.005 makes z=0.017 inclusive.
  fixture.setFingertipZ(0.017)
  menu.update({ time: 30, frame: fixture.frame })
  menu.update({ time: 40, frame: fixture.frame })
  assert.deepEqual(
    events.filter(({ type }) => type === 'selection-intent').map(({ source }) => source),
    [{ id: 'input-source-2', kind: 'hand', handedness: 'right' }],
  )
  assert.equal(menu.blocksSceneInput(fixture.handSource), true)

  fixture.setFingertipZ(0.01701)
  menu.update({ time: 50, frame: fixture.frame })
  assert.equal(
    events.filter(({ type }) => type === 'selection-intent').length,
    1,
  )

  fixture.setFingertipZ(0.05)
  menu.update({ time: 60, frame: fixture.frame })
  assert.equal(menu.blocksSceneInput(fixture.handSource), false)
  menu.dispose()
})

test('tracking loss cancels a direct-hand approach and reappearance inside cannot commit', () => {
  const events = []
  const fixture = createHandXrFixture()
  const menu = createThreeWristMenu({
    renderer: fixture.renderer,
    snapshot: crossInputSnapshot,
    onEvent: (event) => events.push(event),
  })

  menu.update({ time: 10, frame: fixture.frame })
  fixture.setFingertipZ(0.03)
  menu.update({ time: 20, frame: fixture.frame })
  fixture.setFingertipTracked(false)
  menu.update({ time: 30, frame: fixture.frame })
  assert.equal(
    events.find(({ type }) => type === 'selection-cancellation')?.reason,
    'lifecycle-interrupted',
  )

  fixture.setFingertipZ(0.017)
  fixture.setFingertipTracked(true)
  menu.update({ time: 40, frame: fixture.frame })
  assert.equal(events.some(({ type }) => type === 'selection-intent'), false)
  menu.dispose()
})

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
  const menu = createThreeWristMenu({
    renderer: fixture.renderer,
    snapshot: crossInputSnapshot,
    onEvent: (event) => events.push(event),
  })

  menu.update({ time: 10, frame: fixture.frame })
  menu.update({ time: 20, frame: fixture.frame })
  fixture.session.dispatch('selectstart', fixture.controller)
  menu.update({ time: 30, frame: fixture.frame })
  fixture.session.dispatch('select', fixture.controller)
  fixture.session.dispatch('selectend', fixture.controller)
  menu.update({ time: 40, frame: fixture.frame })
  await Promise.resolve()

  assert.equal(requests, 1)
  assert.equal(
    events.filter(({ type }) => type === 'selection-intent').length,
    1,
  )
  menu.dispose()
})

test('disabled controller targets never request haptics', () => {
  let requests = 0
  const fixture = createControllerHapticFixture({
    pulse() {
      requests += 1
      throw new Error('must not be called')
    },
  })
  const events = []
  const menu = createThreeWristMenu({
    renderer: fixture.renderer,
    snapshot: {
      ...crossInputSnapshot,
      menuDefinition: [crossInputSnapshot.menuDefinition[2]],
    },
    onEvent: (event) => events.push(event),
  })

  menu.update({ time: 10, frame: fixture.frame })
  menu.update({ time: 20, frame: fixture.frame })
  fixture.session.dispatch('selectstart', fixture.controller)
  menu.update({ time: 30, frame: fixture.frame })
  fixture.session.dispatch('select', fixture.controller)
  fixture.session.dispatch('selectend', fixture.controller)
  menu.update({ time: 40, frame: fixture.frame })

  assert.equal(requests, 0)
  assert.equal(events.some(({ type }) => type === 'selection-intent'), false)
  menu.dispose()
})
