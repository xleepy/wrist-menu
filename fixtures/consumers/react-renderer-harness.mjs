import { performance } from 'node:perf_hooks'

const wristMenuFramePriority = -1000

export function instrumentUniqueAddedFrameSubscription(
  beforeSubscribers,
  afterSubscribers,
  { now = () => performance.now() } = {},
) {
  const before = new Set(beforeSubscribers)
  const candidates = afterSubscribers.filter(
    (subscription) =>
      !before.has(subscription) &&
      subscription?.priority === wristMenuFramePriority,
  )
  if (candidates.length !== 1) {
    throw new Error(
      'expected exactly one newly registered priority -1000 frame subscription',
    )
  }
  const subscription = candidates[0]
  const originalCallback = subscription.ref?.current
  if (typeof originalCallback !== 'function') {
    throw new Error('newly registered frame subscription has no callback')
  }
  let recording = false
  let timings = []
  const wrappedCallback = function (...args) {
    if (!recording) return Reflect.apply(originalCallback, this, args)
    const startedAt = now()
    try {
      return Reflect.apply(originalCallback, this, args)
    } finally {
      timings.push(now() - startedAt)
    }
  }
  subscription.ref.current = wrappedCallback
  return Object.freeze({
    start() {
      timings = []
      recording = true
    },
    stop() {
      recording = false
      return Object.freeze([...timings])
    },
    restore() {
      recording = false
      if (subscription.ref.current === wrappedCallback) {
        subscription.ref.current = originalCallback
      }
    },
  })
}

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
              left: { assetPath: 'left.glb', components: {} },
              right: { assetPath: 'right.glb', components: {} },
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
      const listener = listeners.get(type)
      listener?.({
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
      return listener !== undefined
    },
  }
  return canvas
}

const oppositeWrist = (wrist) => (wrist === 'left' ? 'right' : 'left')

export async function createIwerControllerFixture(iwer, menuWrist = 'left') {
  const restoreGlobals = installIwerNodePrimitives()
  const device = new iwer.XRDevice(iwer.metaQuest3, {
    canvasContainer: { dataset: {}, style: {} },
  })
  device.primaryInputMode = 'controller'
  const menuController = device.controllers[menuWrist]
  menuController.position.set(0, 0, 0)
  menuController.quaternion.set(0, -Math.SQRT1_2, 0, Math.SQRT1_2)
  const controller = device.controllers[oppositeWrist(menuWrist)]
  controller.position.set(0, 0, 1)
  controller.quaternion.set(0, 0, 0, 1)

  let session = new iwer.XRSession(device, 'immersive-vr', ['local-floor'])
  let referenceSpace = await session.requestReferenceSpace('local-floor')
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
    device,
    get frameCount() {
      return sequence
    },
    inputSource: controller.inputSource,
    menuInput: menuController,
    menuWrist,
    get referenceSpace() {
      return referenceSpace
    },
    get session() {
      return session
    },
    nextFrame,
    press(time) {
      controller.updateButtonValue('trigger', 1)
      return nextFrame(time)
    },
    release(time) {
      controller.updateButtonValue('trigger', 0)
      return nextFrame(time)
    },
    async endSession() {
      await session.end()
    },
    async reenterSession() {
      session = new iwer.XRSession(device, 'immersive-vr', ['local-floor'])
      referenceSpace = await session.requestReferenceSpace('local-floor')
      session[iwer.P_SESSION].updateActiveInputSources()
      return session
    },
    restoreGlobals,
  }
}

export async function createIwerHandFixture(iwer, menuWrist = 'left') {
  const restoreGlobals = installIwerNodePrimitives()
  const device = new iwer.XRDevice(iwer.metaQuest3, {
    canvasContainer: { dataset: {}, style: {} },
  })
  device.primaryInputMode = 'hand'
  const menuHand = device.hands[menuWrist]
  menuHand.position.set(-0.2, 1.2, -0.5)
  menuHand.quaternion.set(0, 0, 0, 1)
  const selectionHand = device.hands[oppositeWrist(menuWrist)]
  selectionHand.position.set(0.5, 1.2, 0)
  selectionHand.quaternion.set(0, 0, 0, 1)

  let session = new iwer.XRSession(device, 'immersive-vr', [
    'local-floor',
    'hand-tracking',
  ])
  let referenceSpace = await session.requestReferenceSpace('local-floor')
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
    device,
    get frameCount() {
      return sequence
    },
    inputSource: selectionHand.inputSource,
    menuInput: menuHand,
    menuWrist,
    selectionInput: selectionHand,
    get referenceSpace() {
      return referenceSpace
    },
    get session() {
      return session
    },
    nextFrame,
    moveFingertipTo(frame, target) {
      const fingertipSpace = selectionHand.inputSource.hand.get('index-finger-tip')
      const pose = frame.getJointPose(fingertipSpace, referenceSpace)
      if (pose === null) throw new Error('IWER fingertip pose is unavailable')
      selectionHand.position.set(
        selectionHand.position.x + target.x - pose.transform.position.x,
        selectionHand.position.y + target.y - pose.transform.position.y,
        selectionHand.position.z + target.z - pose.transform.position.z,
      )
    },
    async endSession() {
      await session.end()
    },
    async reenterSession() {
      session = new iwer.XRSession(device, 'immersive-vr', [
        'local-floor',
        'hand-tracking',
      ])
      referenceSpace = await session.requestReferenceSpace('local-floor')
      session[iwer.P_SESSION].updateActiveInputSources()
      return session
    },
    restoreGlobals,
  }
}

export async function createReactIwerRendererHarness({
  React,
  fiber,
  iwer,
  three,
  xr,
  sourceKind,
  wrist,
}) {
  if (sourceKind !== 'controller' && sourceKind !== 'hand') {
    throw new Error('React IWER harness sourceKind must be controller or hand')
  }
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const fixture = sourceKind === 'controller'
    ? await createIwerControllerFixture(iwer, wrist)
    : await createIwerHandFixture(iwer, wrist)
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
    dispatchSessionEnd() {
      for (const listener of xrManagerListeners.get('sessionend') ?? []) {
        listener({ type: 'sessionend' })
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

  const xrStore = sourceKind === 'controller'
    ? xr.createXRStore({
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
    : null
  let store
  const hostTree = (tree) => sourceKind === 'controller'
    ? React.createElement(xr.XR, { store: xrStore }, tree)
    : React.createElement(React.Fragment, null, tree)
  const render = async (tree) => {
    await fiber.act(async () => {
      const nextStore = root.render(hostTree(tree))
      store ??= nextStore
    })
  }
  await render(React.createElement(React.Fragment, null))
  if (sourceKind === 'controller') {
    await fiber.act(async () => xrManager.dispatchSessionStart())
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (xrStore.getState().inputSourceStates.length > 0) break
      await fiber.act(async () => Promise.resolve())
    }
  }
  const state = store.getState()
  const advance = async (time, frame = fixture.nextFrame(time)) => {
    await fiber.act(async () => {
      fiber.advance(time / 1000, true, state, frame)
    })
  }
  const menuGroup = () => state.scene.children.find(
    ({ name }) => name === 'wrist-menu-attachment-root',
  )
  const aimSelectionAtMenuLocal = (
    group,
    { x = 0, y = 0, controllerZ = 1, handZ = 0.06, frame } = {},
  ) => {
    if (sourceKind === 'controller') {
      const origin = group.localToWorld(new three.Vector3(x, y, controllerZ))
      const orientation = group.getWorldQuaternion(new three.Quaternion())
      fixture.controller.position.copy(origin)
      fixture.controller.quaternion.copy(orientation)
      return
    }
    if (frame === undefined) {
      throw new Error('hand aiming requires a current IWER pose frame')
    }
    fixture.moveFingertipTo(
      frame,
      group.localToWorld(new three.Vector3(x, y, handZ)),
    )
  }
  const releaseSelectionSource = (distance = 2) => {
    const selectionInput = sourceKind === 'controller'
      ? fixture.controller
      : fixture.selectionInput
    selectionInput.position.x += distance
  }
  const placeSelectionAway = () => {
    const selectionInput = sourceKind === 'controller'
      ? fixture.controller
      : fixture.selectionInput
    selectionInput.position.set(2, 2, 1)
    selectionInput.quaternion.set(0, 0, 0, 1)
  }
  const endAndReenterSession = async () => {
    const previousSession = fixture.session
    await fiber.act(async () => {
      await fixture.endSession()
      if (sourceKind === 'controller') xrManager.dispatchSessionEnd()
    })
    const endedStoreSession = sourceKind !== 'controller' ||
      xrStore.getState().session == null
    const nextSession = await fixture.reenterSession()
    if (sourceKind === 'controller') {
      await fiber.act(async () => xrManager.dispatchSessionStart())
      for (let attempt = 0; attempt < 10; attempt += 1) {
        if (xrStore.getState().session === nextSession) break
        await fiber.act(async () => Promise.resolve())
      }
    }
    return {
      previousSession,
      nextSession,
      iwerSessionEnded: previousSession[iwer.P_SESSION].ended === true,
      endedStoreSession,
      reenteredStoreSession:
        sourceKind !== 'controller' || xrStore.getState().session === nextSession,
    }
  }
  return Object.freeze({
    canvas,
    fixture,
    state,
    advance,
    async advanceFrames(
      count,
      { startTime = 0, timeStep = 1, beforeFrame = () => undefined } = {},
    ) {
      let time = startTime
      await fiber.act(async () => {
        for (let index = 0; index < count; index += 1) {
          time += timeStep
          beforeFrame({ index, time })
          fiber.advance(
            time / 1000,
            true,
            state,
            fixture.nextFrame(time),
          )
        }
      })
      return time
    },
    aimSelectionAtMenuLocal,
    endAndReenterSession,
    frameSubscribers() {
      return Object.freeze([...state.internal.subscribers])
    },
    menuGroup,
    nextFrame: (time) => fixture.nextFrame(time),
    placeSelectionAway,
    releaseSelectionSource,
    render,
    async dispose() {
      try {
        await fiber.act(async () => root.unmount())
      } finally {
        xrStore?.destroy()
        fixture.restoreGlobals()
        if (previousActEnvironment === undefined) {
          delete globalThis.IS_REACT_ACT_ENVIRONMENT
        } else {
          globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
        }
      }
    },
  })
}

const packedWristMenuReactModule =
  /[/\\]node_modules[/\\]@xleepy[/\\]wrist-menu[/\\]dist[/\\]react[/\\]index\.js(?:\?|:|\)|$)/

export function packedWristMenuOwnsHook(stack) {
  return packedWristMenuReactModule.test(stack)
}

/**
 * Wrap the real React runtime before the packed React entry point is imported.
 * Setters are tagged from their hook-creation stack and counted at dispatch,
 * including eager same-value dispatches that never produce a React commit.
 */
export function installReactStateSetterProbe(
  reactRuntime,
  { ownsHook = packedWristMenuOwnsHook } = {},
) {
  const originalUseState = reactRuntime.useState
  if (typeof originalUseState !== 'function') {
    throw new TypeError('React useState is required for setter instrumentation')
  }
  let recording = false
  let reactStateSetterCalls = 0
  let taggedSetterCount = 0
  const wrappedSetters = new WeakMap()

  function instrumentedUseState(...args) {
    const result = Reflect.apply(originalUseState, this, args)
    const stack = new Error().stack ?? ''
    if (!ownsHook(stack)) return result
    const setter = result[1]
    let wrappedSetter = wrappedSetters.get(setter)
    if (wrappedSetter === undefined) {
      taggedSetterCount += 1
      wrappedSetter = function (...setterArgs) {
        if (recording) reactStateSetterCalls += 1
        return Reflect.apply(setter, this, setterArgs)
      }
      wrappedSetters.set(setter, wrappedSetter)
    }
    return [result[0], wrappedSetter]
  }

  reactRuntime.useState = instrumentedUseState
  return Object.freeze({
    beginFrameSamples() {
      reactStateSetterCalls = 0
      recording = true
    },
    endFrameSamples() {
      recording = false
      return Object.freeze({ reactStateSetterCalls })
    },
    taggedSetterCount() {
      return taggedSetterCount
    },
    restore() {
      recording = false
      if (reactRuntime.useState === instrumentedUseState) {
        reactRuntime.useState = originalUseState
      }
    },
  })
}
