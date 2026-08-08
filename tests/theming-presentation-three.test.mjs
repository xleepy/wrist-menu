import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BoxGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
} from 'three'

import { defaultThemeTokens, VISIBLE_SLOTS } from '../dist/core/index.js'
import {
  createThreeWristMenuState,
  disposeThreeWristMenu,
  replaceThreeWristMenuPresentation,
  threeWristMenuBlocksSceneInput,
  updateThreeWristMenu,
} from '../dist/three/index.js'
import { WristMenuPresentation } from '../dist/three/wrist-menu-presentation.js'
import { controllerActionSnapshot } from '../fixtures/controller-action.mjs'
import {
  reachScrollSnapshot,
  ROW_SPACING,
} from '../fixtures/reach-scroll.mjs'
import { createWristXrFixture } from '../fixtures/wrist-reveal-xr.mjs'

function presentationModel(overrides = {}) {
  return {
    visible: true,
    targetable: true,
    opacity: 1,
    revealPhase: 'visible',
    anchorPose: { position: [0, 0, 0], orientation: [0, 0, 0, 1] },
    revision: 1,
    items: [
      {
        type: 'action',
        id: 'spawn',
        label: 'Spawn',
        disabled: false,
        interaction: 'hovered',
      },
    ],
    scrollOffset: 0,
    totalRows: 1,
    visibleSlots: VISIBLE_SLOTS,
    scrollBarrierActive: false,
    theme: defaultThemeTokens,
    ...overrides,
  }
}

test('resolved theme tokens restyle and resize the default Command slab', () => {
  const presentation = new WristMenuPresentation()
  const theme = {
    ...defaultThemeTokens,
    panelWidthMeters: 0.24,
    viewportHeightMeters: 0.3,
    panelColor: 0x010203,
    hoveredItemColor: 0xabcdef,
  }

  presentation.setModel(presentationModel({ theme }), true)

  assert.equal(presentation.panelMesh.material.color.getHex(), 0x010203)
  assert.equal(
    presentation.panelMesh.scale.x,
    theme.panelWidthMeters / defaultThemeTokens.panelWidthMeters,
  )
  assert.equal(
    presentation.panelMesh.scale.y,
    theme.viewportHeightMeters / defaultThemeTokens.viewportHeightMeters,
  )
  const row = presentation.group.children.find(
    ({ name }) => name === 'wrist-menu-action-visual:spawn',
  )
  assert.equal(row.material.color.getHex(), 0xabcdef)

  presentation.dispose()
})

function createFixturePresentationFactory(log) {
  return function presentationFactory(...args) {
    assert.equal(args.length, 1)
    const [initialModel] = args
    log.factoryModels.push(initialModel)

    const root = new Group()
    root.name = `custom-presentation-${log.name}`
    const panelGeometry = new BoxGeometry(0.192, 0.27, 0.004)
    const panelMaterial = new MeshBasicMaterial({ visible: false })
    const panel = new Mesh(panelGeometry, panelMaterial)
    panel.position.z = -0.004
    root.add(panel)
    const hitGeometry = new BoxGeometry(0.176, 0.02, 0.008)
    const hitMaterial = new MeshBasicMaterial({ visible: false })
    const hit = new Mesh(hitGeometry, hitMaterial)
    hit.position.z = 0.008
    root.add(hit)

    return {
      root,
      hitRegions: [{ itemId: 'spawn-cube', object: hit }],
      scrollRegion: { object: panel },
      update(model) {
        log.updateModels.push(model)
        root.visible = model.visible
        hit.visible = model.items.some(({ id }) => id === 'spawn-cube')
      },
      dispose() {
        log.disposals += 1
        panelGeometry.dispose()
        panelMaterial.dispose()
        hitGeometry.dispose()
        hitMaterial.dispose()
        root.clear()
      },
    }
  }
}

test('a custom factory receives only the curated model and preserves controller selection, shielding, and disposal', () => {
  const fixture = createWristXrFixture({ menuKind: 'controller' })
  fixture.setWristMatrix(new Matrix4().makeRotationY(-Math.PI / 2))
  const events = []
  const log = {
    name: 'shared',
    factoryModels: [],
    updateModels: [],
    disposals: 0,
  }
  const menu = createThreeWristMenuState({
    renderer: fixture.renderer,
    snapshot: controllerActionSnapshot,
    onEvent: (event) => events.push(event),
    presentationFactory: createFixturePresentationFactory(log),
  })

  assert.equal(log.factoryModels.length, 1)
  assert.ok(Object.isFrozen(log.factoryModels[0]))
  assert.deepEqual(log.factoryModels[0].theme, defaultThemeTokens)
  assert.equal(
    menu.presentation.group.children[0]?.name,
    'custom-presentation-shared',
  )

  updateThreeWristMenu(menu, { time: 16, frame: fixture.frame })
  updateThreeWristMenu(menu, { time: 32, frame: fixture.frame })
  fixture.session.dispatch('selectstart', fixture.selectionSource)
  updateThreeWristMenu(menu, { time: 48, frame: fixture.frame })
  assert.equal(
    threeWristMenuBlocksSceneInput(menu, fixture.selectionSource),
    true,
  )
  fixture.session.dispatch('select', fixture.selectionSource)
  fixture.session.dispatch('selectend', fixture.selectionSource)
  updateThreeWristMenu(menu, { time: 64, frame: fixture.frame })

  assert.equal(
    events.filter(({ type }) => type === 'selection-intent').length,
    1,
  )
  disposeThreeWristMenu(menu)
  assert.equal(log.disposals, 1)
  assert.equal(menu.presentation.group.children.length, 0)
})

test('invalid custom Hit Region declarations are rejected and their resources are released', () => {
  const fixture = createWristXrFixture({ menuKind: 'controller' })
  let disposals = 0
  assert.throws(
    () =>
      createThreeWristMenuState({
        renderer: fixture.renderer,
        snapshot: controllerActionSnapshot,
        onEvent: () => undefined,
        presentationFactory() {
          const root = new Group()
          const panel = new Mesh(
            new BoxGeometry(0.192, 0.27, 0.004),
            new MeshBasicMaterial({ visible: false }),
          )
          const hit = new Mesh(
            new BoxGeometry(0.176, 0.02, 0.008),
            new MeshBasicMaterial({ visible: false }),
          )
          root.add(panel, hit)
          return {
            root,
            hitRegions: [{ itemId: 'not-in-the-model', object: hit }],
            scrollRegion: { object: panel },
            update() {},
            dispose() {
              disposals += 1
              panel.geometry.dispose()
              panel.material.dispose()
              hit.geometry.dispose()
              hit.material.dispose()
              root.clear()
            },
          }
        },
      }),
    /unknown Menu Item: not-in-the-model/,
  )
  assert.equal(disposals, 1)
})

test('a custom presentation scroll region drives the same continuous viewport state', () => {
  const fixture = createWristXrFixture({ menuKind: 'controller' })
  fixture.setWristMatrix(new Matrix4().makeRotationY(-Math.PI / 2))
  const observedOffsets = []
  const menu = createThreeWristMenuState({
    renderer: fixture.renderer,
    snapshot: reachScrollSnapshot,
    onEvent: () => undefined,
    presentationFactory(initialModel) {
      const root = new Group()
      const geometry = new BoxGeometry(0.192, 0.27, 0.004)
      const material = new MeshBasicMaterial({ visible: false })
      const panel = new Mesh(geometry, material)
      root.add(panel)
      observedOffsets.push(initialModel.scrollOffset)
      return {
        root,
        hitRegions: [],
        scrollRegion: { object: panel },
        update(model) {
          root.visible = model.visible
          observedOffsets.push(model.scrollOffset)
        },
        dispose() {
          geometry.dispose()
          material.dispose()
          root.clear()
        },
      }
    },
  })

  updateThreeWristMenu(menu, { time: 10, frame: fixture.frame })
  updateThreeWristMenu(menu, { time: 20, frame: fixture.frame })
  updateThreeWristMenu(menu, { time: 30, frame: fixture.frame })
  fixture.setTargetRayMatrix(
    new Matrix4().makeTranslation(0, -ROW_SPACING, 1),
  )
  updateThreeWristMenu(menu, { time: 40, frame: fixture.frame })

  assert.equal(observedOffsets.at(-1), 1)
  disposeThreeWristMenu(menu)
})

test('presentation replacement releases ownership, claims, and prior resources', () => {
  const fixture = createWristXrFixture({ menuKind: 'controller' })
  fixture.setWristMatrix(new Matrix4().makeRotationY(-Math.PI / 2))
  const first = {
    name: 'first',
    factoryModels: [],
    updateModels: [],
    disposals: 0,
  }
  const second = {
    name: 'second',
    factoryModels: [],
    updateModels: [],
    disposals: 0,
  }
  const menu = createThreeWristMenuState({
    renderer: fixture.renderer,
    snapshot: controllerActionSnapshot,
    onEvent: () => undefined,
    presentationFactory: createFixturePresentationFactory(first),
  })
  const stableAttachment = menu.presentation.group

  updateThreeWristMenu(menu, { time: 16, frame: fixture.frame })
  updateThreeWristMenu(menu, { time: 32, frame: fixture.frame })
  fixture.session.dispatch('selectstart', fixture.selectionSource)
  updateThreeWristMenu(menu, { time: 48, frame: fixture.frame })
  assert.equal(
    threeWristMenuBlocksSceneInput(menu, fixture.selectionSource),
    true,
  )

  replaceThreeWristMenuPresentation(
    menu,
    createFixturePresentationFactory(second),
  )

  assert.equal(menu.presentation.group, stableAttachment)
  assert.equal(first.disposals, 1)
  assert.equal(
    threeWristMenuBlocksSceneInput(menu, fixture.selectionSource),
    false,
  )
  assert.equal(menu.presentation.group.visible, false)
  assert.equal(
    menu.presentation.group.children[0]?.name,
    'custom-presentation-second',
  )

  disposeThreeWristMenu(menu)
  assert.equal(second.disposals, 1)
})

test('presentation replacement restarts automatic reveal with a fresh initial dwell', () => {
  const fixture = createWristXrFixture({ menuKind: 'hand' })
  const snapshot = {
    ...controllerActionSnapshot,
    activationMode: 'automatic',
    comfort: {
      initialDwellMs: 30,
      reacquireDwellMs: 20,
      transitionMs: 0,
    },
  }
  const first = {
    name: 'dwell-first',
    factoryModels: [],
    updateModels: [],
    disposals: 0,
  }
  const second = {
    name: 'dwell-second',
    factoryModels: [],
    updateModels: [],
    disposals: 0,
  }
  const menu = createThreeWristMenuState({
    renderer: fixture.renderer,
    snapshot,
    onEvent: () => undefined,
    presentationFactory: createFixturePresentationFactory(first),
  })

  updateThreeWristMenu(menu, { time: 0, frame: fixture.frame })
  updateThreeWristMenu(menu, { time: 30, frame: fixture.frame })
  assert.equal(menu.presentation.group.visible, true)

  replaceThreeWristMenuPresentation(
    menu,
    createFixturePresentationFactory(second),
  )
  assert.equal(menu.presentation.group.visible, false)
  updateThreeWristMenu(menu, { time: 40, frame: fixture.frame })
  updateThreeWristMenu(menu, { time: 69, frame: fixture.frame })
  assert.equal(menu.presentation.group.visible, false)
  updateThreeWristMenu(menu, { time: 70, frame: fixture.frame })
  assert.equal(menu.presentation.group.visible, true)

  disposeThreeWristMenu(menu)
})
