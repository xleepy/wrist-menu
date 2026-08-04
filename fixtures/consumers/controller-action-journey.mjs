import assert from 'node:assert/strict'

import { controllerActionSnapshot } from '../controller-action.mjs'
import { crossInputSnapshot } from '../cross-input-selection.mjs'

function installIwerNodePrimitives() {
  const names = [
    'DOMPointReadOnly',
    'localStorage',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'fetch',
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
    fetch: {
      configurable: true,
      value: async (url) => ({
        ok: true,
        async json() {
          if (String(url).endsWith('profilesList.json')) {
            return {
              'meta-quest-touch-plus': {
                path: 'meta-quest-touch-plus/profile.json',
              },
            }
          }
          return {
            profileId: 'meta-quest-touch-plus',
            layouts: {
              left: {
                assetPath: 'left.glb',
                components: {},
              },
              right: {
                assetPath: 'right.glb',
                components: {},
              },
            },
          }
        },
      }),
    },
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
  const menuController = device.controllers.left
  menuController.position.set(0, 0, 0)
  menuController.quaternion.set(0, -Math.SQRT1_2, 0, Math.SQRT1_2)
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

async function createIwerHandFixture(iwer) {
  const restoreGlobals = installIwerNodePrimitives()
  const device = new iwer.XRDevice(iwer.metaQuest3, {
    canvasContainer: { dataset: {}, style: {} },
  })
  device.primaryInputMode = 'hand'
  const menuHand = device.hands.left
  menuHand.position.set(-0.2, 1.2, -0.5)
  menuHand.quaternion.set(0, 0, 0, 1)
  const selectionHand = device.hands.right
  selectionHand.position.set(0.5, 1.2, 0)
  selectionHand.quaternion.set(0, 0, 0, 1)

  const session = new iwer.XRSession(device, 'immersive-vr', [
    'local-floor',
    'hand-tracking',
  ])
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
    inputSource: selectionHand.inputSource,
    referenceSpace,
    session,
    nextFrame,
    moveFingertipTo(frame, target) {
      const fingertipSpace = selectionHand.inputSource.hand.get('index-finger-tip')
      const pose = frame.getJointPose(fingertipSpace, referenceSpace)
      assert.ok(pose)
      selectionHand.position.set(
        selectionHand.position.x + target.x - pose.transform.position.x,
        selectionHand.position.y + target.y - pose.transform.position.y,
        selectionHand.position.z + target.z - pose.transform.position.z,
      )
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
    fixture.controller.position.set(
      menu.group.position.x,
      menu.group.position.y,
      menu.group.position.z + 1,
    )
    ray.set(
      new three.Vector3(
        menu.group.position.x,
        menu.group.position.y,
        menu.group.position.z + 1,
      ),
      new three.Vector3(0, 0, -1),
    )
    menu.update({ time: 32, frame: fixture.nextFrame(32) })
    assert.ok(ray.intersectObject(menu.group, true).length > 0)

    fixture.session.addEventListener('selectend', ({ inputSource }) => {
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

export async function runPackedThreeHandJourney({
  createThreeWristMenu,
  iwer,
  three,
}) {
  const fixture = await createIwerHandFixture(iwer)
  const wristMenuEvents = []
  let sceneActions = 0
  const menu = createThreeWristMenu({
    renderer: {
      xr: {
        getSession: () => fixture.session,
        getReferenceSpace: () => fixture.referenceSpace,
      },
    },
    snapshot: crossInputSnapshot,
    onEvent: (event) => wristMenuEvents.push(event),
  })
  const scene = new three.Scene()
  scene.add(menu.group)

  try {
    const initialFrame = fixture.nextFrame(16)
    menu.update({ time: 16, frame: initialFrame })

    const hoverTarget = menu.group.localToWorld(
      new three.Vector3(0, 0.0225, 0.03),
    )
    fixture.moveFingertipTo(initialFrame, hoverTarget)
    const hoverFrame = fixture.nextFrame(32)
    menu.update({ time: 32, frame: hoverFrame })
    assert.equal(menu.blocksSceneInput(fixture.inputSource), true)

    const pressTarget = menu.group.localToWorld(
      new three.Vector3(0, 0.0225, 0.008),
    )
    fixture.moveFingertipTo(hoverFrame, pressTarget)
    menu.update({ time: 48, frame: fixture.nextFrame(48) })
    if (!menu.blocksSceneInput(fixture.inputSource)) sceneActions += 1

    assert.equal(sceneActions, 0)
    assert.deepEqual(
      wristMenuEvents
        .filter(({ type }) => type === 'selection-intent')
        .map(({ intent, source }) => [intent.itemId, source.kind]),
      [['first', 'hand']],
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
  xr,
}) {
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const fixture = await createIwerControllerFixture(iwer)
  const canvas = createCanvas()
  const xrManagerListeners = new Map()
  const xrCamera = new three.PerspectiveCamera(75, 1, 0.1, 1000)
  xrCamera.position.z = 5
  const xrManager = {
    enabled: false,
    isPresenting: true,
    getSession: () => fixture.session,
    getReferenceSpace: () => fixture.referenceSpace,
    getCamera: () => xrCamera,
    setAnimationLoop: () => undefined,
    setReferenceSpaceType: () => undefined,
    setFoveation: () => undefined,
    addEventListener(type, listener) {
      const listeners = xrManagerListeners.get(type) ?? new Set()
      listeners.add(listener)
      xrManagerListeners.set(type, listeners)
    },
    removeEventListener(type, listener) {
      xrManagerListeners.get(type)?.delete(listener)
    },
    dispatchSessionStart() {
      for (const listener of xrManagerListeners.get('sessionstart') ?? []) {
        listener({ type: 'sessionstart' })
      }
    },
  }
  const renderer = {
    xr: xrManager,
    render: () => undefined,
    setPixelRatio: () => undefined,
    setSize: () => undefined,
    outputColorSpace: '',
    toneMapping: 0,
  }
  const root = fiber.createRoot(canvas)
  fiber.extend(three)
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
  behindMenu.addEventListener('pointerdown', countSceneAction)
  behindMenu.addEventListener('pointerup', countSceneAction)
  behindMenu.addEventListener('click', countSceneAction)
  const wristMenuEvents = []
  const xrStore = xr.createXRStore({
    baseAssetPath: 'https://fixtures.invalid/webxr-input-profiles/',
    controller: {
      model: false,
      grabPointer: false,
      rayPointer: { rayModel: false, cursorModel: false },
    },
    hand: false,
    transientPointer: false,
    gaze: false,
    screenInput: false,
    emulate: false,
  })
  let store
  let menuGroup

  try {
    await fiber.act(async () => {
      store = root.render(
        React.createElement(
          xr.XR,
          { store: xrStore },
          React.createElement(WristMenu, {
            key: 'wrist-menu',
            snapshot: controllerActionSnapshot,
            onEvent: (event) => wristMenuEvents.push(event),
          }),
          React.createElement('primitive', {
            key: 'behind-target',
            object: behindMenu,
            onPointerDown: countSceneAction,
            onPointerUp: countSceneAction,
            onClick: countSceneAction,
          }),
        ),
      )
    })
    await fiber.act(async () => xrManager.dispatchSessionStart())

    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (xrStore.getState().inputSourceStates.length > 0) break
      await fiber.act(async () => Promise.resolve())
    }

    const state = store.getState()
    assert.equal(xrStore.getState().session, fixture.session)
    assert.equal(xrStore.getState().inputSourceStates.length, 2)
    menuGroup = state.scene.children.find(
      ({ name }) => name === 'wrist-menu-attachment-root',
    )
    assert.ok(menuGroup)
    const ray = new three.Raycaster(
      new three.Vector3(0, 0, 1),
      new three.Vector3(0, 0, -1),
    )

    await fiber.act(async () => {
      fiber.advance(16, true, state, fixture.nextFrame(16))
    })
    assert.equal(ray.intersectObject(menuGroup, true).length, 0)
    fixture.controller.position.set(
      menuGroup.position.x,
      menuGroup.position.y,
      menuGroup.position.z + 1,
    )
    ray.set(
      new three.Vector3(
        menuGroup.position.x,
        menuGroup.position.y,
        menuGroup.position.z + 1,
      ),
      new three.Vector3(0, 0, -1),
    )
    await fiber.act(async () => {
      fiber.advance(32, true, state, fixture.nextFrame(32))
    })
    assert.ok(ray.intersectObject(menuGroup, true).length > 0)
    await fiber.act(async () => {
      fiber.advance(33, true, state, fixture.nextFrame(33))
    })

    let pressedFrame
    await fiber.act(async () => {
      pressedFrame = fixture.press(48)
    })
    assert.equal(sceneActions, 0)
    await fiber.act(async () => {
      fiber.advance(48, true, state, pressedFrame)
    })

    let releasedFrame
    await fiber.act(async () => {
      releasedFrame = fixture.release(64)
    })
    assert.equal(sceneActions, 0)
    await fiber.act(async () => {
      fiber.advance(64, true, state, releasedFrame)
    })
    assert.equal(
      wristMenuEvents.filter(({ type }) => type === 'selection-intent').length,
      1,
    )

    // Prove the XR pointer path is live by removing only the wrist menu and
    // driving the same IWER controller through the same XR store and target.
    await fiber.act(async () => {
      root.render(
        React.createElement(
          xr.XR,
          { store: xrStore },
          React.createElement('primitive', {
            key: 'behind-target',
            object: behindMenu,
            onPointerDown: countSceneAction,
            onPointerUp: countSceneAction,
            onClick: countSceneAction,
          }),
        ),
      )
    })
    assert.equal(
      state.scene.children.some(
        ({ name }) => name === 'wrist-menu-attachment-root',
      ),
      false,
    )
    await fiber.act(async () => {
      fiber.advance(80, true, state, fixture.nextFrame(80))
    })
    await fiber.act(async () => {
      fixture.press(96)
    })
    assert.ok(sceneActions > 0)
    await fiber.act(async () => {
      fixture.release(112)
    })
  } finally {
    await fiber.act(async () => root.unmount())
    assert.equal(menuGroup?.children.length ?? 0, 0)
    behindMenu.removeEventListener('pointerdown', countSceneAction)
    behindMenu.removeEventListener('pointerup', countSceneAction)
    behindMenu.removeEventListener('click', countSceneAction)
    behindGeometry.dispose()
    behindMaterial.dispose()
    xrStore.destroy()
    fixture.restoreGlobals()
    if (previousActEnvironment === undefined) {
      delete globalThis.IS_REACT_ACT_ENVIRONMENT
    } else {
      globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
    }
  }
}

export async function runPackedReactHandJourney({
  React,
  WristMenu,
  fiber,
  iwer,
  three,
}) {
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const fixture = await createIwerHandFixture(iwer)
  const canvas = createCanvas()
  const xrManagerListeners = new Map()
  const renderer = {
    xr: {
      enabled: false,
      isPresenting: true,
      getSession: () => fixture.session,
      getReferenceSpace: () => fixture.referenceSpace,
      setAnimationLoop: () => undefined,
      addEventListener(type, listener) {
        xrManagerListeners.set(type, listener)
      },
      removeEventListener(type) {
        xrManagerListeners.delete(type)
      },
    },
    render: () => undefined,
    setPixelRatio: () => undefined,
    setSize: () => undefined,
    outputColorSpace: '',
    toneMapping: 0,
  }
  const root = fiber.createRoot(canvas)
  fiber.extend(three)
  await root.configure({
    gl: renderer,
    events: fiber.events,
    frameloop: 'never',
    size: { width: 1, height: 1, top: 0, left: 0 },
  })

  const behindGeometry = new three.BoxGeometry(0.5, 0.5, 0.02)
  const behindMaterial = new three.MeshBasicMaterial()
  const behind = new three.Mesh(behindGeometry, behindMaterial)
  let sceneActions = 0
  const countSceneAction = () => {
    sceneActions += 1
  }
  const wristMenuEvents = []
  let store

  try {
    await fiber.act(async () => {
      store = root.render(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(WristMenu, {
            snapshot: crossInputSnapshot,
            onEvent: (event) => wristMenuEvents.push(event),
          }),
          React.createElement('primitive', {
            object: behind,
            onPointerDown: countSceneAction,
            onPointerUp: countSceneAction,
            onClick: countSceneAction,
          }),
        ),
      )
    })
    const state = store.getState()
    const initialFrame = fixture.nextFrame(16)
    await fiber.act(async () => {
      fiber.advance(16, true, state, initialFrame)
    })
    const menuGroup = state.scene.children.find(
      ({ name }) => name === 'wrist-menu-attachment-root',
    )
    assert.ok(menuGroup)

    state.camera.position.copy(
      menuGroup.localToWorld(new three.Vector3(0, 0, 1)),
    )
    state.camera.quaternion.copy(menuGroup.quaternion)
    state.camera.updateMatrixWorld(true)
    behind.position.copy(
      menuGroup.localToWorld(new three.Vector3(0, 0, -0.1)),
    )
    behind.quaternion.copy(menuGroup.quaternion)
    behind.updateMatrixWorld(true)

    const hoverTarget = menuGroup.localToWorld(
      new three.Vector3(0, 0.0225, 0.03),
    )
    fixture.moveFingertipTo(initialFrame, hoverTarget)
    const hoverFrame = fixture.nextFrame(32)
    await fiber.act(async () => {
      fiber.advance(32, true, state, hoverFrame)
    })
    canvas.dispatch('pointerdown')
    canvas.dispatch('pointerup')
    canvas.dispatch('click')

    const pressTarget = menuGroup.localToWorld(
      new three.Vector3(0, 0.0225, 0.008),
    )
    fixture.moveFingertipTo(hoverFrame, pressTarget)
    await fiber.act(async () => {
      fiber.advance(48, true, state, fixture.nextFrame(48))
    })

    assert.equal(sceneActions, 0)
    assert.deepEqual(
      wristMenuEvents
        .filter(({ type }) => type === 'selection-intent')
        .map(({ intent, source }) => [intent.itemId, source.kind]),
      [['first', 'hand']],
    )
  } finally {
    await fiber.act(async () => root.unmount())
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
