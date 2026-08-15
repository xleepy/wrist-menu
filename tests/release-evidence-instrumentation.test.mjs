import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  appendFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
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
  evaluateConstructionInvariants,
  inventoryThreeScene,
  listenerInventory,
  sampleThreeAllocationOrdinals,
} from '../fixtures/consumers/runtime-evidence.mjs'
import { verifyImportSafety } from '../fixtures/consumers/import-safety.mjs'
import {
  runRendererJourneyEvidence,
  verifyRendererJourneyEvidence,
} from '../fixtures/consumers/journey-evidence.mjs'
import {
  evaluateAutomatedReleaseGates,
  finalizeAutomatedReleaseEvidence,
} from '../scripts/release-gate-evaluation.mjs'
import {
  EXACT_ALLOCATION_COVERAGE_PROTOCOL,
  EXACT_ALLOCATION_INSTRUMENTATION,
  EXACT_ALLOCATION_MARKER_FILENAME,
  EXACT_ALLOCATION_RUNTIME_PROTOCOL,
  prepareExactPackageAllocationEvidence,
} from '../fixtures/consumers/exact-allocation-evidence.mjs'
import { instrumentExactPackageAllocations } from '../scripts/instrument-exact-allocations.mjs'
import { reachScrollSnapshot } from '../fixtures/reach-scroll.mjs'
import { createWristXrFixture } from '../fixtures/wrist-reveal-xr.mjs'

const semanticCaseIds = [
  'fresh-reveal-hide-dwell',
  'both-wrists',
  'scrolling',
  'invalid-disabled',
  'tracking-loss',
  'input-switching',
  'visibility-session-reentry',
  'empty-unavailable',
]
const sceneActionTypes = [
  'pointerdown',
  'pointerup',
  'click',
  'dblclick',
  'contextmenu',
]
const terminalEventsByShieldCase = {
  commit: ['selection-intent'],
  cancel: ['selection-cancellation'],
  hold: ['selection-intent'],
  'leave-before-release': ['selection-cancellation'],
  'rapid-actions': ['selection-intent', 'selection-intent'],
}

const fileSha256 = (path) =>
  createHash('sha256').update(readFileSync(path)).digest('hex')

test('the Node allocation lane classifies every exact and guarded-unsupported construct', async () => {
  const temporaryRoot = mkdtempSync(resolve(tmpdir(), 'wrist-menu-exact-allocation-'))
  const packageRoot = resolve(temporaryRoot, 'package')
  const dist = resolve(packageRoot, 'dist')
  try {
    mkdirSync(dist, { recursive: true })
    cpSync(
      new URL(
        '../fixtures/consumers/exact-allocation-probe-package.mjs',
        import.meta.url,
      ),
      resolve(dist, 'probe.js'),
    )
    const marker = await instrumentExactPackageAllocations(packageRoot)
    const markerPath = resolve(packageRoot, EXACT_ALLOCATION_MARKER_FILENAME)
    const trustedMarkerSha256 = fileSha256(markerPath)
    assert.deepEqual(
      marker.coverage.exactKinds,
      EXACT_ALLOCATION_COVERAGE_PROTOCOL.exactKinds,
    )
    assert.deepEqual(
      marker.coverage.unsupportedKinds,
      EXACT_ALLOCATION_COVERAGE_PROTOCOL.unsupportedKinds,
    )
    assert.deepEqual(
      marker.coverage.allocationFreeKinds,
      EXACT_ALLOCATION_COVERAGE_PROTOCOL.allocationFreeKinds,
    )
    assert.equal(
      marker.coverage.callExpressionCount,
      marker.coverage.callDescriptorCount,
    )
    assert.equal(
      marker.coverage.newExpressionCount,
      marker.coverage.newDescriptorCount,
    )
    assert.ok(marker.coverage.callExpressionCount > 0)
    assert.ok(marker.coverage.newExpressionCount > 0)
    assert.equal(
      marker.sites.filter((site) => site.nodeKind === 'CallExpression').length,
      marker.coverage.callExpressionCount,
    )
    assert.equal(
      marker.sites.filter((site) => site.nodeKind === 'NewExpression').length,
      marker.coverage.newExpressionCount,
    )
    for (const site of marker.sites.filter(
      ({ nodeKind }) => nodeKind === 'CallExpression' || nodeKind === 'NewExpression',
    )) {
      assert.ok(
        ['exact', 'allocation-free', 'unsupported'].includes(site.classification),
      )
      assert.equal(typeof site.descriptorId, 'string')
      assert.ok(site.descriptorId.length > 0)
      assert.equal(typeof site.identity, 'string')
      assert.ok(site.identity.length > 0)
      assert.equal(typeof site.reason, 'string')
      assert.ok(site.reason.length > 0)
    }
    for (const kind of EXACT_ALLOCATION_COVERAGE_PROTOCOL.exactKinds) {
      assert.ok(
        marker.sites.some(
          (site) => site.classification === 'exact' && site.kind === kind,
        ),
        `missing exact positive control: ${kind}`,
      )
    }
    for (const kind of EXACT_ALLOCATION_COVERAGE_PROTOCOL.unsupportedKinds) {
      assert.ok(
        marker.sites.some(
          (site) => site.classification === 'unsupported' && site.kind === kind,
        ),
        `missing unsupported negative control: ${kind}`,
      )
    }
    for (const kind of EXACT_ALLOCATION_COVERAGE_PROTOCOL.allocationFreeKinds) {
      assert.ok(
        marker.sites.some(
          (site) =>
            site.classification === 'allocation-free' && site.kind === kind,
        ),
        `missing allocation-free positive control: ${kind}`,
      )
    }
    const missingTrust = await prepareExactPackageAllocationEvidence(packageRoot)
    assert.equal(missingTrust.status, 'unavailable')
    assert.match(missingTrust.report.reason, /trusted.*digest is unavailable/)
    const evidence = await prepareExactPackageAllocationEvidence(
      packageRoot,
      trustedMarkerSha256,
    )
    assert.equal(evidence.status, 'available')
    const probe = await import(pathToFileURL(resolve(packageRoot, 'dist', 'probe.js')).href)
    for (let index = 0; index < 20_000; index += 1) {
      probe.exerciseExactAllocations()
    }
    evidence.begin()
    assert.equal(probe.exerciseExactAllocations(), 8)
    const exact = evidence.finish()
    assert.equal(exact.status, 'available')
    assert.deepEqual(exact.instrumentation, EXACT_ALLOCATION_INSTRUMENTATION)
    assert.deepEqual(exact.coverage, marker.coverage)
    assert.equal(exact.observedPackageObjectAllocations, 16)
    for (const kind of EXACT_ALLOCATION_COVERAGE_PROTOCOL.exactKinds) {
      assert.ok(
        exact.sites.some((site) => site.kind === kind),
        `exact category did not execute: ${kind}`,
      )
    }
    assert.equal(
      exact.sites.reduce(
        (total, site) => total + site.observedAllocations,
        0,
      ),
      16,
    )

    evidence.begin()
    assert.equal(probe.exerciseAllocationFreeCall(), 1)
    const allocationFree = evidence.finish()
    assert.equal(allocationFree.status, 'available')
    assert.equal(allocationFree.observedPackageObjectAllocations, 0)

    const unsupportedControls = [
      ['rest-array', () => probe.unsupportedRestArray(1)],
      ['destructuring-iteration', () => probe.unsupportedArrayDestructuring([1])],
      ['destructuring-assignment', () => probe.unsupportedDestructuringAssignment([1])],
      ['object-rest', () => probe.unsupportedObjectRest({ retained: 1 })],
      ['spread-iteration', () => probe.unsupportedSpreadIteration([1])],
      ['object-spread', () => probe.unsupportedObjectSpread({ retained: 1 })],
      ['for-of-iteration', () => probe.unsupportedForOf([1])],
      ['call-expression', () => probe.unsupportedExplicitIterator([1])],
      ['new-expression', () => probe.unsupportedIterableConstructor([1])],
      ['call-expression', () =>
        probe.unsupportedIteratorNext([1][Symbol.iterator]())],
      ['async-path', () => probe.unsupportedAsyncPath()],
      ['generator-path', () => probe.unsupportedGeneratorPath()],
      ['call-expression', () => probe.unsupportedPromisePath()],
      ['call-expression', () => probe.unsupportedObjectEntries({ retained: 1 })],
      ['new-expression', () => probe.unsupportedDynamicFunctionConstructor()],
      ['call-expression', () => probe.unsupportedCallableObjectFactory()],
      ['call-expression', () => probe.unsupportedGlobalThisObjectFactory()],
      ['call-expression', () => probe.unsupportedGlobalThisArrayFactory()],
      ['call-expression', () => probe.unsupportedGlobalThisFunctionFactory()],
      ['call-expression', () => probe.unsupportedAliasedObjectFactory()],
      ['call-expression', () =>
        probe.unsupportedKnownCalleeOutsideProofScope()],
      ['call-expression', () => probe.unsupportedGetOwnPropertyNames({ retained: 1 })],
      ['call-expression', () => probe.unsupportedReflectOwnKeys({ retained: 1 })],
      ['new-expression', () => probe.unsupportedTypedArrayNew()],
      ['call-expression', () => probe.unsupportedTypedArraySubarray(new Uint8Array(1))],
      ['call-expression', () => probe.unsupportedTypedArrayFrom([1])],
      ['call-expression', () => probe.unsupportedUnknownPropertyCall({
        allocateMaybe() { return 1 },
      })],
      ['call-expression', () => probe.unsupportedMatchAll('allocation')],
      ['dynamic-import', () => probe.unsupportedDynamicImport()],
      ['tagged-template', () => probe.unsupportedTaggedTemplate()],
      ['arguments-object', () => probe.unsupportedArgumentsObject(1)],
    ]
    for (const [kind, invoke] of unsupportedControls) {
      evidence.begin()
      await invoke()
      const unsupported = evidence.finish()
      assert.equal(unsupported.status, 'unavailable', kind)
      assert.ok(
        unsupported.unsupportedSites.some((site) => site.kind === kind),
        kind,
      )
    }

    const globalObjectSite = marker.sites.find(
      (site) =>
        site.classification === 'unsupported' &&
        site.identity.endsWith(':globalThis.Object'),
    )
    assert.ok(globalObjectSite)
    const globalObjectFile = marker.files.find(
      ({ path }) => path === globalObjectSite.path,
    )
    assert.ok(globalObjectFile)
    const reclassifiedMarker = {
      ...marker,
      coverage: {
        ...marker.coverage,
        allocationFreeSiteCount: marker.coverage.allocationFreeSiteCount + 1,
        unsupportedSiteCount: marker.coverage.unsupportedSiteCount - 1,
      },
      files: marker.files.map((file) =>
        file.path === globalObjectFile.path
          ? {
              ...file,
              allocationFreeSiteCount: file.allocationFreeSiteCount + 1,
              unsupportedSiteCount: file.unsupportedSiteCount - 1,
            }
          : file,
      ),
      sites: marker.sites.map((site) =>
        site.id === globalObjectSite.id
          ? {
              ...site,
              classification: 'allocation-free',
              kind: 'call-expression',
              descriptorId: 'tampered.free.global-object',
              reason: 'tampered marker-only allocation-free claim',
            }
          : site,
      ),
    }
    writeFileSync(markerPath, `${JSON.stringify(reclassifiedMarker, null, 2)}\n`)
    const markerOnlyReclassification =
      await prepareExactPackageAllocationEvidence(
        packageRoot,
        trustedMarkerSha256,
      )
    assert.equal(markerOnlyReclassification.status, 'unavailable')
    assert.match(markerOnlyReclassification.report.reason, /marker digest changed/)
    const dispositionReclassification =
      await prepareExactPackageAllocationEvidence(
        packageRoot,
        fileSha256(markerPath),
      )
    assert.equal(dispositionReclassification.status, 'unavailable')
    assert.match(
      dispositionReclassification.report.reason,
      /runtime sentinel disposition changed/,
    )

    const globalObjectPath = resolve(packageRoot, globalObjectSite.path)
    const originalInstrumentedSource = readFileSync(globalObjectPath, 'utf8')
    const unsupportedSentinel =
      `${EXACT_ALLOCATION_RUNTIME_PROTOCOL.recorderName}(` +
      `"${EXACT_ALLOCATION_RUNTIME_PROTOCOL.unsupportedToken}", ` +
      `${globalObjectSite.id}, 0), `
    assert.ok(originalInstrumentedSource.includes(unsupportedSentinel))
    const coherentlyTamperedSource = originalInstrumentedSource.replace(
      unsupportedSentinel,
      '',
    )
    writeFileSync(globalObjectPath, coherentlyTamperedSource)
    const coherentMarker = {
      ...reclassifiedMarker,
      files: reclassifiedMarker.files.map((file) =>
        file.path === globalObjectSite.path
          ? {
              ...file,
              instrumentedSha256: fileSha256(globalObjectPath),
            }
          : file,
      ),
    }
    writeFileSync(markerPath, `${JSON.stringify(coherentMarker, null, 2)}\n`)
    const coherentMarkerCodeAndDigestTamper =
      await prepareExactPackageAllocationEvidence(
        packageRoot,
        trustedMarkerSha256,
      )
    assert.equal(coherentMarkerCodeAndDigestTamper.status, 'unavailable')
    assert.match(
      coherentMarkerCodeAndDigestTamper.report.reason,
      /marker digest changed/,
    )
    writeFileSync(globalObjectPath, originalInstrumentedSource)

    writeFileSync(markerPath, JSON.stringify({
      ...marker,
      coverage: { ...marker.coverage, status: 'partial' },
    }))
    const partialCoverage = await prepareExactPackageAllocationEvidence(
      packageRoot,
      fileSha256(markerPath),
    )
    assert.equal(partialCoverage.status, 'unavailable')
    assert.match(partialCoverage.report.reason, /incompatible identity or shape/)
    writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`)

    writeFileSync(markerPath, JSON.stringify({
      ...marker,
      coverage: {
        ...marker.coverage,
        callDescriptorCount: marker.coverage.callDescriptorCount - 1,
      },
    }))
    const incompleteInvocations = await prepareExactPackageAllocationEvidence(
      packageRoot,
      fileSha256(markerPath),
    )
    assert.equal(incompleteInvocations.status, 'unavailable')
    assert.match(
      incompleteInvocations.report.reason,
      /incompatible identity or shape/,
    )
    writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`)

    appendFileSync(resolve(packageRoot, 'dist', 'probe.js'), '\n')
    const tampered = await prepareExactPackageAllocationEvidence(
      packageRoot,
      trustedMarkerSha256,
    )
    assert.equal(tampered.status, 'unavailable')
    assert.match(tampered.report.reason, /instrumented package file digest changed/)

    rmSync(resolve(packageRoot, EXACT_ALLOCATION_MARKER_FILENAME))
    const missing = await prepareExactPackageAllocationEvidence(
      packageRoot,
      trustedMarkerSha256,
    )
    assert.equal(missing.status, 'unavailable')
    assert.match(missing.report.reason, /instrumented package manifest is unavailable/)
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
})

test('central Release Gate evaluation accepts only complete exact zero-allocation evidence', () => {
  const available = {
    instrumentation: EXACT_ALLOCATION_INSTRUMENTATION,
    status: 'available',
    frames: 10_000,
    observedPackageObjectAllocations: 0,
    sites: [],
    coverage: { status: 'complete' },
    markerSha256: 'f'.repeat(64),
  }
  const evaluate = (allocation, automatedResult = { status: 'passed' }) =>
    evaluateJourneyReports(makeValidJourneyReport(), {
      automatedResult,
      automatedReport: { gates: { allocation } },
    }).gates.find(({ id }) => id === 'allocation')

  assert.equal(evaluate(available).status, 'passed')
  for (const report of [
    { ...available, status: 'unavailable', reason: 'marker unavailable' },
    { ...available, frames: 9_999 },
    { ...available, instrumentation: { ...available.instrumentation, version: -1 } },
    { ...available, observedPackageObjectAllocations: 1 },
    { ...available, sites: [{ id: 4, observedAllocations: 1 }] },
    { ...available, coverage: { status: 'partial' } },
    { ...available, markerSha256: null },
  ]) {
    assert.equal(evaluate(report).status, 'failed')
  }
  assert.equal(evaluate(available, { status: 'failed' }).status, 'failed')
})

test('the public Three steady Frame Sample path allocates zero package objects across advancing frames', async () => {
  const artifactRoot = fileURLToPath(new URL('../artifacts/', import.meta.url))
  mkdirSync(artifactRoot, { recursive: true })
  const temporaryRoot = mkdtempSync(resolve(
    artifactRoot,
    'wrist-menu-steady-frame-',
  ))
  const packageRoot = resolve(temporaryRoot, 'package')
  try {
    cpSync(new URL('../dist/', import.meta.url), resolve(packageRoot, 'dist'), {
      recursive: true,
    })
    await instrumentExactPackageAllocations(packageRoot)
    const evidence = await prepareExactPackageAllocationEvidence(
      packageRoot,
      fileSha256(resolve(packageRoot, EXACT_ALLOCATION_MARKER_FILENAME)),
    )
    assert.equal(evidence.status, 'available')
    const candidate = await import(
      pathToFileURL(resolve(packageRoot, 'dist', 'three', 'index.js')).href
    )
    const fixture = createWristXrFixture({ menuKind: 'controller' })
    fixture.setWristMatrix(new three.Matrix4())
    const menu = candidate.createThreeWristMenuState({
      renderer: fixture.renderer,
      snapshot: reachScrollSnapshot,
      onEvent: () => undefined,
    })
    candidate.updateThreeWristMenu(menu, { time: 0, frame: fixture.frame })
    candidate.updateThreeWristMenu(menu, { time: 1, frame: fixture.frame })
    for (let index = 0; index < 1_000; index += 1) {
      candidate.updateThreeWristMenu(menu, {
        time: index + 2,
        frame: fixture.frame,
      })
    }
    const poseCallsBefore = fixture.poseCalls.length
    evidence.begin()
    for (let index = 0; index < 10_000; index += 1) {
      candidate.updateThreeWristMenu(menu, {
        time: index + 1_002,
        frame: fixture.frame,
      })
    }
    const report = evidence.finish()
    menu.presentation.group.visible = false
    candidate.updateThreeWristMenu(menu, {
      time: 11_002,
      frame: fixture.frame,
    })
    assert.equal(menu.presentation.group.visible, true)
    assert.throws(
      () => candidate.updateThreeWristMenu(menu, {
        time: Number.NaN,
        frame: fixture.frame,
      }),
      /Frame Sample sequence and time must be finite/,
    )
    candidate.disposeThreeWristMenu(menu)

    assert.equal(report.status, 'available', JSON.stringify(report, null, 2))
    assert.equal(report.observedPackageObjectAllocations, 0)
    assert.ok(
      fixture.poseCalls.length > poseCallsBefore,
      'successive steady frames must continue sampling raw XR poses',
    )
    assert.equal(menu.runtime.lastTime, 11_002)
    assert.equal(menu.runtime.scrollState.lastSequence, menu.frameSequence)
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
})

function makeValidSemanticCases() {
  return semanticCaseIds.map((id) => ({
    id,
    status: 'passed',
    observations: {
      iwerFrames: 8,
      rendererFrames: 8,
      runs: [{
        ...(id === 'input-switching' ? {
          activeTransientBefore: { kind: 'selection', claimed: true },
          sourceSwitched: true,
          transientCleared: true,
          terminalEvents: [{ type: 'selection-cancellation' }],
          durableModelBefore: ['grid:true', 'shape:cube'],
          durableModelAfter: ['grid:true', 'shape:cube'],
        } : {}),
        ...(id === 'visibility-session-reentry' ? {
          visibilityHidden: true,
          visibilityRestored: true,
          sessionEnded: true,
          newSessionIdentity: true,
          sessionCleanup: true,
          durableModelBefore: ['grid:true', 'shape:cube'],
          durableModelAfter: ['grid:true', 'shape:cube'],
          freshDwell: { before: false, below: false, at: true },
          postReentrySelectionIntents: 1,
        } : {}),
        ...(id === 'scrolling' ? {
          offsetSamples: [0, 0.01, 0.02, 0.03],
          topClamp: 0,
          bottomClamp: 0.2,
          maxOffset: 0.2,
          ownershipAcquired: true,
          ownershipReleased: true,
          rearmed: true,
        } : {}),
      }],
    },
  }))
}

function makeValidSceneEventShield(
  integration = 'react',
  sourceKind = 'hand',
) {
  return {
    status: 'passed',
    actionTypes: [...sceneActionTypes],
    cases: ['commit', 'cancel', 'hold', 'leave-before-release', 'rapid-actions']
      .map((id) => ({
        id,
        status: 'passed',
        observations: {
          dispatchPath: integration === 'three'
            ? 'three-host-shield'
            : 'react-event-manager',
          dispatches: sceneActionTypes.map((type) => ({
            type,
            behindTargetDeliveries: 0,
          })),
          terminalEvents: terminalEventsByShieldCase[id]
            .map((type) => ({ type })),
          neutralTransitions: 1,
          mountedRecoveryMenuPresent: true,
          sourceNeutralized: true,
          mountedRecoveryDispatches: sceneActionTypes.map((type) => ({
            type,
            behindTargetDeliveries: 1,
          })),
          unmountRecoveryDispatches: sceneActionTypes.map((type) => ({
            type,
            behindTargetDeliveries: 1,
          })),
          menuPresentAfterUnmount: false,
        },
      })),
  }
}

function makeValidJourney(integration = 'react', sourceKind = 'hand') {
  const semanticCases = makeValidSemanticCases()
  const sceneEventShield = {
    ...makeValidSceneEventShield(integration, sourceKind),
    rendererIntegration: integration,
    selectionSourceKind: sourceKind,
  }
  return {
    status: 'passed',
    coverage: {
      status: 'passed',
      driver: integration === 'three'
        ? 'packed-three-renderer-xr'
        : 'packed-react-renderer-xr',
      sourceKind,
      semanticCases,
      sceneEventShield: structuredClone(sceneEventShield),
    },
    sceneEventShield,
  }
}

function makeValidJourneyReport(integration = 'react') {
  return {
    status: 'passed',
    journeys: [
      makeValidJourney(integration, 'hand'),
      makeValidJourney(integration, 'controller'),
    ],
  }
}

async function runJourneyEvidence({
  rendererIntegration = 'react',
  sourceKind = 'hand',
  semanticCases = makeValidSemanticCases(),
  sceneEventShield = makeValidSceneEventShield(
    rendererIntegration,
    sourceKind,
  ),
} = {}) {
  return verifyRendererJourneyEvidence({
    status: 'passed',
    driver: rendererIntegration === 'three'
      ? 'packed-three-renderer-xr'
      : 'packed-react-renderer-xr',
    sourceKind,
    semanticCases,
    sceneEventShield: {
      ...sceneEventShield,
      rendererIntegration,
      selectionSourceKind: sourceKind,
    },
  })
}

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
  assert.deepEqual(inventory.textureDimensions, [
    { width: 2, height: 3, depth: 1, bytes: 24, uploadVersion: 1 },
  ])

  meshGeometry.dispose()
  meshMaterial.map.dispose()
  meshMaterial.dispose()
  lineGeometry.dispose()
  lineMaterial.dispose()
})

test('construction invariants fail closed on a stable but wrong atlas and pool', () => {
  const root = new Group()
  const inventory = inventoryThreeScene(root)
  const report = evaluateConstructionInvariants(inventory, {
    geometries: 27,
    materials: 27,
    textures: 1,
    programSignatures: 1,
    poolSlots: 12,
    atlas: {
      count: 1,
      widthMax: 1024,
      heightMax: 2048,
      bytesMax: 8 * 1024 * 1024,
      uploadVersions: 1,
    },
  })

  assert.equal(report.status, 'failed')
  assert.ok(report.failures.includes('atlas-count'))
  assert.ok(report.failures.includes('poolSlots'))
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

test('renderer journey evidence rejects unknown adapters and inferred shield booleans', async () => {
  const semanticCases = makeValidSemanticCases()
  const sceneEventShield = makeValidSceneEventShield()

  await assert.rejects(
    runRendererJourneyEvidence({ rendererIntegration: 'core' }),
    /unknown Renderer Integration/,
  )
  const evidence = await runJourneyEvidence({
    semanticCases,
    sceneEventShield,
  })
  assert.equal(evidence.status, 'passed')

  const inferred = structuredClone(sceneEventShield)
  inferred.cases[0].observations = {
    sceneActions: inferred.actionTypes.map((type) => ({ type, blocked: true })),
  }
  await assert.rejects(
    runJourneyEvidence({
      semanticCases,
      sceneEventShield: inferred,
    }),
    /actual behind-target dispatch/,
  )
})

test('one journey-evidence interface sequences scenarios for either Renderer Integration adapter', async () => {
  const observed = { semantic: [], shield: [] }
  const scrollOffsets = [
    0, 1, 2, 3,
    3, 4, 5, 6,
    6, 5, 4, 3,
    3, 2, 1, 0,
  ]
  const evidence = await runRendererJourneyEvidence({
    rendererIntegration: 'react',
    sourceKind: 'hand',
    createSemanticRun({ scenario, wrist }) {
      observed.semantic.push(`${scenario.id}:${wrist}`)
      let time = 0
      let visibleState = true
      let disconnected = false
      let reentered = false
      let scrollIndex = -1
      let scrollOffset = 0
      let selectionIntents = 0
      let selectedAfterReentry = false
      let frames = 0
      let switched = false
      let definition = 'standard'
      const events = []
      return {
        sourceKind: 'hand',
        async step(nextTime) {
          time = nextTime
          frames += 1
          if (
            scenario.behavior === 'visibilitySessionReentry' &&
            reentered && time >= 828 && !selectedAfterReentry
          ) {
            selectionIntents += 1
            selectedAfterReentry = true
            events.push({ type: 'selection-intent' })
          }
        },
        async aim() {
          if (scenario.behavior === 'scrolling') {
            scrollIndex += 1
            scrollOffset = scrollOffsets[scrollIndex]
          }
        },
        moveSelectionAway() {},
        disconnectMenuSource() { disconnected = true },
        switchInputMode() { switched = true },
        sourceSwitched: () => switched,
        activeTransient: async () => ({
          kind: 'scene-input-claim',
          claimed: true,
        }),
        transientCleared: () => switched,
        visible() {
          if (!visibleState || disconnected || definition === 'empty') return false
          if (scenario.behavior === 'freshRevealHideDwell') {
            return time >= 316 && time < 332
          }
          if (scenario.behavior === 'visibilitySessionReentry') {
            return reentered ? time >= 764 : time >= 316
          }
          return true
        },
        revealPhase: () => (time >= 316 ? 'visible' : 'hidden'),
        scrollOffset: () => scrollOffset,
        presentationSignature: () => ['grid:true', 'shape:cube'],
        selectionIntentCount: () => selectionIntents,
        terminalEvents: () => switched
          ? [{ type: 'selection-cancellation' }]
          : [],
        setVisibility(state) { visibleState = state === 'visible' },
        async endAndReenterSession() {
          reentered = true
          return {
            sessionEnded: true,
            sessionCleanup: true,
            newSessionIdentity: true,
          }
        },
        async setMenuDefinition(kind) { definition = kind },
        iwerFrames: () => frames,
        rendererFrames: () => frames,
        wristMenuEvents: () => events,
        async dispose() {},
      }
    },
    createSceneEventShieldRun({ scenario }) {
      observed.shield.push(scenario.id)
      let active = true
      let present = true
      let frames = 0
      return {
        dispatchPath: 'react-event-manager',
        sourceKind: 'hand',
        async step() { frames += 1 },
        async aim() { active = true },
        moveSelectionAway() { active = false },
        disconnectMenuSource() { active = false },
        placeBehindMenu() {},
        placeBehindOutsideMenu() {},
        dispatchSceneActions: () => sceneActionTypes.map((type) => ({
          type,
          behindTargetDeliveries: active ? 0 : 1,
        })),
        terminalEvents: () => terminalEventsByShieldCase[scenario.id]
          .map((type) => ({ type })),
        sourceNeutralized: () => !active,
        menuPresent: () => present,
        async unmount() { present = false },
        iwerFrames: () => frames,
        rendererFrames: () => frames,
        wristMenuEvents: () => [],
        async dispose() {},
      }
    },
  })

  assert.deepEqual(
    observed.semantic,
    semanticCaseIds.flatMap((id) =>
      id === 'both-wrists' ? [`${id}:left`, `${id}:right`] : [`${id}:left`],
    ),
  )
  assert.deepEqual(observed.shield, [
    'commit',
    'cancel',
    'hold',
    'leave-before-release',
    'rapid-actions',
  ])
  assert.equal(evidence.id, 'iwer-react-hand')
  assert.equal(evidence.status, 'passed')
  assert.equal(evidence.coverage.sceneEventShield, evidence.sceneEventShield)
})

test('renderer journey evidence rejects incomplete input-switching proof', async () => {
  const mutations = [
    (run) => { run.activeTransientBefore.claimed = false },
    (run) => { run.sourceSwitched = false },
    (run) => { run.transientCleared = false },
    (run) => { run.terminalEvents = [] },
    (run) => { run.durableModelBefore = [] },
    (run) => { run.durableModelAfter = ['grid:false'] },
  ]

  for (const mutate of mutations) {
    const semanticCases = makeValidSemanticCases()
    const inputSwitching = semanticCases.find(
      ({ id }) => id === 'input-switching',
    )
    mutate(inputSwitching.observations.runs[0])

    await assert.rejects(
      runJourneyEvidence({
        semanticCases,
      }),
      /input-switching/,
    )
  }
})

test('renderer journey evidence rejects incomplete session lifecycle and reentry proof', async () => {
  const mutations = [
    (run) => { run.visibilityHidden = false },
    (run) => { run.visibilityRestored = false },
    (run) => { run.sessionEnded = false },
    (run) => { run.newSessionIdentity = false },
    (run) => { run.sessionCleanup = false },
    (run) => { run.durableModelAfter = ['grid:false'] },
    (run) => { run.freshDwell.at = false },
    (run) => { run.postReentrySelectionIntents = 0 },
  ]

  for (const mutate of mutations) {
    const semanticCases = makeValidSemanticCases()
    const lifecycle = semanticCases.find(
      ({ id }) => id === 'visibility-session-reentry',
    )
    mutate(lifecycle.observations.runs[0])

    await assert.rejects(
      runJourneyEvidence({
        semanticCases,
      }),
      /visibility-session-reentry/,
    )
  }
})

test('renderer journey evidence rejects discontinuous or unrearmed scrolling proof', async () => {
  const mutations = [
    (run) => { run.offsetSamples = [0, 0.01, 0.02] },
    (run) => { run.offsetSamples = [0, 0.01, 0.01, 0.03] },
    (run) => { run.topClamp = 0.01 },
    (run) => { run.bottomClamp = 0.19 },
    (run) => { run.maxOffset = 0 },
    (run) => { run.ownershipAcquired = false },
    (run) => { run.ownershipReleased = false },
    (run) => { run.rearmed = false },
  ]

  for (const mutate of mutations) {
    const semanticCases = makeValidSemanticCases()
    const scrolling = semanticCases.find(({ id }) => id === 'scrolling')
    mutate(scrolling.observations.runs[0])

    await assert.rejects(
      runJourneyEvidence({
        sourceKind: 'controller',
        semanticCases,
      }),
      /scrolling/,
    )
  }
})

test('renderer journey evidence rejects wrong shield terminals or missing recovery phases', async () => {
  const mutations = [
    (shield) => { shield.cases.pop() },
    (shield) => {
      shield.cases[0].observations.dispatches[0]
        .behindTargetDeliveries = 1
    },
    (shield) => {
      shield.cases.find(({ id }) => id === 'commit')
        .observations.terminalEvents = []
    },
    (shield) => {
      shield.cases.find(({ id }) => id === 'cancel')
        .observations.terminalEvents = [{ type: 'selection-intent' }]
    },
    (shield) => {
      shield.cases.find(({ id }) => id === 'rapid-actions')
        .observations.terminalEvents.pop()
    },
    (shield) => {
      shield.cases.find(({ id }) => id === 'rapid-actions')
        .observations.neutralTransitions = 0
    },
    (shield) => {
      shield.cases.find(({ id }) => id === 'commit')
        .observations.neutralTransitions = 0
    },
    (shield) => {
      shield.cases[0].observations.mountedRecoveryMenuPresent = false
    },
    (shield) => {
      shield.cases[0].observations.sourceNeutralized = false
    },
    (shield) => {
      shield.cases[0].observations.mountedRecoveryDispatches[0]
        .behindTargetDeliveries = 0
    },
    (shield) => {
      shield.cases[0].observations.unmountRecoveryDispatches.pop()
    },
    (shield) => {
      shield.cases[0].observations.menuPresentAfterUnmount = true
    },
  ]

  for (const mutate of mutations) {
    const sceneEventShield = makeValidSceneEventShield()
    mutate(sceneEventShield)

    await assert.rejects(
      runJourneyEvidence({
        sceneEventShield,
      }),
      /Scene Event Shield/,
    )
  }
})

function evaluateJourneyReports(react19Report, options = {}) {
  const candidateSha256 = 'a'.repeat(64)
  const report = (journeyReport, testedLanes) => ({
    ...journeyReport,
    candidateSha256,
    testedLanes,
  })
  return evaluateAutomatedReleaseGates({
    evidenceContext: {
      compatibility: {
        testedLanes: [
          'core-import',
          'three-0.185.1',
          'react-18.3.1-r3f-8.18.0',
          'react-19.2.7-r3f-9.6.1',
          'react-xr-6.6.30',
          'iwer-vanilla-hand',
          'iwer-vanilla-controller',
          'iwer-react-hand',
          'iwer-react-controller',
          ...(options.additionalLaneIds ?? []),
        ].map((id) => ({ id })),
      },
      protocol: {
        id: 'test',
        version: 1,
        sha256: 'b'.repeat(64),
        requiredGateIds: ['tested-lane-coverage'],
      },
      candidate: {
        package: '@xleepy/wrist-menu',
        version: '0.0.0',
        tarball: 'artifacts/xleepy-wrist-menu-0.0.0.tgz',
        sha256: candidateSha256,
      },
      source: {
        commit: 'c'.repeat(40),
        exampleCommit: 'd'.repeat(40),
      },
      lockfiles: [],
      instrumentation: { id: 'test', version: 1 },
    },
    prerequisiteResults: Array.from({ length: 5 }, () => ({ status: 'passed' })),
    deterministicResult: { status: 'passed' },
    deterministicReport: { status: 'passed' },
    consumerResult: { status: 'passed' },
    automatedResult: options.automatedResult ?? { status: 'passed' },
    automatedReport: options.automatedReport ?? { gates: {} },
    exampleResult: { status: 'passed' },
    threeReport: report(
      options.threeReport ?? makeValidJourneyReport('three'),
      options.threeTestedLanes ?? [
        'three-0.185.1',
        'iwer-vanilla-hand',
        'iwer-vanilla-controller',
      ],
    ),
    react18Report: report(makeValidJourneyReport('react'), [
      'react-18.3.1-r3f-8.18.0',
      'react-xr-6.6.30',
    ]),
    react19Report: report(react19Report, [
      'react-19.2.7-r3f-9.6.1',
      'react-xr-6.6.30',
      'iwer-react-hand',
      'iwer-react-controller',
    ]),
    importReportNames: ['core.json'],
    importReports: [{ status: 'passed', candidateSha256 }],
    performanceBaselinePolicy: { variants: {} },
  })
}

test('Release Gate evaluation fails closed on passed journey reports with weakened proof', () => {
  const mutations = [
    (report) => {
      report.journeys[0].coverage.semanticCases.find(
        ({ id }) => id === 'input-switching',
      ).observations.runs[0].transientCleared = false
    },
    (report) => {
      report.journeys[0].coverage.semanticCases.find(
        ({ id }) => id === 'visibility-session-reentry',
      ).observations.runs[0].sessionEnded = false
    },
    (report) => {
      report.journeys[0].coverage.semanticCases.find(
        ({ id }) => id === 'scrolling',
      ).observations.runs[0].offsetSamples = [0, 0.01, 0.01, 0.03]
    },
    (report) => {
      report.journeys[0].sceneEventShield.cases.find(
        ({ id }) => id === 'hold',
      ).observations.terminalEvents = []
    },
    (report) => {
      report.journeys[0].coverage.sceneEventShield.cases.find(
        ({ id }) => id === 'hold',
      ).observations.terminalEvents = []
    },
    (report) => {
      report.journeys[0].sceneEventShield.cases[0]
        .observations.mountedRecoveryDispatches = []
    },
    (report) => {
      report.journeys[0].sceneEventShield.cases[0]
        .observations.unmountRecoveryDispatches = []
    },
    (report) => {
      report.journeys[0].sceneEventShield.cases[0]
        .observations.dispatchPath = 'three-host-shield'
    },
  ]

  assert.equal(
    evaluateJourneyReports(makeValidJourneyReport()).reports.sceneEventShield.status,
    'passed',
  )
  for (const mutate of mutations) {
    const report = makeValidJourneyReport()
    mutate(report)
    assert.equal(
      evaluateJourneyReports(report).reports.sceneEventShield.status,
      'failed',
    )
  }
})

test('Release Gate evaluation fails closed for unknown lanes and unmapped reports', () => {
  const unknownLane = evaluateJourneyReports(makeValidJourneyReport(), {
    additionalLaneIds: ['unknown-renderer-lane'],
  })
  assert.equal(unknownLane.laneStates['unknown-renderer-lane'], false)
  assert.deepEqual(
    unknownLane.gates.find(({ id }) => id === 'tested-lane-coverage'),
    {
      id: 'tested-lane-coverage',
      status: 'failed',
      report: 'raw/packed-consumers-command.json',
      detail: 'failed or unmapped Tested Lanes: unknown-renderer-lane',
    },
  )
  const isolatedLaneFailure = {
    ...unknownLane,
    gates: unknownLane.gates.map((gate) => ({
      ...gate,
      status: gate.id === 'tested-lane-coverage' ? 'failed' : 'passed',
    })),
  }
  const bundleManifest = [...new Set(
    isolatedLaneFailure.gates.map(({ report }) => report),
  )].map((path) => ({
    path,
    bytes: 1,
    sha256: 'e'.repeat(64),
  }))
  assert.equal(
    finalizeAutomatedReleaseEvidence(
      isolatedLaneFailure,
      { bundleManifest },
    ).record.result,
    'failed',
  )

  const unmappedReport = evaluateJourneyReports(makeValidJourneyReport(), {
    threeTestedLanes: ['unmapped-three-report-lane'],
  })
  assert.equal(unmappedReport.laneStates['three-0.185.1'], false)
  assert.equal(unmappedReport.reports.sceneEventShield.status, 'failed')
  assert.equal(
    unmappedReport.gates.find(({ id }) => id === 'three-consumer').status,
    'failed',
  )
})
