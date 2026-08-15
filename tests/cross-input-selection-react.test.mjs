import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement, Fragment } from 'react'
import {
  act,
  advance,
  createRoot,
  events as createPointerEvents,
} from '@react-three/fiber'
import { BoxGeometry, Mesh, MeshBasicMaterial } from 'three'

import { WristMenu } from '../dist/react/index.js'
import { crossInputSnapshot } from '../fixtures/cross-input-selection.mjs'
import { createHandXrFixture } from '../fixtures/cross-input-xr.mjs'
import { createEquivalentPresentationFactory } from '../fixtures/presentation-factory.mjs'

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
    dispatch(type) {
      listeners.get(type)?.({
        type,
        offsetX: 0.5,
        offsetY: 0.5,
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        buttons: type === 'pointerdown' ? 1 : 0,
        target: canvas,
        currentTarget: canvas,
        preventDefault: () => undefined,
        stopPropagation: () => undefined,
      })
    },
  }
  return canvas
}

for (const presentationKind of ['default', 'custom']) {
test(`React ${presentationKind} presentation shields every tested behind-menu action during a hand commit`, async () => {
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

  const behindGeometry = new BoxGeometry(0.5, 0.5, 0.02)
  const behindMaterial = new MeshBasicMaterial()
  const behind = new Mesh(behindGeometry, behindMaterial)
  behind.position.z = -0.1
  let behindActions = 0
  const countBehind = () => {
    behindActions += 1
  }
  const events = []
  const presentationLog = { name: `react-hand-${presentationKind}` }
  const presentationFactory =
    presentationKind === 'custom'
      ? createEquivalentPresentationFactory(presentationLog)
      : undefined
  let store

  await act(async () => {
    store = root.render(
      createElement(
        Fragment,
        null,
        createElement(WristMenu, {
          snapshot: crossInputSnapshot,
          onEvent: (event) => events.push(event),
          presentationFactory,
        }),
        createElement('primitive', {
          object: behind,
          onPointerOver: countBehind,
          onPointerMove: countBehind,
          onPointerDown: countBehind,
          onPointerUp: countBehind,
          onPointerCancel: countBehind,
          onClick: countBehind,
          onDoubleClick: countBehind,
          onContextMenu: countBehind,
        }),
      ),
    )
  })

  const state = store.getState()
  advance(10, true, state, fixture.frame)
  fixture.setFingertipZ(0.03)
  advance(20, true, state, fixture.frame)

  for (const type of [
    'pointermove',
    'pointerdown',
    'pointerup',
    'pointercancel',
    'click',
    'dblclick',
    'contextmenu',
  ]) {
    canvas.dispatch(type)
  }
  fixture.setFingertipZ(0.017)
  advance(30, true, state, fixture.frame)

  assert.equal(behindActions, 0)
  assert.deepEqual(
    events.filter(({ type }) => type === 'selection-intent').map(({ source }) => source.kind),
    ['hand'],
  )

  await act(async () => root.unmount())
  if (presentationKind === 'custom') {
    assert.equal(presentationLog.disposals, 1)
  }
  behindGeometry.dispose()
  behindMaterial.dispose()
})
}
