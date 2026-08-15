import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BoxGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from 'three'

import { defaultThemeTokens, VISIBLE_SLOTS } from '../dist/core/index.js'
import {
  createThreeWristMenuState,
  defaultThreeWristMenuPresentationFactory,
  disposeThreeWristMenu,
  replaceThreeWristMenuPresentation,
  threeWristMenuBlocksSceneInput,
  updateThreeWristMenu,
} from '../dist/three/index.js'
import { controllerActionSnapshot } from '../fixtures/controller-action.mjs'
import {
  reachScrollSnapshot,
  ROW_SPACING,
} from '../fixtures/reach-scroll.mjs'
import { createEquivalentPresentationFactory } from '../fixtures/presentation-factory.mjs'
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
    scrollOwned: false,
    scrollBarrierActive: false,
    theme: defaultThemeTokens,
    ...overrides,
  }
}

test('resolved theme tokens restyle and resize the default Command slab', () => {
  const theme = {
    ...defaultThemeTokens,
    panelWidthMeters: 0.24,
    viewportHeightMeters: 0.3,
    panelColor: 0x010203,
    hoveredItemColor: 0xabcdef,
  }

  const presentation = defaultThreeWristMenuPresentationFactory(
    presentationModel({ theme }),
  )
  const panel = presentation.menuViewport.object.parent.getObjectByName(
    'wrist-menu-command-slab',
  )

  assert.equal(panel.material.color.getHex(), 0x010203)
  assert.equal(
    panel.scale.x,
    theme.panelWidthMeters / defaultThemeTokens.panelWidthMeters,
  )
  assert.equal(
    panel.scale.y,
    theme.viewportHeightMeters / defaultThemeTokens.viewportHeightMeters,
  )
  const row = presentation.root.children.find(
    ({ name }) => name === 'wrist-menu-action-visual:spawn',
  )
  assert.equal(row.material.color.getHex(), 0xffffff)
  assert.equal(
    row.material.map.userData.wristMenuAtlas.roles.hovered.background,
    0xabcdef,
  )

  presentation.dispose()
})

test('shared oriented-box targeting preserves world-meter semantics under presentation scale', () => {
  let hit
  let viewport
  const menu = createThreeWristMenuState({
    renderer: {
      xr: {
        getSession: () => null,
        getReferenceSpace: () => null,
      },
    },
    snapshot: controllerActionSnapshot,
    onEvent: () => undefined,
    presentationFactory: () => {
      const root = new Group()
      root.scale.set(2, 0.5, 3)
      viewport = new Mesh(
        new BoxGeometry(0.192, 0.27, 0.004),
        new MeshBasicMaterial({ visible: false }),
      )
      hit = new Mesh(
        new BoxGeometry(0.176, 0.02, 0.008),
        new MeshBasicMaterial({ visible: false }),
      )
      root.add(viewport, hit)
      return {
        root,
        hitRegions: [{ itemId: 'spawn-cube', object: hit }],
        menuViewport: { object: viewport },
        update() {},
        dispose() {
          viewport.geometry.dispose()
          viewport.material.dispose()
          hit.geometry.dispose()
          hit.material.dispose()
        },
      }
    },
  })

  const pressedPoint = hit.localToWorld(
    new Vector3(0, 0, hit.geometry.parameters.depth / 2 + 0.005 / 3),
  )
  assert.equal(
    menu.presentation.fingertipObservation(pressedPoint, 0.005)?.phase,
    'pressed',
  )
  const panelPoint = viewport.localToWorld(new Vector3(0, 0.1, 0))
  assert.ok(Math.abs(menu.presentation.panelLocalY(panelPoint) - 0.05) < 1e-9)

  disposeThreeWristMenu(menu)
})

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
    presentationFactory: createEquivalentPresentationFactory(log),
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
            menuViewport: { object: panel },
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

test('a custom Menu Viewport drives the same continuous scroll state', () => {
  const fixture = createWristXrFixture({ menuKind: 'controller' })
  fixture.setWristMatrix(new Matrix4().makeRotationY(-Math.PI / 2))
  const observedOffsets = []
  const observedOwnership = []
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
      observedOwnership.push(initialModel.scrollOwned)
      return {
        root,
        hitRegions: [],
        menuViewport: { object: panel },
        update(model) {
          root.visible = model.visible
          observedOffsets.push(model.scrollOffset)
          observedOwnership.push(model.scrollOwned)
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
  assert.equal(observedOwnership.at(-1), true)
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
    presentationFactory: createEquivalentPresentationFactory(first),
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
    createEquivalentPresentationFactory(second),
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

for (const presentationKind of ['default', 'custom']) {
  test(`replacing the ${presentationKind} presentation during active Scroll Ownership starts the replacement from neutral`, () => {
    const fixture = createWristXrFixture({ menuKind: 'controller' })
    fixture.setWristMatrix(new Matrix4().makeRotationY(-Math.PI / 2))
    const current = { name: `scroll-current-${presentationKind}` }
    const replacement = { name: `scroll-next-${presentationKind}` }
    const currentFactory =
      presentationKind === 'custom'
        ? createEquivalentPresentationFactory(current)
        : undefined
    const replacementFactory =
      presentationKind === 'custom'
        ? defaultThreeWristMenuPresentationFactory
        : createEquivalentPresentationFactory(replacement)
    const menu = createThreeWristMenuState({
      renderer: fixture.renderer,
      snapshot: reachScrollSnapshot,
      onEvent: () => undefined,
      presentationFactory: currentFactory,
    })
    const currentGapY = presentationKind === 'default' ? 0.01775 : 0
    fixture.setTargetRayMatrix(
      new Matrix4().makeTranslation(0, currentGapY, 1),
    )

    updateThreeWristMenu(menu, { time: 10, frame: fixture.frame })
    updateThreeWristMenu(menu, { time: 20, frame: fixture.frame })
    updateThreeWristMenu(menu, { time: 30, frame: fixture.frame })
    fixture.setTargetRayMatrix(
      new Matrix4().makeTranslation(0, currentGapY - ROW_SPACING, 1),
    )
    updateThreeWristMenu(menu, { time: 40, frame: fixture.frame })
    assert.notEqual(menu.runtime.scrollState.ownerSourceId, null)
    assert.ok(Math.abs(menu.runtime.scrollState.offset - 1) < 1e-9)
    const previousRoot = menu.presentation.group.children[0]

    replaceThreeWristMenuPresentation(menu, replacementFactory)

    assert.equal(previousRoot.parent, null)
    assert.equal(menu.runtime.scrollState.ownerSourceId, null)
    assert.equal(menu.runtime.scrollState.offset, 0)
    assert.equal(menu.presentation.group.visible, false)
    if (presentationKind === 'custom') {
      assert.equal(current.disposals, 1)
    } else {
      assert.equal(replacement.factoryModels[0].scrollOffset, 0)
    }

    const replacementGapY = presentationKind === 'default' ? 0 : 0.01775
    fixture.setTargetRayMatrix(
      new Matrix4().makeTranslation(0, replacementGapY, 1),
    )
    updateThreeWristMenu(menu, { time: 50, frame: fixture.frame })
    updateThreeWristMenu(menu, { time: 60, frame: fixture.frame })
    fixture.setTargetRayMatrix(
      new Matrix4().makeTranslation(
        0,
        replacementGapY - ROW_SPACING,
        1,
      ),
    )
    updateThreeWristMenu(menu, { time: 70, frame: fixture.frame })
    fixture.setTargetRayMatrix(
      new Matrix4().makeTranslation(
        0,
        replacementGapY - 2 * ROW_SPACING,
        1,
      ),
    )
    updateThreeWristMenu(menu, { time: 80, frame: fixture.frame })
    assert.ok(Math.abs(menu.runtime.scrollState.offset - 1) < 1e-9)

    disposeThreeWristMenu(menu)
    if (presentationKind === 'default') {
      assert.equal(replacement.disposals, 1)
    }
  })
}

function invalidReplacementFactory(log) {
  return () => {
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
      hitRegions: [{ itemId: 'unknown-item', object: hit }],
      menuViewport: { object: panel },
      update() {},
      dispose() {
        log.disposals += 1
        panel.geometry.dispose()
        panel.material.dispose()
        hit.geometry.dispose()
        hit.material.dispose()
        root.clear()
      },
    }
  }
}

function throwingUpdateFactory(log) {
  const createBase = createEquivalentPresentationFactory(log)
  return (model) => {
    const base = createBase(model)
    return {
      root: base.root,
      get hitRegions() {
        return base.hitRegions
      },
      menuViewport: base.menuViewport,
      update() {
        throw new Error('initial update failed')
      },
      dispose: () => base.dispose(),
    }
  }
}

for (const failure of [
  {
    label: 'factory creation',
    expected: /factory failed/,
    create() {
      return () => {
        throw new Error('factory failed')
      }
    },
    expectedDisposals: 0,
  },
  {
    label: 'declaration validation',
    expected: /unknown Menu Item: unknown-item/,
    create: invalidReplacementFactory,
    expectedDisposals: 1,
  },
  {
    label: 'initial update',
    expected: /initial update failed/,
    create: throwingUpdateFactory,
    expectedDisposals: 1,
  },
]) {
  test(`failed replacement during ${failure.label} leaves the current presentation and interaction untouched`, () => {
    const fixture = createWristXrFixture({ menuKind: 'controller' })
    fixture.setWristMatrix(new Matrix4().makeRotationY(-Math.PI / 2))
    const events = []
    const current = { name: 'current' }
    const failed = { name: 'failed', disposals: 0 }
    const menu = createThreeWristMenuState({
      renderer: fixture.renderer,
      snapshot: controllerActionSnapshot,
      onEvent: (event) => events.push(event),
      presentationFactory: createEquivalentPresentationFactory(current),
    })
    updateThreeWristMenu(menu, { time: 16, frame: fixture.frame })
    updateThreeWristMenu(menu, { time: 32, frame: fixture.frame })
    fixture.session.dispatch('selectstart', fixture.selectionSource)
    updateThreeWristMenu(menu, { time: 48, frame: fixture.frame })
    assert.equal(
      threeWristMenuBlocksSceneInput(menu, fixture.selectionSource),
      true,
    )
    const attachmentRoot = menu.presentation.group
    const currentRoot = attachmentRoot.children[0]

    assert.throws(
      () => replaceThreeWristMenuPresentation(menu, failure.create(failed)),
      failure.expected,
    )

    assert.equal(failed.disposals, failure.expectedDisposals)
    assert.equal(menu.presentation.group, attachmentRoot)
    assert.equal(menu.presentation.group.children[0], currentRoot)
    assert.equal(menu.presentation.group.visible, true)
    assert.equal(current.disposals, 0)
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
  })
}

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
    presentationFactory: createEquivalentPresentationFactory(first),
  })

  updateThreeWristMenu(menu, { time: 0, frame: fixture.frame })
  updateThreeWristMenu(menu, { time: 30, frame: fixture.frame })
  assert.equal(menu.presentation.group.visible, true)

  replaceThreeWristMenuPresentation(
    menu,
    createEquivalentPresentationFactory(second),
  )
  assert.equal(menu.presentation.group.visible, false)
  updateThreeWristMenu(menu, { time: 40, frame: fixture.frame })
  updateThreeWristMenu(menu, { time: 69, frame: fixture.frame })
  assert.equal(menu.presentation.group.visible, false)
  updateThreeWristMenu(menu, { time: 70, frame: fixture.frame })
  assert.equal(menu.presentation.group.visible, true)

  disposeThreeWristMenu(menu)
})
