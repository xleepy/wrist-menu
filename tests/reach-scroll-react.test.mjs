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
import { reachScrollSnapshot } from '../fixtures/reach-scroll.mjs'
import { createHandXrFixture } from '../fixtures/cross-input-xr.mjs'

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

test('the React binding mounts and runs frames with the Reach scroll presentation', async () => {
  const fixture = createHandXrFixture()
  const managerListeners = new Map()
  Object.assign(fixture.renderer.xr, {
    enabled: false,
    isPresenting: false,
    setAnimationLoop: () => undefined,
    addEventListener(type, listener) {
      managerListeners.set(type, listener)
    },
    removeEventListener(type) {
      managerListeners.delete(type)
    },
  })
  Object.assign(fixture.renderer, {
    render: () => undefined,
    setPixelRatio: () => undefined,
    setSize: () => undefined,
    outputColorSpace: '',
    toneMapping: 0,
  })
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
        snapshot: reachScrollSnapshot,
        onEvent: () => undefined,
      }),
    )
  })

  const state = store.getState()
  advance(10, true, state, fixture.frame)
  advance(20, true, state, fixture.frame)

  await act(async () => root.unmount())
})