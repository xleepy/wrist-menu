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
  evaluateConstructionInvariants,
  inventoryThreeScene,
  listenerInventory,
  sampleThreeAllocationOrdinals,
} from '../fixtures/consumers/runtime-evidence.mjs'
import { verifyImportSafety } from '../fixtures/consumers/import-safety.mjs'
import {
  assertCompleteJourneyCoverage,
  buildRendererJourneyCoverage,
} from '../fixtures/consumers/journey-evidence.mjs'
import { journeyCombinationPassed } from '../scripts/generate-release-evidence.mjs'

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

function makeValidSceneEventShield() {
  return {
    status: 'passed',
    actionTypes: [...sceneActionTypes],
    cases: ['commit', 'cancel', 'hold', 'leave-before-release', 'rapid-actions']
      .map((id) => ({
        id,
        status: 'passed',
        observations: {
          dispatchPath: 'react-event-manager',
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

function makeValidJourneyReport() {
  const semanticCases = makeValidSemanticCases()
  const sceneEventShield = {
    ...makeValidSceneEventShield(),
    rendererIntegration: 'react',
    selectionSourceKind: 'hand',
  }
  return {
    status: 'passed',
    journeys: [{
      status: 'passed',
      coverage: {
        status: 'passed',
        driver: 'packed-react-renderer-xr',
        sourceKind: 'hand',
        semanticCases,
        sceneEventShield: structuredClone(sceneEventShield),
      },
      sceneEventShield,
    }],
  }
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

test('renderer journey evidence rejects Core-only samples and inferred shield booleans', () => {
  const semanticCases = makeValidSemanticCases()
  const sceneEventShield = makeValidSceneEventShield()

  assert.throws(
    () => buildRendererJourneyCoverage({
      driver: 'candidate-public-core-with-IWER-source-metadata',
      sourceKind: 'hand',
      semanticCases,
      sceneEventShield,
    }),
    /production renderer\/XR seam/,
  )
  const coverage = buildRendererJourneyCoverage({
    driver: 'packed-react-renderer-xr',
    sourceKind: 'hand',
    semanticCases,
    sceneEventShield,
  })
  assertCompleteJourneyCoverage(coverage)

  const inferred = structuredClone(sceneEventShield)
  inferred.cases[0].observations = {
    sceneActions: inferred.actionTypes.map((type) => ({ type, blocked: true })),
  }
  assert.throws(
    () => buildRendererJourneyCoverage({
      driver: 'packed-react-renderer-xr',
      sourceKind: 'hand',
      semanticCases,
      sceneEventShield: inferred,
    }),
    /actual behind-target dispatch/,
  )
})

test('renderer journey evidence rejects incomplete input-switching proof', () => {
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

    assert.throws(
      () => buildRendererJourneyCoverage({
        driver: 'packed-react-renderer-xr',
        sourceKind: 'hand',
        semanticCases,
        sceneEventShield: makeValidSceneEventShield(),
      }),
      /input-switching/,
    )
  }
})

test('renderer journey evidence rejects incomplete session lifecycle and reentry proof', () => {
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

    assert.throws(
      () => buildRendererJourneyCoverage({
        driver: 'packed-react-renderer-xr',
        sourceKind: 'hand',
        semanticCases,
        sceneEventShield: makeValidSceneEventShield(),
      }),
      /visibility-session-reentry/,
    )
  }
})

test('renderer journey evidence rejects discontinuous or unrearmed scrolling proof', () => {
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

    assert.throws(
      () => buildRendererJourneyCoverage({
        driver: 'packed-react-renderer-xr',
        sourceKind: 'controller',
        semanticCases,
        sceneEventShield: makeValidSceneEventShield(),
      }),
      /scrolling/,
    )
  }
})

test('renderer journey evidence rejects wrong shield terminals or missing recovery phases', () => {
  const mutations = [
    (shield) => { shield.actionTypes.pop() },
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

    assert.throws(
      () => buildRendererJourneyCoverage({
        driver: 'packed-react-renderer-xr',
        sourceKind: 'hand',
        semanticCases: makeValidSemanticCases(),
        sceneEventShield,
      }),
      /Scene Event Shield/,
    )
  }
})

test('release generator fails closed on passed journey reports with weakened proof', () => {
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

  assert.equal(journeyCombinationPassed(makeValidJourneyReport(), 'react', 'hand'), true)
  for (const mutate of mutations) {
    const report = makeValidJourneyReport()
    mutate(report)
    assert.equal(journeyCombinationPassed(report, 'react', 'hand'), false)
  }
})
