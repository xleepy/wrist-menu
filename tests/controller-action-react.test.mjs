import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement, Fragment } from 'react'
import {
  act,
  advance,
  createRoot,
  events as createPointerEvents,
} from '@react-three/fiber'
import {
  BoxGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Raycaster,
  Vector3,
} from 'three'

import { WristMenu } from '../dist/react/index.js'
import {
  controllerActionSnapshot,
  FakeReferenceSpace,
  FakeXrSession,
} from '../fixtures/controller-action.mjs'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function createReactXrFixture() {
  const inputSource = {
    handedness: 'right',
    targetRayMode: 'tracked-pointer',
    targetRaySpace: {},
    gripSpace: {},
    profiles: ['unknown'],
  }
  const menuInputSource = {
    handedness: 'left',
    targetRayMode: 'tracked-pointer',
    targetRaySpace: {},
    gripSpace: {},
    profiles: ['unknown'],
  }
  const session = new FakeXrSession([menuInputSource, inputSource])
  const referenceSpace = new FakeReferenceSpace()
  const createPose = (matrix) => {
    const position = new Vector3()
    const orientation = new Quaternion()
    matrix.decompose(position, orientation, new Vector3())
    return {
      emulatedPosition: false,
      transform: { matrix: matrix.toArray(), position, orientation },
    }
  }
  const frame = {
    session,
    getPose(space) {
      if (space === inputSource.targetRaySpace) {
        return createPose(new Matrix4().makeTranslation(0, 0, 1))
      }
      if (space === menuInputSource.gripSpace) {
        return createPose(new Matrix4().makeRotationY(-Math.PI / 2))
      }
      if (space === inputSource.gripSpace) return createPose(new Matrix4())
      return null
    },
    getViewerPose: () => createPose(new Matrix4().makeTranslation(0, 0, 1)),
  }
  const xrListeners = new Map()
  const xr = {
    enabled: false,
    isPresenting: false,
    getSession: () => session,
    getReferenceSpace: () => referenceSpace,
    setAnimationLoop: () => undefined,
    addEventListener(type, listener) {
      xrListeners.set(type, listener)
    },
    removeEventListener(type) {
      xrListeners.delete(type)
    },
  }
  const renderer = {
    xr,
    render: () => undefined,
    setPixelRatio: () => undefined,
    setSize: () => undefined,
    outputColorSpace: '',
    toneMapping: 0,
  }
  const canvasListeners = new Map()
  const canvas = {
    width: 1,
    height: 1,
    clientWidth: 1,
    clientHeight: 1,
    style: {},
    addEventListener(type, listener) {
      canvasListeners.set(type, listener)
    },
    removeEventListener(type) {
      canvasListeners.delete(type)
    },
    setPointerCapture: () => undefined,
    releasePointerCapture: () => undefined,
    dispatch(type, overrides = {}) {
      canvasListeners.get(type)?.({
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
        ...overrides,
      })
    },
  }
  return { canvas, frame, inputSource, renderer, session }
}

test('React integration mounts the Three instance and shields its active Hit Region', async () => {
  const wristMenuEvents = []
  const { canvas, frame, inputSource, renderer, session } = createReactXrFixture()
  const root = createRoot(canvas)
  await root.configure({
    gl: renderer,
    events: createPointerEvents,
    frameloop: 'never',
    size: { width: 1, height: 1, top: 0, left: 0 },
  })

  const behindGeometry = new BoxGeometry(0.5, 0.5, 0.02)
  const behindMaterial = new MeshBasicMaterial()
  const behindMenu = new Mesh(behindGeometry, behindMaterial)
  behindMenu.position.z = -0.1
  let behindSceneEvents = 0
  const countBehindSceneEvent = () => {
    behindSceneEvents += 1
  }

  let store
  await act(async () => {
    store = root.render(
      createElement(
        Fragment,
        null,
        createElement(WristMenu, {
          snapshot: controllerActionSnapshot,
          onEvent: (event) => wristMenuEvents.push(event),
        }),
        createElement('primitive', {
          object: behindMenu,
          onPointerOver: countBehindSceneEvent,
          onPointerMove: countBehindSceneEvent,
          onPointerDown: countBehindSceneEvent,
          onPointerUp: countBehindSceneEvent,
          onPointerCancel: countBehindSceneEvent,
          onClick: countBehindSceneEvent,
          onDoubleClick: countBehindSceneEvent,
          onContextMenu: countBehindSceneEvent,
        }),
      ),
    )
  })

  const state = store.getState()
  const menuGroup = state.scene.children[0]
  assert.equal(menuGroup?.name, 'wrist-menu-attachment-root')

  const ray = new Raycaster(
    new Vector3(0, 0, 1),
    new Vector3(0, 0, -1),
  )
  advance(16, true, state, frame)
  assert.equal(ray.intersectObject(menuGroup, true).length, 0)
  advance(32, true, state, frame)
  assert.ok(ray.intersectObject(menuGroup, true).length > 0)

  session.dispatch('selectstart', inputSource)
  advance(48, true, state, frame)

  canvas.dispatch('pointermove')
  canvas.dispatch('pointerdown')
  canvas.dispatch('pointerup')
  canvas.dispatch('pointercancel')
  canvas.dispatch('click')
  canvas.dispatch('dblclick')
  canvas.dispatch('contextmenu')
  assert.equal(behindSceneEvents, 0)

  session.dispatch('select', inputSource)
  session.dispatch('selectend', inputSource)
  advance(64, true, state, frame)
  assert.equal(
    wristMenuEvents.filter(({ type }) => type === 'selection-intent').length,
    1,
  )

  await act(async () => root.unmount())
  assert.equal(menuGroup.children.length, 0)
  behindGeometry.dispose()
  behindMaterial.dispose()
})

test('React forwards the shared presentation factory without a JSX behavior path', async () => {
  const wristMenuEvents = []
  const { canvas, frame, inputSource, renderer, session } = createReactXrFixture()
  const root = createRoot(canvas)
  await root.configure({
    gl: renderer,
    events: createPointerEvents,
    frameloop: 'never',
    size: { width: 1, height: 1, top: 0, left: 0 },
  })

  let factoryCalls = 0
  let disposals = 0
  const presentationFactory = (model) => {
    factoryCalls += 1
    assert.ok(Object.isFrozen(model))
    const presentationRoot = new Group()
    presentationRoot.name = 'shared-react-presentation'
    const panelGeometry = new BoxGeometry(0.192, 0.27, 0.004)
    const panelMaterial = new MeshBasicMaterial({ visible: false })
    const panel = new Mesh(panelGeometry, panelMaterial)
    panel.position.z = -0.004
    presentationRoot.add(panel)
    const hitGeometry = new BoxGeometry(0.176, 0.02, 0.008)
    const hitMaterial = new MeshBasicMaterial({ visible: false })
    const hit = new Mesh(hitGeometry, hitMaterial)
    hit.position.z = 0.008
    presentationRoot.add(hit)
    return {
      root: presentationRoot,
      hitRegions: [{ itemId: 'spawn-cube', object: hit }],
      scrollRegion: { object: panel },
      update(nextModel) {
        presentationRoot.visible = nextModel.visible
        hit.visible = nextModel.items.some(({ id }) => id === 'spawn-cube')
      },
      dispose() {
        disposals += 1
        panelGeometry.dispose()
        panelMaterial.dispose()
        hitGeometry.dispose()
        hitMaterial.dispose()
        presentationRoot.clear()
      },
    }
  }

  const behindGeometry = new BoxGeometry(0.5, 0.5, 0.02)
  const behindMaterial = new MeshBasicMaterial()
  const behindMenu = new Mesh(behindGeometry, behindMaterial)
  behindMenu.position.z = -0.1
  let behindSceneEvents = 0
  let store
  await act(async () => {
    store = root.render(
      createElement(
        Fragment,
        null,
        createElement(WristMenu, {
          snapshot: controllerActionSnapshot,
          onEvent: (event) => wristMenuEvents.push(event),
          presentationFactory,
        }),
        createElement('primitive', {
          object: behindMenu,
          onPointerDown: () => {
            behindSceneEvents += 1
          },
        }),
      ),
    )
  })

  const state = store.getState()
  const menuGroup = state.scene.children[0]
  assert.equal(
    menuGroup.children[0]?.name,
    'shared-react-presentation',
  )
  advance(16, true, state, frame)
  advance(32, true, state, frame)
  session.dispatch('selectstart', inputSource)
  advance(48, true, state, frame)
  canvas.dispatch('pointerdown')
  assert.equal(behindSceneEvents, 0)
  session.dispatch('select', inputSource)
  session.dispatch('selectend', inputSource)
  advance(64, true, state, frame)
  assert.equal(
    wristMenuEvents.filter(({ type }) => type === 'selection-intent').length,
    1,
  )

  const replacementFactory = (model) => presentationFactory(model)
  await act(async () => {
    root.render(
      createElement(
        Fragment,
        null,
        createElement(WristMenu, {
          snapshot: controllerActionSnapshot,
          onEvent: (event) => wristMenuEvents.push(event),
          presentationFactory: replacementFactory,
        }),
        createElement('primitive', {
          object: behindMenu,
          onPointerDown: () => {
            behindSceneEvents += 1
          },
        }),
      ),
    )
  })
  assert.equal(factoryCalls, 2)
  assert.equal(disposals, 1)
  assert.equal(menuGroup.children[0]?.name, 'shared-react-presentation')

  await act(async () => root.unmount())
  assert.equal(disposals, 2)
  behindGeometry.dispose()
  behindMaterial.dispose()
})
