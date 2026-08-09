import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BoxGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  Vector3,
} from 'three'

import {
  createThreeWristMenuState,
  disposeThreeWristMenu,
  syncThreeWristMenu,
  threeWristMenuBlocksSceneInput,
  updateThreeWristMenu,
} from '../dist/three/index.js'
import { reachScrollSnapshot } from '../fixtures/reach-scroll.mjs'
import { automaticHandSnapshot } from '../fixtures/wrist-reveal.mjs'
import { createWristXrFixture } from '../fixtures/wrist-reveal-xr.mjs'

const immediateAutomaticSnapshot = Object.freeze({
  ...automaticHandSnapshot,
  comfort: Object.freeze({
    initialDwellMs: 0,
    reacquireDwellMs: 200,
    transitionMs: 0,
  }),
})

test('vanilla integration anchors from the current wrist joint in its current parent space', () => {
  const fixture = createWristXrFixture({ menuKind: 'hand' })
  fixture.setWristMatrix(new Matrix4().makeTranslation(0.25, 1.1, -0.4))
  const menu = createThreeWristMenuState({
    renderer: fixture.renderer,
    snapshot: immediateAutomaticSnapshot,
    onEvent: () => undefined,
  })
  const parent = new Group()
  parent.position.set(1, 0, 0)
  parent.add(menu.presentation.group)

  updateThreeWristMenu(menu, { time: 0, frame: fixture.frame })
  parent.updateMatrixWorld(true)
  const worldPosition = menu.presentation.group.getWorldPosition(new Vector3())
  assert.deepEqual(worldPosition.toArray().map(round4), [0.25, 1.1, -0.4])
  assert.ok(
    fixture.poseCalls.some(
      ({ method, space }) => method === 'joint' && space === fixture.menuSource.hand.get('wrist'),
    ),
  )

  fixture.setWristMatrix(new Matrix4().makeTranslation(0.3, 1.2, -0.5))
  updateThreeWristMenu(menu, { time: 1, frame: fixture.frame })
  parent.updateMatrixWorld(true)
  assert.deepEqual(
    menu.presentation.group.getWorldPosition(new Vector3()).toArray().map(round4),
    [0.3, 1.2, -0.5],
  )
  disposeThreeWristMenu(menu)
})

test('controller anchor uses grip-derived Quest 2 proxy independently of target-ray pointing', () => {
  const fixture = createWristXrFixture({ menuKind: 'controller' })
  fixture.setWristMatrix(new Matrix4())
  fixture.setTargetRayMatrix(new Matrix4().makeTranslation(9, 8, 7))
  const menu = createThreeWristMenuState({
    renderer: fixture.renderer,
    snapshot: {
      ...automaticHandSnapshot,
      activationMode: 'forced-open',
      comfort: { transitionMs: 0 },
      controllerWrist: { deviceTarget: 'quest-2' },
    },
    onEvent: () => undefined,
  })

  updateThreeWristMenu(menu, { time: 0, frame: fixture.frame })
  assert.deepEqual(menu.presentation.group.position.toArray().map(round4), [0.02, 0.096, 0.008])

  assert.deepEqual(
    new Vector3(0, 0, 1)
      .applyQuaternion(menu.presentation.group.quaternion)
      .toArray()
      .map(round4),
    [0.9903, 0.1392, 0],
  )
  assert.ok(
    fixture.poseCalls.some(
      ({ method, space }) => method === 'pose' && space === fixture.menuSource.gripSpace,
    ),
  )
  assert.notDeepEqual(menu.presentation.group.position.toArray().map(round4), [9, 8, 7])
  disposeThreeWristMenu(menu)
})

test('controller raycasts use the current-frame wrist transform instead of stale geometry', () => {
  const fixture = createWristXrFixture({ menuKind: 'controller' })
  const wristOrientation = new Matrix4().makeRotationY(-Math.PI / 2)
  fixture.setWristMatrix(wristOrientation)
  const menu = createThreeWristMenuState({
    renderer: fixture.renderer,
    snapshot: {
      ...automaticHandSnapshot,
      activationMode: 'forced-open',
      comfort: { transitionMs: 0 },
      controllerWrist: {
        offsets: {
          left: {
            translationMeters: [0, 0, 0],
            rotationDegrees: [0, 0, 0],
          },
        },
      },
    },
    onEvent: () => undefined,
  })
  updateThreeWristMenu(menu, { time: 0, frame: fixture.frame })
  updateThreeWristMenu(menu, { time: 1, frame: fixture.frame })
  assert.ok(
    new Raycaster(new Vector3(0, 0, 1), new Vector3(0, 0, -1))
      .intersectObject(menu.presentation.group, true).length > 0,
  )

  fixture.setWristMatrix(
    new Matrix4().makeTranslation(1, 0, 0).multiply(wristOrientation),
  )
  fixture.session.dispatch('selectstart', fixture.selectionSource)
  updateThreeWristMenu(menu, { time: 2, frame: fixture.frame })

  assert.equal(menu.presentation.group.position.x, 1)
  assert.equal(threeWristMenuBlocksSceneInput(menu, fixture.selectionSource), false)
  disposeThreeWristMenu(menu)
})

test('an identical stabilized Frame Sample performs zero instrumented Three property writes', () => {
  const fixture = createWristXrFixture({ menuKind: 'controller' })
  fixture.setWristMatrix(new Matrix4())
  const menu = createThreeWristMenuState({
    renderer: fixture.renderer,
    snapshot: reachScrollSnapshot,
    onEvent: () => undefined,
  })
  updateThreeWristMenu(menu, { time: 0, frame: fixture.frame })
  updateThreeWristMenu(menu, { time: 1, frame: fixture.frame })

  const probes = [
    [menu.anchorPosition.constructor.prototype, 'fromArray'],
    [menu.anchorOrientation.constructor.prototype, 'fromArray'],
    [menu.anchorMatrix.constructor.prototype, 'compose'],
    [menu.anchorMatrix.constructor.prototype, 'decompose'],
  ]
  const originals = []
  let writes = 0
  try {
    for (const [prototype, method] of probes) {
      const original = prototype[method]
      originals.push([prototype, method, original])
      prototype[method] = function (...args) {
        writes += 1
        return original.apply(this, args)
      }
    }
    updateThreeWristMenu(menu, { time: 1, frame: fixture.frame })
  } finally {
    for (const [prototype, method, original] of originals) {
      prototype[method] = original
    }
    disposeThreeWristMenu(menu)
  }

  assert.equal(writes, 0)
})

test('a changed wrist pose applies one package-owned anchor mutation sequence', () => {
  const fixture = createWristXrFixture({ menuKind: 'controller' })
  const menu = createThreeWristMenuState({
    renderer: fixture.renderer,
    snapshot: {
      ...automaticHandSnapshot,
      activationMode: 'forced-open',
      comfort: { transitionMs: 0 },
      controllerWrist: {
        offsets: {
          left: {
            translationMeters: [0, 0, 0],
            rotationDegrees: [0, 0, 0],
          },
        },
      },
    },
    onEvent: () => undefined,
  })
  updateThreeWristMenu(menu, { time: 0, frame: fixture.frame })
  updateThreeWristMenu(menu, { time: 1, frame: fixture.frame })

  const calls = {
    positionFromArray: 0,
    orientationFromArray: 0,
    compose: 0,
    decompose: 0,
  }
  const probes = [
    [menu.anchorPosition, 'fromArray', 'positionFromArray'],
    [menu.anchorOrientation, 'fromArray', 'orientationFromArray'],
    [menu.anchorMatrix, 'compose', 'compose'],
    [menu.anchorMatrix, 'decompose', 'decompose'],
  ]
  const originals = []
  try {
    for (const [object, method, counter] of probes) {
      const original = object[method]
      originals.push([object, method, original])
      object[method] = function (...args) {
        calls[counter] += 1
        return original.apply(this, args)
      }
    }
    fixture.setWristMatrix(new Matrix4().makeTranslation(0.25, 1.1, -0.4))
    updateThreeWristMenu(menu, { time: 2, frame: fixture.frame })
  } finally {
    for (const [object, method, original] of originals) {
      object[method] = original
    }
  }

  assert.deepEqual(calls, {
    positionFromArray: 1,
    orientationFromArray: 1,
    compose: 1,
    decompose: 1,
  })
  assert.deepEqual(
    menu.presentation.group.position.toArray().map(round4),
    [0.25, 1.1, -0.4],
  )
  disposeThreeWristMenu(menu)
})

test('the Three presentation updates once for a changed Presentation Model and not for steady models', () => {
  const fixture = createWristXrFixture({ menuKind: 'controller' })
  const observedModels = []
  const geometry = new BoxGeometry(0.192, 0.27, 0.004)
  const material = new MeshBasicMaterial({ visible: false })
  const menu = createThreeWristMenuState({
    renderer: fixture.renderer,
    snapshot: reachScrollSnapshot,
    onEvent: () => undefined,
    presentationFactory(initialModel) {
      const root = new Group()
      const viewport = new Mesh(geometry, material)
      root.add(viewport)
      return {
        root,
        hitRegions: [],
        menuViewport: { object: viewport },
        update(model) {
          observedModels.push(model)
        },
        dispose() {
          geometry.dispose()
          material.dispose()
        },
      }
    },
  })
  updateThreeWristMenu(menu, { time: 0, frame: fixture.frame })
  updateThreeWristMenu(menu, { time: 1, frame: fixture.frame })
  updateThreeWristMenu(menu, { time: 2, frame: fixture.frame })
  const stableUpdateCount = observedModels.length

  updateThreeWristMenu(menu, { time: 3, frame: fixture.frame })
  assert.equal(observedModels.length, stableUpdateCount)

  syncThreeWristMenu(menu, {
    ...reachScrollSnapshot,
    menuDefinition: reachScrollSnapshot.menuDefinition.slice(0, 1),
  })
  updateThreeWristMenu(menu, { time: 4, frame: fixture.frame })
  assert.equal(observedModels.length, stableUpdateCount + 1)
  assert.equal(observedModels.at(-1).items.length, 1)

  updateThreeWristMenu(menu, { time: 5, frame: fixture.frame })
  assert.equal(observedModels.length, stableUpdateCount + 2)
  updateThreeWristMenu(menu, { time: 6, frame: fixture.frame })
  assert.equal(observedModels.length, stableUpdateCount + 2)
  disposeThreeWristMenu(menu)
})

test('reference reset and reparenting make an automatic menu non-interactive until fresh dwell', () => {
  const fixture = createWristXrFixture({ menuKind: 'hand' })
  const menu = createThreeWristMenuState({
    renderer: fixture.renderer,
    snapshot: immediateAutomaticSnapshot,
    onEvent: () => undefined,
  })
  const firstParent = new Group()
  firstParent.add(menu.presentation.group)

  updateThreeWristMenu(menu, { time: 0, frame: fixture.frame })
  updateThreeWristMenu(menu, { time: 1, frame: fixture.frame })
  assert.equal(menu.presentation.group.visible, true)

  fixture.referenceSpace.dispatchReset()
  updateThreeWristMenu(menu, { time: 2, frame: fixture.frame })
  assert.equal(menu.presentation.group.visible, false)
  updateThreeWristMenu(menu, { time: 201, frame: fixture.frame })
  assert.equal(menu.presentation.group.visible, false)
  updateThreeWristMenu(menu, { time: 202, frame: fixture.frame })
  assert.equal(menu.presentation.group.visible, true)

  const secondParent = new Group()
  secondParent.add(menu.presentation.group)
  updateThreeWristMenu(menu, { time: 203, frame: fixture.frame })
  assert.equal(menu.presentation.group.visible, false)
  disposeThreeWristMenu(menu)
})

function round4(value) {
  return Math.round(value * 10_000) / 10_000
}
