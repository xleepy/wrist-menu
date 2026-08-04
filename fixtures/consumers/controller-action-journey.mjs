import assert from 'node:assert/strict'

import { controllerActionSnapshot } from '../controller-action.mjs'

function installIwerNodePrimitives() {
  const names = [
    'DOMPointReadOnly',
    'localStorage',
    'requestAnimationFrame',
    'cancelAnimationFrame',
  ]
  const descriptors = new Map(
    names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  )

  class Point {
    constructor(x = 0, y = 0, z = 0, w = 1) {
      Object.assign(this, { x, y, z, w })
    }
  }

  Object.defineProperties(globalThis, {
    DOMPointReadOnly: { configurable: true, value: Point },
    localStorage: {
      configurable: true,
      value: { getItem: () => null, setItem: () => undefined },
    },
    requestAnimationFrame: { configurable: true, value: () => 1 },
    cancelAnimationFrame: { configurable: true, value: () => undefined },
  })

  return () => {
    for (const [name, descriptor] of descriptors) {
      if (descriptor === undefined) delete globalThis[name]
      else Object.defineProperty(globalThis, name, descriptor)
    }
  }
}

async function createIwerControllerFixture(iwer) {
  const restoreGlobals = installIwerNodePrimitives()
  const device = new iwer.XRDevice(iwer.metaQuest3, {
    canvasContainer: { dataset: {}, style: {} },
  })
  device.primaryInputMode = 'controller'
  device.controllers.left.connected = false
  const controller = device.controllers.right
  controller.position.set(0, 0, 1)
  controller.quaternion.set(0, 0, 0, 1)

  const session = new iwer.XRSession(device, 'immersive-vr', ['local-floor'])
  const referenceSpace = await session.requestReferenceSpace('local-floor')
  session[iwer.P_SESSION].updateActiveInputSources()
  let sequence = 0

  const nextFrame = (time) => {
    sequence += 1
    const frame = new iwer.XRFrame(session, sequence, true, true, time)
    device[iwer.P_DEVICE].onFrameStart(frame)
    session[iwer.P_SESSION].updateActiveInputSources()
    return frame
  }

  return {
    controller,
    inputSource: controller.inputSource,
    referenceSpace,
    session,
    nextFrame,
    press(time) {
      controller.updateButtonValue('trigger', 1)
      return nextFrame(time)
    },
    release(time) {
      controller.updateButtonValue('trigger', 0)
      return nextFrame(time)
    },
    restoreGlobals,
  }
}

export async function runPackedThreeControllerJourney({
  createThreeWristMenu,
  iwer,
  three,
}) {
  const fixture = await createIwerControllerFixture(iwer)
  const wristMenuEvents = []
  let sceneActions = 0
  const renderer = {
    xr: {
      getSession: () => fixture.session,
      getReferenceSpace: () => fixture.referenceSpace,
    },
  }
  const menu = createThreeWristMenu({
    renderer,
    snapshot: controllerActionSnapshot,
    onEvent: (event) => wristMenuEvents.push(event),
  })
  const scene = new three.Scene()
  scene.add(menu.group)
  const ray = new three.Raycaster(
    new three.Vector3(0, 0, 1),
    new three.Vector3(0, 0, -1),
  )

  try {
    menu.update({ time: 16, frame: fixture.nextFrame(16) })
    assert.equal(ray.intersectObject(menu.group, true).length, 0)
    menu.update({ time: 32, frame: fixture.nextFrame(32) })
    assert.ok(ray.intersectObject(menu.group, true).length > 0)

    fixture.session.addEventListener('select', ({ inputSource }) => {
      if (!menu.blocksSceneInput(inputSource)) sceneActions += 1
    })

    menu.update({ time: 48, frame: fixture.press(48) })
    assert.equal(menu.blocksSceneInput(fixture.inputSource), true)
    menu.update({ time: 64, frame: fixture.release(64) })

    assert.equal(sceneActions, 0)
    assert.equal(
      wristMenuEvents.filter(({ type }) => type === 'selection-intent').length,
      1,
    )
  } finally {
    menu.dispose()
    fixture.restoreGlobals()
  }
}

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

export async function runPackedReactControllerJourney({
  React,
  WristMenu,
  fiber,
  iwer,
  three,
}) {
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const fixture = await createIwerControllerFixture(iwer)
  const canvas = createCanvas()
  const renderer = {
    xr: {
      enabled: false,
      isPresenting: false,
      getSession: () => fixture.session,
      getReferenceSpace: () => fixture.referenceSpace,
      setAnimationLoop: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    },
    render: () => undefined,
    setPixelRatio: () => undefined,
    setSize: () => undefined,
    outputColorSpace: '',
    toneMapping: 0,
  }
  const root = fiber.createRoot(canvas)
  await root.configure({
    gl: renderer,
    events: fiber.events,
    frameloop: 'never',
    size: { width: 1, height: 1, top: 0, left: 0 },
  })

  const behindGeometry = new three.BoxGeometry(0.5, 0.5, 0.02)
  const behindMaterial = new three.MeshBasicMaterial()
  const behindMenu = new three.Mesh(behindGeometry, behindMaterial)
  behindMenu.position.z = -0.1
  let sceneActions = 0
  const countSceneAction = () => {
    sceneActions += 1
  }
  const wristMenuEvents = []
  let store
  let menuGroup

  try {
    await fiber.act(async () => {
      store = root.render(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(WristMenu, {
            snapshot: controllerActionSnapshot,
            onEvent: (event) => wristMenuEvents.push(event),
          }),
          React.createElement('primitive', {
            object: behindMenu,
            onPointerDown: countSceneAction,
            onPointerUp: countSceneAction,
            onClick: countSceneAction,
          }),
        ),
      )
    })

    const state = store.getState()
    const shield = state.scene.children[0]
    menuGroup = shield.children[0]
    const ray = new three.Raycaster(
      new three.Vector3(0, 0, 1),
      new three.Vector3(0, 0, -1),
    )

    fiber.advance(16, true, state, fixture.nextFrame(16))
    assert.equal(ray.intersectObject(menuGroup, true).length, 0)
    fiber.advance(32, true, state, fixture.nextFrame(32))
    assert.ok(ray.intersectObject(menuGroup, true).length > 0)

    fiber.advance(48, true, state, fixture.press(48))
    canvas.dispatch('pointerdown')
    canvas.dispatch('pointerup')
    canvas.dispatch('click')
    assert.equal(sceneActions, 0)

    fiber.advance(64, true, state, fixture.release(64))
    assert.equal(
      wristMenuEvents.filter(({ type }) => type === 'selection-intent').length,
      1,
    )
  } finally {
    await fiber.act(async () => root.unmount())
    assert.equal(menuGroup?.children.length ?? 0, 0)
    behindGeometry.dispose()
    behindMaterial.dispose()
    fixture.restoreGlobals()
    if (previousActEnvironment === undefined) {
      delete globalThis.IS_REACT_ACT_ENVIRONMENT
    } else {
      globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
    }
  }
}
