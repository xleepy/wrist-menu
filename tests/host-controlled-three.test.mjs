import assert from 'node:assert/strict'
import test from 'node:test'
import { Raycaster, Vector3 } from 'three'

import {
  createThreeWristMenuState,
  disposeThreeWristMenu,
  updateThreeWristMenu,
} from '../dist/three/index.js'
import { hostControlledSnapshot } from '../fixtures/host-controlled-menu.mjs'
import {
  createHostControlledXrFixture,
  driveControlledIntentJourney,
  expectedControlledIntentOrder,
} from '../fixtures/host-controlled-xr.mjs'

test('vanilla renders all Host-controlled rows in order and emits semantic intents', () => {
  const events = []
  const fixture = createHostControlledXrFixture()
  const menu = createThreeWristMenuState({
    renderer: fixture.renderer,
    snapshot: hostControlledSnapshot,
    onEvent: (event) => events.push(event),
  })

  driveControlledIntentJourney({
    ...fixture,
    advance: (time) => updateThreeWristMenu(menu, { time, frame: fixture.frame }),
  })

  const rows = menu.presentation.group.children.filter(({ name }) => name.includes('-visual:'))
  assert.deepEqual(
    rows.map(({ name }) => name),
    [
      'wrist-menu-action-visual:reset-workshop',
      'wrist-menu-separator-visual:scene-controls',
      'wrist-menu-toggle-visual:show-grid',
      'wrist-menu-choice-group-visual:primitive-shape',
      'wrist-menu-choice-visual:shape-cube',
      'wrist-menu-choice-visual:shape-sphere',
      'wrist-menu-action-visual:remove-selection',
    ],
  )
  assert.equal(rows[0].userData.wristMenuLabel, 'Reset workshop')
  assert.equal(rows[0].userData.wristMenuIconKey, 'reset')
  assert.equal(rows[2].userData.wristMenuSelected, true)
  assert.equal(rows[2].userData.wristMenuValue, true)
  assert.equal(rows[4].userData.wristMenuSelected, true)
  assert.equal(rows[4].userData.wristMenuValue, 'cube')
  assert.equal(rows[5].userData.wristMenuSelected, false)
  assert.equal(
    rows[6].userData.wristMenuDisabledReason,
    'Select a Workshop Object first',
  )
  assert.deepEqual(
    events
      .filter(({ type }) => type === 'selection-intent')
      .map(({ intent }) => intent),
    expectedControlledIntentOrder,
  )

  disposeThreeWristMenu(menu)
})

test('vanilla releases presentation resources when a disposal event callback throws', () => {
  const fixture = createHostControlledXrFixture()
  const menu = createThreeWristMenuState({
    renderer: fixture.renderer,
    snapshot: hostControlledSnapshot,
    onEvent: (event) => {
      if (event.type === 'selection-cancellation' && event.reason === 'disposed') {
        throw new Error('Host disposal callback failed')
      }
    },
  })
  updateThreeWristMenu(menu, { time: 16, frame: fixture.frame })
  updateThreeWristMenu(menu, { time: 32, frame: fixture.frame })
  fixture.session.dispatch('selectstart', fixture.inputSource)
  updateThreeWristMenu(menu, { time: 48, frame: fixture.frame })

  assert.throws(() => disposeThreeWristMenu(menu), /Host disposal callback failed/)
  assert.equal(menu.presentation.group.children.length, 0)
  assert.throws(
    () => updateThreeWristMenu(menu, { time: 64, frame: fixture.frame }),
    /disposed/,
  )
  assert.doesNotThrow(() => disposeThreeWristMenu(menu))
})

test('complete presentation rows share reveal opacity and targeting barriers', () => {
  const fixture = createHostControlledXrFixture()
  const snapshot = structuredClone(hostControlledSnapshot)
  snapshot.comfort.transitionMs = 150
  const menu = createThreeWristMenuState({
    renderer: fixture.renderer,
    snapshot,
    onEvent: () => undefined,
  })
  const ray = new Raycaster(
    new Vector3(0, 0.0225, 1),
    new Vector3(0, 0, -1),
  )

  updateThreeWristMenu(menu, { time: 0, frame: fixture.frame })
  updateThreeWristMenu(menu, { time: 75, frame: fixture.frame })
  const visualMaterials = menu.presentation.group.children
    .filter(
      ({ name }) =>
        name === 'wrist-menu-command-slab' || name.includes('-visual:'),
    )
    .map(({ material }) => material)
  assert.ok(visualMaterials.length > 1)
  assert.ok(visualMaterials.every(({ opacity }) => opacity === 0.5))
  assert.ok(visualMaterials.every(({ depthWrite }) => depthWrite === false))
  assert.equal(ray.intersectObject(menu.presentation.group, true).length, 0)

  updateThreeWristMenu(menu, { time: 150, frame: fixture.frame })
  assert.ok(visualMaterials.every(({ opacity }) => opacity === 1))
  assert.ok(visualMaterials.every(({ depthWrite }) => depthWrite === true))
  assert.equal(ray.intersectObject(menu.presentation.group, true).length, 0)
  updateThreeWristMenu(menu, { time: 151, frame: fixture.frame })
  assert.ok(ray.intersectObject(menu.presentation.group, true).length > 0)

  disposeThreeWristMenu(menu)
})
