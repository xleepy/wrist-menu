import assert from 'node:assert/strict'
import test from 'node:test'

import { defaultThemeTokens, VISIBLE_SLOTS } from '../dist/core/index.js'
import { defaultThreeWristMenuPresentationFactory } from '../dist/three/index.js'
import {
  evaluateConstructionInvariants,
  identityGrowth,
  inventoryThreeScene,
} from '../fixtures/consumers/runtime-evidence.mjs'
import performanceBaseline from '../evidence/baselines/performance-v1.json' with { type: 'json' }

function action(index, overrides = {}) {
  return {
    type: 'action',
    id: `action-${index}`,
    label: `Action ${index}`,
    disabled: false,
    interaction: 'idle',
    ...overrides,
  }
}

function presentationModel(overrides = {}) {
  const items = [
    action(0, { iconKey: 'add' }),
    {
      type: 'toggle',
      id: 'toggle-grid',
      label: 'Show grid',
      iconKey: 'grid',
      value: true,
      selected: true,
      disabled: false,
      interaction: 'idle',
    },
    {
      type: 'separator',
      id: 'separator-scene',
      label: 'Scene',
    },
    action(3, {
      disabled: true,
      disabledReason: 'Select an object first',
    }),
    ...Array.from({ length: 14 }, (_, index) => action(index + 4)),
  ]
  return {
    visible: true,
    targetable: true,
    opacity: 1,
    revealPhase: 'visible',
    anchorPose: { position: [0, 0, 0], orientation: [0, 0, 0, 1] },
    revision: 1,
    items,
    scrollOffset: 0,
    totalRows: items.length,
    visibleSlots: VISIBLE_SLOTS,
    scrollBarrierActive: false,
    theme: defaultThemeTokens,
    ...overrides,
  }
}

function atlasTexture(root) {
  const textures = new Set()
  root.traverse((object) => {
    const materials = Array.isArray(object.material)
      ? object.material
      : object.material === undefined
        ? []
        : [object.material]
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value?.isTexture === true) textures.add(value)
      }
    }
  })
  assert.equal(textures.size, 1)
  return [...textures][0]
}

function physicalSize(mesh) {
  return {
    width: mesh.geometry.parameters.width * mesh.scale.x,
    height: mesh.geometry.parameters.height * mesh.scale.y,
  }
}

function atlasAspect(mesh) {
  const uvs = mesh.geometry.getAttribute('uv').array
  const u = []
  const v = []
  for (let index = 0; index < uvs.length; index += 2) {
    u.push(uvs[index])
    v.push(uvs[index + 1])
  }
  return (
    ((Math.max(...u) - Math.min(...u)) * 1024) /
    ((Math.max(...v) - Math.min(...v)) * 2048)
  )
}

function approximately(actual, expected, tolerance = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  )
}

test('the default presentation passes the atlas construction Release Gate', () => {
  const presentation = defaultThreeWristMenuPresentationFactory(
    presentationModel(),
  )
  const inventory = inventoryThreeScene(presentation.root)

  const gate = evaluateConstructionInvariants(
    inventory,
    performanceBaseline.construction,
  )
  assert.equal(gate.status, 'passed')
  assert.deepEqual(gate.failures, [])
  assert.equal(inventory.counts.poolSlots, VISIBLE_SLOTS)

  const texture = atlasTexture(presentation.root)
  let disposals = 0
  texture.addEventListener('dispose', () => {
    disposals += 1
  })
  presentation.dispose()
  assert.equal(disposals, 1)
})

test('the default atlas records every text and non-color state role at readable contrast', () => {
  const presentation = defaultThreeWristMenuPresentationFactory(
    presentationModel(),
  )
  const atlas = atlasTexture(presentation.root).userData.wristMenuAtlas

  assert.equal(atlas.fontFamily, 'WristMenuInter')
  assert.equal(atlas.fontSource, 'embedded-inter-woff2')
  assert.deepEqual(Object.keys(atlas.roles).sort(), [
    'disabled',
    'footer',
    'primary',
    'secondary',
    'selected',
    'separator',
  ])
  for (const role of Object.values(atlas.roles)) {
    assert.ok(role.contrast >= 4.5, `${role.name}: ${role.contrast}`)
  }
  assert.deepEqual([...atlas.nonColorStateCues].sort(), [
    'disabled-label-and-slash',
    'selected-label-and-check',
  ])

  const visualRows = presentation.root.children.filter(({ name }) =>
    name.includes('-visual:'),
  )
  assert.ok(visualRows.length > 0 && visualRows.length <= VISIBLE_SLOTS)
  assert.ok(
    visualRows.some(
      ({ userData }) => userData.wristMenuAtlasStateCue === 'selected',
    ),
  )
  assert.ok(
    visualRows.some(
      ({ userData }) => userData.wristMenuAtlasStateCue === 'disabled',
    ),
  )

  presentation.dispose()
})

test('the default presentation ships the accepted Reach geometry without stretching atlas slices', () => {
  const presentation = defaultThreeWristMenuPresentationFactory(
    presentationModel(),
  )
  const panel = presentation.root.getObjectByName('wrist-menu-command-slab')
  const viewport = presentation.menuViewport.object
  const action = presentation.root.getObjectByName(
    'wrist-menu-action-visual:action-0',
  )
  const toggle = presentation.root.getObjectByName(
    'wrist-menu-toggle-visual:toggle-grid',
  )
  const separator = presentation.root.getObjectByName(
    'wrist-menu-separator-visual:separator-scene',
  )
  const footer = presentation.root.getObjectByName('wrist-menu-footer-atlas')

  assert.deepEqual(physicalSize(panel), { width: 0.192, height: 0.158 })
  assert.deepEqual(physicalSize(viewport), { width: 0.176, height: 0.108 })
  assert.deepEqual(physicalSize(action), { width: 0.176, height: 0.02 })
  assert.deepEqual(physicalSize(separator), { width: 0.176, height: 0.009 })
  assert.deepEqual(physicalSize(footer), { width: 0.176, height: 0.0065 })
  approximately(action.position.y - toggle.position.y, 0.0225)
  approximately(
    toggle.position.y - 0.01 - (separator.position.y + 0.0045),
    0.0025,
  )
  approximately(atlasAspect(action), 0.176 / 0.02, 1e-4)
  approximately(atlasAspect(separator), 0.176 / 0.009, 1e-4)
  approximately(atlasAspect(footer), 0.176 / 0.0065, 1e-4)

  presentation.dispose()
})

test('theme-resized presentation quads retain matching atlas aspect ratios', () => {
  const presentation = defaultThreeWristMenuPresentationFactory(
    presentationModel({
      theme: {
        ...defaultThemeTokens,
        panelWidthMeters: 0.24,
        viewportHeightMeters: 0.3,
      },
    }),
  )
  const action = presentation.root.getObjectByName(
    'wrist-menu-action-visual:action-0',
  )
  const separator = presentation.root.getObjectByName(
    'wrist-menu-separator-visual:separator-scene',
  )
  const footer = presentation.root.getObjectByName('wrist-menu-footer-atlas')

  for (const mesh of [action, separator, footer]) {
    const size = physicalSize(mesh)
    approximately(atlasAspect(mesh), size.width / size.height, 1e-4)
  }
  presentation.dispose()
})

test('continuous scrolling only rebinds the fixed visual pool', () => {
  const initial = presentationModel()
  const presentation = defaultThreeWristMenuPresentationFactory(initial)
  const before = inventoryThreeScene(presentation.root)
  const atlas = atlasTexture(presentation.root)
  const uploadVersion = atlas.version
  const pool = presentation.root.children.filter(({ userData }) =>
    Object.hasOwn(userData, 'wristMenuPoolSlot'),
  )

  presentation.update({ ...initial, scrollOffset: 1.5 })
  presentation.update({ ...initial, scrollOffset: 3.25 })

  const after = inventoryThreeScene(presentation.root)
  assert.equal(atlas.version, uploadVersion)
  assert.deepEqual(identityGrowth(before, after), {
    objects: { added: 0, removed: 0, net: 0 },
    geometries: { added: 0, removed: 0, net: 0 },
    materials: { added: 0, removed: 0, net: 0 },
    textures: { added: 0, removed: 0, net: 0 },
    poolSlots: { added: 0, removed: 0, net: 0 },
    programSignatures: { added: 0, removed: 0, net: 0 },
  })
  assert.equal(pool.length, VISIBLE_SLOTS * 2)
  assert.equal(
    presentation.root.children.filter(({ name }) => name.includes('-visual:'))
      .length <= VISIBLE_SLOTS,
    true,
  )

  presentation.dispose()
})

test('one changed-scroll update mutates every bound UV buffer at most once', () => {
  const initial = presentationModel()
  const presentation = defaultThreeWristMenuPresentationFactory(initial)
  const rows = presentation.root.children.filter(
    ({ material, userData }) =>
      material?.map?.isTexture === true &&
      Object.hasOwn(userData, 'wristMenuPoolSlot'),
  )
  const before = rows.map(({ geometry }) => geometry.getAttribute('uv').version)

  presentation.update({ ...initial, scrollOffset: 1.5 })

  const mutations = rows.map(
    ({ geometry }, index) =>
      geometry.getAttribute('uv').version - before[index],
  )
  assert.equal(rows.length, VISIBLE_SLOTS)
  assert.ok(mutations.some((count) => count === 1))
  assert.ok(mutations.every((count) => count === 0 || count === 1))
  presentation.dispose()
})

test('a Host Snapshot redraw updates atlas content and structural bindings once', () => {
  const initial = presentationModel()
  const presentation = defaultThreeWristMenuPresentationFactory(initial)
  const atlas = atlasTexture(presentation.root)
  const footer = presentation.root.getObjectByName('wrist-menu-footer-atlas')
  const beforeFooterUvs = Array.from(footer.geometry.getAttribute('uv').array)
  const beforeVersion = atlas.version
  const items = [action(0)]

  presentation.update({
    ...initial,
    revision: initial.revision + 1,
    items,
    totalRows: items.length,
  })

  assert.equal(atlas.version, beforeVersion + 1)
  assert.notDeepEqual(
    Array.from(footer.geometry.getAttribute('uv').array),
    beforeFooterUvs,
  )
  presentation.dispose()
})

test('browser construction installs the embedded Inter 400 and 600 binaries without requests', () => {
  const previousDocument = globalThis.document
  const previousFontFace = globalThis.FontFace
  const faces = []
  class ObservedFontFace {
    constructor(family, source, descriptors) {
      this.family = family
      this.bytes = source.byteLength
      this.weight = descriptors.weight
    }
  }
  globalThis.FontFace = ObservedFontFace
  globalThis.document = {
    fonts: { add: (face) => faces.push(face) },
    createElement: () => ({ width: 0, height: 0 }),
  }

  try {
    const presentation = defaultThreeWristMenuPresentationFactory(
      presentationModel(),
    )
    assert.deepEqual(
      faces.map(({ family, bytes, weight }) => ({ family, bytes, weight })),
      [
        { family: 'WristMenuInter', bytes: 23664, weight: '400' },
        { family: 'WristMenuInter', bytes: 24452, weight: '600' },
      ],
    )
    presentation.dispose()
  } finally {
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
    if (previousFontFace === undefined) delete globalThis.FontFace
    else globalThis.FontFace = previousFontFace
  }
})
