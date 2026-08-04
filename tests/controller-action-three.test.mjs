import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4, Quaternion, Raycaster, Scene, Vector3 } from 'three'

import {
  createThreeWristMenuState,
  disposeThreeWristMenu,
  threeWristMenuBlocksSceneInput,
  updateThreeWristMenu,
} from '../dist/three/index.js'
import {
  controllerActionSnapshot,
  FakeReferenceSpace,
  FakeXrSession,
} from '../fixtures/controller-action.mjs'

function xrPose(matrix) {
  const position = new Vector3()
  const orientation = new Quaternion()
  matrix.decompose(position, orientation, new Vector3())
  return {
    emulatedPosition: false,
    transform: {
      matrix: matrix.toArray(),
      position,
      orientation,
    },
  }
}

function createXrFixture() {
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
  let targetRayMatrix = new Matrix4().makeTranslation(0, 0, 1).toArray()
  const referenceSpace = new FakeReferenceSpace()
  const frame = {
    session,
    getPose(space, reference) {
      assert.equal(reference, referenceSpace)
      if (space === inputSource.targetRaySpace) {
        return xrPose(new Matrix4().fromArray(targetRayMatrix))
      }
      if (space === menuInputSource.gripSpace) {
        return xrPose(new Matrix4().makeRotationY(-Math.PI / 2))
      }
      if (space === inputSource.gripSpace) return xrPose(new Matrix4())
      if (space === menuInputSource.targetRaySpace) return null
      throw new Error('unexpected XRSpace')
    },
    getViewerPose() {
      return xrPose(new Matrix4().makeTranslation(0, 0, 1))
    },
  }
  const renderer = {
    xr: {
      getSession: () => session,
      getReferenceSpace: () => referenceSpace,
    },
  }
  return {
    frame,
    inputSource,
    referenceSpace,
    renderer,
    session,
    setTargetingMenu(targeting) {
      targetRayMatrix = new Matrix4()
        .makeTranslation(targeting ? 0 : 1, 0, 1)
        .toArray()
    },
  }
}

test('vanilla integration enforces the geometry barrier and claims one controller action', () => {
  const events = []
  let sceneActions = 0
  const { frame, inputSource, renderer, session } = createXrFixture()
  const menu = createThreeWristMenuState({
    renderer,
    snapshot: controllerActionSnapshot,
    onEvent: (event) => events.push(event),
  })
  const scene = new Scene()
  scene.add(menu.presentation.group)

  const targetRay = new Raycaster(
    new Vector3(0, 0, 1),
    new Vector3(0, 0, -1),
  )

  updateThreeWristMenu(menu, { time: 16, frame })
  assert.equal(targetRay.intersectObject(menu.presentation.group, true).length, 0)

  updateThreeWristMenu(menu, { time: 32, frame })
  assert.ok(targetRay.intersectObject(menu.presentation.group, true).length > 0)

  session.dispatch('selectstart', inputSource)
  updateThreeWristMenu(menu, { time: 48, frame })
  assert.equal(threeWristMenuBlocksSceneInput(menu, inputSource), true)

  session.addEventListener('select', ({ inputSource: selectedSource }) => {
    if (!threeWristMenuBlocksSceneInput(menu, selectedSource)) sceneActions += 1
  })
  session.dispatch('select', inputSource)
  session.dispatch('selectend', inputSource)
  updateThreeWristMenu(menu, { time: 64, frame })

  assert.equal(sceneActions, 0)
  assert.equal(threeWristMenuBlocksSceneInput(menu, inputSource), false)
  assert.equal(events.filter(({ type }) => type === 'selection-intent').length, 1)
  assert.equal(
    events.find(({ type }) => type === 'selection-intent')?.intent.itemId,
    'spawn-cube',
  )

  updateThreeWristMenu(menu, { time: 80, frame })
  assert.equal(events.filter(({ type }) => type === 'selection-intent').length, 1)

  disposeThreeWristMenu(menu)
  disposeThreeWristMenu(menu)
  assert.equal(menu.presentation.group.parent, null)
  assert.throws(() => updateThreeWristMenu(menu, { time: 96, frame }), /disposed/)
})

test('vanilla integration cancels selectend without a successful select', () => {
  const events = []
  const { frame, inputSource, renderer, session } = createXrFixture()
  const menu = createThreeWristMenuState({
    renderer,
    snapshot: controllerActionSnapshot,
    onEvent: (event) => events.push(event),
  })

  updateThreeWristMenu(menu, { time: 16, frame })
  updateThreeWristMenu(menu, { time: 32, frame })
  session.dispatch('selectstart', inputSource)
  updateThreeWristMenu(menu, { time: 48, frame })
  session.dispatch('selectend', inputSource)
  updateThreeWristMenu(menu, { time: 64, frame })

  assert.equal(
    events.find(({ type }) => type === 'selection-cancellation')?.reason,
    'action-cancelled',
  )
  disposeThreeWristMenu(menu)
})

test('vanilla integration does not claim a press that began away from the menu', () => {
  const events = []
  const {
    frame,
    inputSource,
    renderer,
    session,
    setTargetingMenu,
  } = createXrFixture()
  const menu = createThreeWristMenuState({
    renderer,
    snapshot: controllerActionSnapshot,
    onEvent: (event) => events.push(event),
  })

  setTargetingMenu(false)
  updateThreeWristMenu(menu, { time: 16, frame })
  updateThreeWristMenu(menu, { time: 32, frame })
  session.dispatch('selectstart', inputSource)
  updateThreeWristMenu(menu, { time: 48, frame })
  assert.equal(threeWristMenuBlocksSceneInput(menu, inputSource), false)

  setTargetingMenu(true)
  updateThreeWristMenu(menu, { time: 64, frame })
  session.dispatch('select', inputSource)
  assert.equal(threeWristMenuBlocksSceneInput(menu, inputSource), false)
  session.dispatch('selectend', inputSource)
  updateThreeWristMenu(menu, { time: 80, frame })

  assert.equal(
    events.filter(
      ({ type }) =>
        type === 'selection-intent' || type === 'selection-cancellation',
    ).length,
    0,
  )
  disposeThreeWristMenu(menu)
})

test('session end immediately clears claims and hides the attachment', () => {
  const events = []
  const { frame, inputSource, renderer, session } = createXrFixture()
  const menu = createThreeWristMenuState({
    renderer,
    snapshot: controllerActionSnapshot,
    onEvent: (event) => events.push(event),
  })

  updateThreeWristMenu(menu, { time: 16, frame })
  updateThreeWristMenu(menu, { time: 32, frame })
  session.dispatch('selectstart', inputSource)
  updateThreeWristMenu(menu, { time: 48, frame })
  assert.equal(threeWristMenuBlocksSceneInput(menu, inputSource), true)

  session.dispatch('end')

  assert.equal(threeWristMenuBlocksSceneInput(menu, inputSource), false)
  assert.equal(menu.presentation.group.visible, false)
  assert.equal(
    events.some(
      (event) =>
        event.type === 'selection-cancellation' &&
        event.reason === 'lifecycle-interrupted',
    ),
    true,
  )
  disposeThreeWristMenu(menu)
})

test('visibility blur and reference reset cancel claims without waiting for a frame', () => {
  const events = []
  const { frame, inputSource, referenceSpace, renderer, session } = createXrFixture()
  const menu = createThreeWristMenuState({
    renderer,
    snapshot: controllerActionSnapshot,
    onEvent: (event) => events.push(event),
  })

  updateThreeWristMenu(menu, { time: 16, frame })
  updateThreeWristMenu(menu, { time: 32, frame })
  session.dispatch('selectstart', inputSource)
  updateThreeWristMenu(menu, { time: 48, frame })
  assert.equal(threeWristMenuBlocksSceneInput(menu, inputSource), true)

  session.visibilityState = 'visible-blurred'
  session.dispatch('visibilitychange')
  assert.equal(threeWristMenuBlocksSceneInput(menu, inputSource), false)

  session.visibilityState = 'visible'
  session.dispatch('visibilitychange')
  updateThreeWristMenu(menu, { time: 64, frame })
  session.dispatch('selectend', inputSource)
  updateThreeWristMenu(menu, { time: 80, frame })
  session.dispatch('selectstart', inputSource)
  updateThreeWristMenu(menu, { time: 96, frame })
  assert.equal(threeWristMenuBlocksSceneInput(menu, inputSource), true)

  referenceSpace.dispatchReset()
  assert.equal(threeWristMenuBlocksSceneInput(menu, inputSource), false)
  assert.equal(menu.presentation.group.visible, false)
  assert.ok(
    events.filter(({ type }) => type === 'selection-cancellation').length >= 2,
  )
  disposeThreeWristMenu(menu)
})

test('session and reference-space handlers keep one identity for the instance lifetime', () => {
  const { renderer } = createXrFixture()
  const firstSession = renderer.xr.getSession()
  const firstReferenceSpace = renderer.xr.getReferenceSpace()
  const menu = createThreeWristMenuState({
    renderer,
    snapshot: controllerActionSnapshot,
    onEvent: () => undefined,
  })
  const sessionHandlers = menu.sessionHandlers
  const referenceSpaceHandler = menu.referenceSpaceHandler

  assert.ok(sessionHandlers)
  assert.equal(typeof referenceSpaceHandler, 'function')

  updateThreeWristMenu(menu, { time: 16, frame: null })
  for (const [eventType, handler] of Object.entries(sessionHandlers)) {
    assert.equal(firstSession.listeners.get(eventType)?.has(handler), true)
  }
  assert.equal(
    firstReferenceSpace.listeners.get('reset')?.has(referenceSpaceHandler),
    true,
  )

  const secondSession = new FakeXrSession([])
  const secondReferenceSpace = new FakeReferenceSpace()
  renderer.xr.getSession = () => secondSession
  renderer.xr.getReferenceSpace = () => secondReferenceSpace
  updateThreeWristMenu(menu, { time: 32, frame: null })

  assert.equal(menu.sessionHandlers, sessionHandlers)
  assert.equal(menu.referenceSpaceHandler, referenceSpaceHandler)
  for (const [eventType, handler] of Object.entries(sessionHandlers)) {
    assert.equal(firstSession.listeners.get(eventType)?.has(handler), false)
    assert.equal(secondSession.listeners.get(eventType)?.has(handler), true)
  }
  assert.equal(
    firstReferenceSpace.listeners.get('reset')?.has(referenceSpaceHandler),
    false,
  )
  assert.equal(
    secondReferenceSpace.listeners.get('reset')?.has(referenceSpaceHandler),
    true,
  )

  disposeThreeWristMenu(menu)
  for (const [eventType, handler] of Object.entries(sessionHandlers)) {
    assert.equal(secondSession.listeners.get(eventType)?.has(handler), false)
  }
  assert.equal(
    secondReferenceSpace.listeners.get('reset')?.has(referenceSpaceHandler),
    false,
  )
})
