import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4, Raycaster, Scene, Vector3 } from 'three'

import { createThreeWristMenu } from '../dist/three/index.js'
import { controllerActionSnapshot } from '../fixtures/controller-action.mjs'

class FakeSession {
  constructor(inputSource) {
    this.inputSources = [inputSource]
    this.visibilityState = 'visible'
    this.listeners = new Map()
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener)
  }

  dispatch(type, inputSource) {
    const event = { type, inputSource }
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

function createXrFixture() {
  const inputSource = {
    handedness: 'right',
    targetRayMode: 'tracked-pointer',
    targetRaySpace: {},
  }
  const session = new FakeSession(inputSource)
  const targetRayMatrix = new Matrix4().makeTranslation(0, 0, 1).toArray()
  const referenceSpace = {}
  const frame = {
    session,
    getPose(space, reference) {
      assert.equal(space, inputSource.targetRaySpace)
      assert.equal(reference, referenceSpace)
      return { transform: { matrix: targetRayMatrix } }
    },
  }
  const renderer = {
    xr: {
      getSession: () => session,
      getReferenceSpace: () => referenceSpace,
    },
  }
  return { frame, inputSource, renderer, session }
}

test('vanilla integration enforces the geometry barrier and claims one controller action', () => {
  const events = []
  let sceneActions = 0
  const { frame, inputSource, renderer, session } = createXrFixture()
  const menu = createThreeWristMenu({
    renderer,
    snapshot: controllerActionSnapshot,
    onEvent: (event) => events.push(event),
  })
  const scene = new Scene()
  scene.add(menu.group)

  const targetRay = new Raycaster(
    new Vector3(0, 0, 1),
    new Vector3(0, 0, -1),
  )

  menu.update({ time: 16, frame })
  assert.equal(targetRay.intersectObject(menu.group, true).length, 0)

  menu.update({ time: 32, frame })
  assert.ok(targetRay.intersectObject(menu.group, true).length > 0)

  session.dispatch('selectstart', inputSource)
  menu.update({ time: 48, frame })
  assert.equal(menu.blocksSceneInput(inputSource), true)

  session.addEventListener('select', ({ inputSource: selectedSource }) => {
    if (!menu.blocksSceneInput(selectedSource)) sceneActions += 1
  })
  session.dispatch('select', inputSource)
  session.dispatch('selectend', inputSource)
  menu.update({ time: 64, frame })

  assert.equal(sceneActions, 0)
  assert.equal(menu.blocksSceneInput(inputSource), false)
  assert.equal(events.filter(({ type }) => type === 'selection-intent').length, 1)
  assert.equal(events[0]?.intent.itemId, 'spawn-cube')

  menu.update({ time: 80, frame })
  assert.equal(events.length, 1)

  menu.dispose()
  menu.dispose()
  assert.equal(menu.group.parent, null)
  assert.throws(() => menu.update({ time: 96, frame }), /disposed/)
})
