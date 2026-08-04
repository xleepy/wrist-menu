import assert from 'node:assert/strict'
import test from 'node:test'

import { createThreeWristMenu } from '../dist/three/index.js'
import { hostControlledSnapshot } from '../fixtures/host-controlled-menu.mjs'
import {
  createHostControlledXrFixture,
  driveControlledIntentJourney,
  expectedControlledIntentOrder,
} from '../fixtures/host-controlled-xr.mjs'

test('vanilla renders all Host-controlled rows in order and emits semantic intents', () => {
  const events = []
  const fixture = createHostControlledXrFixture()
  const menu = createThreeWristMenu({
    renderer: fixture.renderer,
    snapshot: hostControlledSnapshot,
    onEvent: (event) => events.push(event),
  })

  driveControlledIntentJourney({
    ...fixture,
    advance: (time) => menu.update({ time, frame: fixture.frame }),
  })

  const rows = menu.group.children.filter(({ name }) => name.includes('-visual:'))
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
  assert.equal(rows[2].userData.wristMenuSelected, true)
  assert.equal(rows[4].userData.wristMenuSelected, true)
  assert.equal(rows[5].userData.wristMenuSelected, false)
  assert.equal(
    rows[6].userData.wristMenuDisabledReason,
    'Select a Workshop Object first',
  )
  assert.deepEqual(
    events.map(({ intent }) => intent),
    expectedControlledIntentOrder,
  )

  menu.dispose()
})
