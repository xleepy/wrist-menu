import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import {
  act,
  advance,
  createRoot,
  events as createPointerEvents,
} from '@react-three/fiber'

import { WristMenu } from '../dist/react/index.js'
import { hostControlledSnapshot } from '../fixtures/host-controlled-menu.mjs'
import {
  createHostControlledXrFixture,
  driveControlledIntentJourney,
  expectedControlledIntentOrder,
} from '../fixtures/host-controlled-xr.mjs'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function createCanvas() {
  const listeners = new Map()
  const canvas = {
    width: 1,
    height: 1,
    clientWidth: 1,
    clientHeight: 1,
    style: {},
    addEventListener(type, listener) {
      listeners.set(type, listener)
    },
    removeEventListener(type) {
      listeners.delete(type)
    },
    setPointerCapture: () => undefined,
    releasePointerCapture: () => undefined,
  }
  return canvas
}

test('React applies complete snapshot props and preserves vanilla event ordering', async () => {
  const events = []
  const fixture = createHostControlledXrFixture()
  const canvas = createCanvas()
  const root = createRoot(canvas)
  await root.configure({
    gl: fixture.renderer,
    events: createPointerEvents,
    frameloop: 'never',
    size: { width: 1, height: 1, top: 0, left: 0 },
  })

  let store
  await act(async () => {
    store = root.render(
      createElement(WristMenu, {
        snapshot: hostControlledSnapshot,
        onEvent: (event) => events.push(event),
      }),
    )
  })
  const state = store.getState()
  const advanceMenu = (time) => advance(time / 1_000, true, state, fixture.frame)

  driveControlledIntentJourney({
    ...fixture,
    advance: advanceMenu,
  })

  assert.deepEqual(
    events
      .filter(({ type }) => type === 'selection-intent')
      .map(({ intent }) => intent),
    expectedControlledIntentOrder,
  )

  const updated = structuredClone(hostControlledSnapshot)
  updated.menuDefinition[2].value = false
  updated.menuDefinition[3].selectedValue = 'sphere'
  await act(async () => {
    root.render(
      createElement(WristMenu, {
        snapshot: updated,
        onEvent: (event) => events.push(event),
      }),
    )
  })
  advanceMenu(144)

  const attachmentRoot = state.scene.children.find(
    ({ name }) => name === 'wrist-menu-attachment-root',
  )
  assert.ok(attachmentRoot)
  const rows = []
  attachmentRoot.traverse((object) => {
    if (object.name.includes('-visual:')) rows.push(object)
  })
  assert.equal(rows[2].userData.wristMenuSelected, false)
  assert.equal(rows[4].userData.wristMenuSelected, false)
  assert.equal(rows[5].userData.wristMenuSelected, true)

  await act(async () => root.unmount())
})
