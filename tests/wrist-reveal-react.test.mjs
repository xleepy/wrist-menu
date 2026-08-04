import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { act, advance, createRoot } from '@react-three/fiber'
import { Group, Matrix4, Vector3 } from 'three'

import { WristMenu } from '../dist/react/index.js'
import { automaticHandSnapshot } from '../fixtures/wrist-reveal.mjs'
import { createWristXrFixture } from '../fixtures/wrist-reveal-xr.mjs'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

test('React integration follows current hand wrist poses and preserves non-interactive visual grace', async () => {
  const fixture = createWristXrFixture({ menuKind: 'hand' })
  Object.assign(fixture.renderer.xr, {
    enabled: false,
    isPresenting: false,
    setAnimationLoop: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })
  const renderer = {
    ...fixture.renderer,
    render: () => undefined,
    setPixelRatio: () => undefined,
    setSize: () => undefined,
    outputColorSpace: '',
    toneMapping: 0,
  }
  const canvas = createCanvas()
  const root = createRoot(canvas)
  await root.configure({
    gl: renderer,
    frameloop: 'never',
    size: { width: 1, height: 1, top: 0, left: 0 },
  })
  const snapshot = {
    ...automaticHandSnapshot,
    comfort: { initialDwellMs: 0, reacquireDwellMs: 200, transitionMs: 0 },
  }
  let store

  try {
    await act(async () => {
      store = root.render(
        createElement(WristMenu, {
          snapshot,
          onEvent: () => undefined,
        }),
      )
    })
    const state = store.getState()
    const menuGroup = state.scene.children[0]

    fixture.setWristMatrix(new Matrix4().makeTranslation(-0.2, 1.25, -0.35))
    advance(0, true, state, fixture.frame)
    advance(0.001, true, state, fixture.frame)
    assert.deepEqual(
      menuGroup.getWorldPosition(new Vector3()).toArray().map(round4),
      [-0.2, 1.25, -0.35],
    )
    assert.equal(menuGroup.visible, true)

    const reparentedOwner = new Group()
    state.scene.add(reparentedOwner)
    reparentedOwner.add(menuGroup)
    advance(0.002, true, state, fixture.frame)
    assert.equal(menuGroup.visible, false)
    advance(0.201, true, state, fixture.frame)
    assert.equal(menuGroup.visible, false)
    advance(0.202, true, state, fixture.frame)
    assert.equal(menuGroup.visible, true)

    fixture.setWristMatrix(new Matrix4().makeTranslation(-0.15, 1.2, -0.3))
    advance(0.203, true, state, fixture.frame)
    assert.deepEqual(
      menuGroup.getWorldPosition(new Vector3()).toArray().map(round4),
      [-0.15, 1.2, -0.3],
    )

    fixture.setWristTracked(false)
    advance(0.204, true, state, fixture.frame)
    assert.equal(menuGroup.visible, true)
    advance(0.454, true, state, fixture.frame)
    assert.equal(menuGroup.visible, false)
  } finally {
    await act(async () => root.unmount())
  }
})

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

function round4(value) {
  return Math.round(value * 10_000) / 10_000
}
