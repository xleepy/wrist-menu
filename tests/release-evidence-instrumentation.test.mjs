import assert from 'node:assert/strict'
import test from 'node:test'
import * as three from 'three'
import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  Texture,
} from 'three'

import {
  allocationDelta,
  inventoryThreeScene,
  listenerInventory,
  sampleThreeAllocationOrdinals,
} from '../fixtures/consumers/runtime-evidence.mjs'
import { verifyImportSafety } from '../fixtures/consumers/import-safety.mjs'
import * as core from '../dist/core/index.js'
import {
  assertCompleteJourneyCoverage,
  runCandidateJourneyCoverage,
} from '../fixtures/consumers/journey-evidence.mjs'

test('Three allocation evidence observes transient resource construction by ordinal', () => {
  const before = sampleThreeAllocationOrdinals(three)
  const object = new Group()
  const geometry = new BufferGeometry()
  const material = new MeshBasicMaterial()
  const texture = new Texture()
  const after = sampleThreeAllocationOrdinals(three)

  assert.deepEqual(allocationDelta(before, after), {
    objects: 1,
    geometries: 1,
    materials: 1,
    textures: 1,
  })

  object.clear()
  geometry.dispose()
  material.dispose()
  texture.dispose()
})

test('scene inventory derives lines, program signatures, uploads, and identities', () => {
  const root = new Group()
  const meshGeometry = new BufferGeometry()
  meshGeometry.setAttribute(
    'position',
    new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
  )
  const meshMaterial = new MeshBasicMaterial({ map: new Texture() })
  meshMaterial.map.image = { width: 2, height: 3 }
  meshMaterial.map.needsUpdate = true
  const lineGeometry = new BufferGeometry()
  lineGeometry.setAttribute(
    'position',
    new Float32BufferAttribute([0, 0, 0, 1, 1, 0], 3),
  )
  const lineMaterial = new LineBasicMaterial()
  root.add(
    new Mesh(meshGeometry, meshMaterial),
    new Line(lineGeometry, lineMaterial),
  )

  const inventory = inventoryThreeScene(root)
  assert.equal(inventory.counts.objects, 3)
  assert.equal(inventory.counts.geometries, 2)
  assert.equal(inventory.counts.materials, 2)
  assert.equal(inventory.counts.textures, 1)
  assert.equal(inventory.counts.lines, 1)
  assert.equal(inventory.counts.programSignatures, 2)
  assert.equal(inventory.counts.textureUploadVersions, 1)
  assert.equal(inventory.counts.textureBytes, 24)

  meshGeometry.dispose()
  meshMaterial.map.dispose()
  meshMaterial.dispose()
  lineGeometry.dispose()
  lineMaterial.dispose()
})

test('listener inventory records every listener type instead of only a total', () => {
  const source = {
    listeners: new Map([
      ['select', new Set([() => undefined, () => undefined])],
      ['end', new Set([() => undefined])],
    ]),
  }

  assert.deepEqual(listenerInventory(source), {
    total: 3,
    byType: { end: 1, select: 2 },
  })
})

test('import evidence fails closed with observed resources, listeners, and render-loop access', async () => {
  const probeName = '__wristMenuUnsafeImportProbe'
  globalThis[probeName] = () => {
    new Group()
    new BufferGeometry()
    new MeshBasicMaterial()
    new Texture()
    new EventTarget().addEventListener('unsafe-import-listener', () => undefined)
    globalThis.requestAnimationFrame(() => undefined)
  }
  const source = `globalThis.${probeName}(); export const loaded = true`
  const entry = `data:text/javascript,${encodeURIComponent(source)}`

  try {
    const report = await verifyImportSafety({
      entries: [entry],
      reportFile: 'unused.json',
      three,
      throwOnFailure: false,
    })

    assert.equal(report.status, 'failed')
    assert.deepEqual(report.sideEffects.threeResourceAllocations, {
      objects: 1,
      geometries: 1,
      materials: 1,
      textures: 1,
    })
    assert.equal(report.sideEffects.listeners.added, 1)
    assert.deepEqual(report.sideEffects.hostileGlobalReads, [
      'requestAnimationFrame',
    ])
    assert.match(report.importErrors[0].message, /requestAnimationFrame/)
    assert.deepEqual(report.sideEffects.forbiddenEffectCounters, {
      rendererAndThreeResources: 4,
      listenersAndSubscriptions: 1,
      iwerOrXrInstallation: 0,
      xrSessionRequestsOrEnds: 0,
      renderLoops: 1,
    })
  } finally {
    delete globalThis[probeName]
  }
})

for (const sourceKind of ['hand', 'controller']) {
  test(`candidate ${sourceKind} journey evidence dynamically covers the release matrix`, () => {
    const coverage = runCandidateJourneyCoverage({ core, sourceKind })

    assert.equal(coverage.status, 'passed')
    assertCompleteJourneyCoverage(coverage)
    assert.deepEqual(
      coverage.semanticCases.map(({ id }) => id),
      [
        'both-wrists',
        'scrolling',
        'invalid-disabled',
        'tracking-loss',
        'input-switching',
        'visibility-session-reentry',
        'empty-unavailable',
      ],
    )
    assert.deepEqual(
      coverage.sceneEventShield.cases.map(({ id }) => id),
      ['commit', 'cancel', 'hold', 'leave-before-release', 'rapid-actions'],
    )
  })
}
