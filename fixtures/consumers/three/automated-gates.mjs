import { performance } from 'node:perf_hooks'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as three from 'three'
import { BufferGeometry as InstrumentedBufferGeometry } from 'three/src/core/BufferGeometry.js'
import { Group as InstrumentedGroup } from 'three/src/objects/Group.js'
import { Material as InstrumentedMaterial } from 'three/src/materials/Material.js'
import { Texture as InstrumentedTexture } from 'three/src/textures/Texture.js'

import { reachScrollSnapshot } from '../../reach-scroll.mjs'
import { createWristXrFixture } from '../../wrist-reveal-xr.mjs'
import { writeLaneReport } from '../evidence-report.mjs'
import {
  evaluatePerformanceVariant,
  performanceBaselineVariants,
} from '../performance-baseline.mjs'
import {
  packageUpdateTimingObservation,
  performanceMeasuredFrameSamples,
  performanceWarmupFrameSamples,
  sceneCounters,
} from '../performance-workload.mjs'
import { activeScrollPositionY } from '../reach-scroll-workload.mjs'
import {
  allocationDelta,
  evaluateConstructionInvariants,
  identityGrowth,
  inventoryThreeScene,
  listenerInventory,
  sampleThreeAllocationOrdinals,
} from '../runtime-evidence.mjs'
import {
  EXACT_ALLOCATION_MARKER_SHA256_ENV,
  prepareExactPackageAllocationEvidence,
} from '../exact-allocation-evidence.mjs'

const fixtureRoot = dirname(fileURLToPath(import.meta.url))
const candidatePackageRoot = resolve(
  fixtureRoot,
  'node_modules',
  '@xleepy',
  'wrist-menu',
)
const exactAllocationEvidence =
  await prepareExactPackageAllocationEvidence(
    candidatePackageRoot,
    process.env[EXACT_ALLOCATION_MARKER_SHA256_ENV],
  )
const {
  createThreeWristMenuState,
  defaultThreeWristMenuPresentationFactory,
  disposeThreeWristMenu,
  replaceThreeWristMenuPresentation,
  syncThreeWristMenu,
  updateThreeWristMenu,
} = await import('@xleepy/wrist-menu/three')

const { Matrix4, Quaternion, Vector3 } = three
const instrumentedThree = {
  BufferGeometry: InstrumentedBufferGeometry,
  Group: InstrumentedGroup,
  Material: InstrumentedMaterial,
  Texture: InstrumentedTexture,
}

function inventory(root) {
  return inventoryThreeScene(root)
}

function resourceCounts(root) {
  return inventory(root).counts
}

function rendererPolicyProbe(fixture) {
  const calls = {
    renderLoops: 0,
    sessionChanges: 0,
    referenceSpaceChanges: 0,
    framebufferChanges: 0,
    foveationChanges: 0,
    subscriptions: 0,
  }
  Object.assign(fixture.renderer, {
    setAnimationLoop() {
      calls.renderLoops += 1
    },
    setRenderTarget() {
      calls.framebufferChanges += 1
    },
  })
  Object.assign(fixture.renderer.xr, {
    setSession() {
      calls.sessionChanges += 1
    },
    setReferenceSpace() {
      calls.referenceSpaceChanges += 1
    },
    setFoveation() {
      calls.foveationChanges += 1
    },
    subscribe() {
      calls.subscriptions += 1
      return () => undefined
    },
  })
  return calls
}

function measurePhaseWorkload(phase) {
  const snapshot = {
    ...reachScrollSnapshot,
    activationMode: phase === 'hidden' ? 'forced-closed' : 'forced-open',
  }
  const { fixture, menu } = createMenu(snapshot)
  const activeScroll = phase === 'activeScroll'
  let activeScrollFrame = 0
  const driveFrame = (_index, time) => {
    if (activeScroll) {
      const positionY = activeScrollPositionY(activeScrollFrame)
      const origin = menu.presentation.group.localToWorld(
        new Vector3(0, positionY, 1),
      )
      const orientation = menu.presentation.group.getWorldQuaternion(
        new Quaternion(),
      )
      fixture.setTargetRayMatrix(
        new Matrix4().compose(origin, orientation, new Vector3(1, 1, 1)),
      )
      activeScrollFrame += 1
    } else {
      fixture.setTargetRayMatrix(new Matrix4().makeTranslation(2, 2, 1))
    }
    updateThreeWristMenu(menu, { time, frame: fixture.frame })
  }
  try {
    driveFrame(0, 2)
    driveFrame(1, 3)
    const warmupFrames = performanceWarmupFrameSamples
    for (let index = 0; index < warmupFrames; index += 1) {
      driveFrame(index, 4 + index)
    }
    const timings = []
    for (let index = 0; index < performanceMeasuredFrameSamples; index += 1) {
      const started = performance.now()
      driveFrame(index, 4 + warmupFrames + index)
      timings.push(performance.now() - started)
    }
    return {
      ...sceneCounters(menu.presentation.group),
      ...packageUpdateTimingObservation(timings),
      workload: phase,
      warmupFrames,
      menuVisible: menu.presentation.group.visible,
      scrollOwnerActive: menu.runtime.scrollState.ownerSourceId !== null,
      scrollOffset: menu.runtime.scrollState.offset,
    }
  } finally {
    disposeThreeWristMenu(menu)
  }
}

function createMenu(snapshot = reachScrollSnapshot) {
  const fixture = createWristXrFixture({ menuKind: 'controller' })
  const rendererPolicyCalls = rendererPolicyProbe(fixture)
  fixture.setWristMatrix(new Matrix4())
  return { fixture, rendererPolicyCalls, menu: mountMenu(fixture, snapshot) }
}

function mountMenu(fixture, snapshot = reachScrollSnapshot) {
  const menu = createThreeWristMenuState({
    renderer: fixture.renderer,
    snapshot,
    onEvent: () => undefined,
  })
  updateThreeWristMenu(menu, { time: 0, frame: fixture.frame })
  updateThreeWristMenu(menu, { time: 1, frame: fixture.frame })
  return menu
}

function mutationProbe(menu, fixture) {
  const probes = [
    ['Vector3.fromArray', menu.anchorPosition.constructor.prototype, 'fromArray'],
    ['Quaternion.fromArray', menu.anchorOrientation.constructor.prototype, 'fromArray'],
    ['Matrix4.compose', menu.anchorMatrix.constructor.prototype, 'compose'],
    ['Matrix4.decompose', menu.anchorMatrix.constructor.prototype, 'decompose'],
  ]
  const originals = []
  let calls = 0
  try {
    for (const [name, prototype, method] of probes) {
      const original = prototype[method]
      originals.push([prototype, method, original])
      prototype[method] = function (...args) {
        calls += 1
        return original.apply(this, args)
      }
    }
    updateThreeWristMenu(menu, { time: 1, frame: fixture.frame })
  } finally {
    for (const [prototype, method, original] of originals) {
      prototype[method] = original
    }
  }
  return {
    status: calls === 0 ? 'passed' : 'failed',
    observedInstrumentedPropertyWrites: calls,
    probes: probes.map(([name]) => name),
  }
}

function observeDisposals(resources) {
  const expected = {
    geometries: resources.identities.geometries.size,
    materials: resources.identities.materials.size,
    textures: resources.identities.textures.size,
  }
  const observed = { geometries: 0, materials: 0, textures: 0 }
  for (const type of Object.keys(observed)) {
    for (const resource of resources.identities[type]) {
      resource.addEventListener('dispose', () => {
        observed[type] += 1
      })
    }
  }
  return { expected, observed }
}

function disposalProbePassed(probe) {
  return Object.keys(probe.expected).every(
    (type) => probe.observed[type] === probe.expected[type],
  )
}

function lifecycleProbe() {
  const failures = []
  const measurements = []
  for (let cycle = 0; cycle < 20; cycle += 1) {
    const fixture = createWristXrFixture({ menuKind: 'controller' })
    const rendererPolicyCalls = rendererPolicyProbe(fixture)
    fixture.setWristMatrix(new Matrix4())
    const baseline = {
      sessionListeners: listenerInventory(fixture.session),
      referenceSpaceListeners: listenerInventory(fixture.referenceSpace),
      rendererPolicyCalls: { ...rendererPolicyCalls },
      allocationOrdinals: sampleThreeAllocationOrdinals(instrumentedThree),
    }
    const menu = mountMenu(fixture)
    const firstResources = inventory(menu.presentation.group)
    const mountedListeners = {
      session: listenerInventory(fixture.session),
      referenceSpace: listenerInventory(fixture.referenceSpace),
    }
    const firstDisposalProbe = observeDisposals(firstResources)
    replaceThreeWristMenuPresentation(
      menu,
      defaultThreeWristMenuPresentationFactory,
    )
    updateThreeWristMenu(menu, { time: 2, frame: fixture.frame })
    const replacementResources = inventory(menu.presentation.group)
    const replacementDisposalProbe = observeDisposals(replacementResources)
    const group = menu.presentation.group
    disposeThreeWristMenu(menu)
    const retainedResources = inventory(group)
    const final = {
      sessionListeners: listenerInventory(fixture.session),
      referenceSpaceListeners: listenerInventory(fixture.referenceSpace),
      rendererPolicyCalls: { ...rendererPolicyCalls },
      allocationOrdinals: sampleThreeAllocationOrdinals(instrumentedThree),
    }
    const observation = {
      cycle,
      baseline,
      mounted: {
        resources: firstResources.counts,
        sessionListeners: mountedListeners.session,
        referenceSpaceListeners: mountedListeners.referenceSpace,
      },
      replacement: {
        resources: replacementResources.counts,
        disposedPriorPresentation: firstDisposalProbe.observed,
        expectedPriorPresentationDisposals: firstDisposalProbe.expected,
      },
      final: {
        ...final,
        groupChildren: group.children.length,
        disposed: menu.runtime.disposed,
        selectionClaims: menu.runtime.selectionState.claims.size,
        selectionOwnership: menu.runtime.selectionState.ownership ?? null,
        scrollOwnership: menu.runtime.scrollState.ownerSourceId,
        allocatedThreeResources: allocationDelta(
          baseline.allocationOrdinals,
          final.allocationOrdinals,
        ),
        disposedReplacementPresentation: replacementDisposalProbe.observed,
        expectedReplacementPresentationDisposals: replacementDisposalProbe.expected,
        retainedResources: retainedResources.counts,
      },
    }
    measurements.push(observation)
    const passed =
      group.children.length !== 0 ||
      final.sessionListeners.total !== baseline.sessionListeners.total ||
      final.referenceSpaceListeners.total !== baseline.referenceSpaceListeners.total ||
      Object.values(final.rendererPolicyCalls).some((count) => count !== 0) ||
      !disposalProbePassed(firstDisposalProbe) ||
      !disposalProbePassed(replacementDisposalProbe) ||
      retainedResources.counts.geometries !== 0 ||
      retainedResources.counts.materials !== 0 ||
      retainedResources.counts.textures !== 0 ||
      retainedResources.counts.programSignatures !== 0 ||
      retainedResources.counts.textureUploadVersions !== 0 ||
      retainedResources.counts.poolSlots !== 0 ||
      !menu.runtime.disposed ||
      menu.runtime.selectionState.claims.size !== 0 ||
      menu.runtime.selectionState.ownership !== undefined ||
      menu.runtime.scrollState.ownerSourceId !== null
        ? false
        : true
    if (!passed) failures.push(observation)
  }
  return {
    status: failures.length === 0 ? 'passed' : 'failed',
    cycles: measurements.length,
    measurements,
    failures,
  }
}

const baselines = JSON.parse(
  await readFile(new URL('../../../evidence/baselines/performance-v1.json', import.meta.url), 'utf8'),
)
const { fixture, menu, rendererPolicyCalls } = createMenu()
const constructed = inventory(menu.presentation.group)
const constructionGate = evaluateConstructionInvariants(
  constructed,
  baselines.construction,
)
const allocationStart = resourceCounts(menu.presentation.group)
const allocationOrdinalsStart = sampleThreeAllocationOrdinals(instrumentedThree)
const allocationWarmupFrames = 1_000
for (let index = 0; index < allocationWarmupFrames; index += 1) {
  updateThreeWristMenu(menu, { time: index + 2, frame: fixture.frame })
}
exactAllocationEvidence.begin()
for (let index = 0; index < 10_000; index += 1) {
  updateThreeWristMenu(menu, {
    time: allocationWarmupFrames + index + 2,
    frame: fixture.frame,
  })
}
const exactAllocationReport = exactAllocationEvidence.finish()
const allocationEnd = resourceCounts(menu.presentation.group)
const allocationOrdinalsEnd = sampleThreeAllocationOrdinals(instrumentedThree)
const allocationEvidence = {
  ...exactAllocationReport,
  frames: 10_000,
  warmupFrames: allocationWarmupFrames,
  packageOwnedResourceDelta: Object.fromEntries(
    Object.keys(allocationStart).map((key) => [key, allocationEnd[key] - allocationStart[key]]),
  ),
  threeResourceAllocations: allocationDelta(
    allocationOrdinalsStart,
    allocationOrdinalsEnd,
  ),
}
const identicalMutationGate = mutationProbe(menu, fixture)

const beforeScroll = inventory(menu.presentation.group)
const beforeScrollCounts = resourceCounts(menu.presentation.group)
const beforeScrollOrdinals = sampleThreeAllocationOrdinals(instrumentedThree)
const beforeScrollSessionListeners = listenerInventory(fixture.session)
const beforeScrollReferenceListeners = listenerInventory(fixture.referenceSpace)
const beforeScrollRendererPolicy = { ...rendererPolicyCalls }
for (let index = 0; index < 1_000; index += 1) {
  fixture.setTargetRayMatrix(
    new Matrix4().makeTranslation(0, -0.03 * ((index % 20) / 20), 1),
  )
  updateThreeWristMenu(menu, { time: index + 2, frame: fixture.frame })
}
const afterScroll = inventory(menu.presentation.group)
const afterScrollCounts = resourceCounts(menu.presentation.group)
const afterScrollOrdinals = sampleThreeAllocationOrdinals(instrumentedThree)
const growth = identityGrowth(beforeScroll, afterScroll)
const scrollAllocations = allocationDelta(beforeScrollOrdinals, afterScrollOrdinals)
const afterScrollSessionListeners = listenerInventory(fixture.session)
const afterScrollReferenceListeners = listenerInventory(fixture.referenceSpace)
const afterScrollRendererPolicy = { ...rendererPolicyCalls }
const resourceCountNames = [
  'geometries',
  'materials',
  'textures',
  'programSignatures',
  'textureUploadVersions',
  'textureBytes',
  'poolSlots',
]
const resourceCountDelta = Object.fromEntries(
  resourceCountNames.map((name) => [
    name,
    afterScrollCounts[name] - beforeScrollCounts[name],
  ]),
)
const resourceGrowthGate = {
  status:
    constructionGate.status === 'passed' &&
    Object.values(growth).every(({ added, removed }) => added === 0 && removed === 0) &&
    Object.values(scrollAllocations).every((count) => count === 0) &&
    Object.values(resourceCountDelta).every((count) => count === 0) &&
    afterScrollSessionListeners.total === beforeScrollSessionListeners.total &&
    afterScrollReferenceListeners.total === beforeScrollReferenceListeners.total &&
    Object.keys(afterScrollRendererPolicy).every(
      (name) => afterScrollRendererPolicy[name] === beforeScrollRendererPolicy[name],
    )
      ? 'passed'
      : 'failed',
  frames: 1_000,
  construction: constructionGate,
  before: beforeScrollCounts,
  after: afterScrollCounts,
  identityGrowth: growth,
  allocations: scrollAllocations,
  countDelta: resourceCountDelta,
  listenerGrowth: {
    session: {
      before: beforeScrollSessionListeners,
      after: afterScrollSessionListeners,
    },
    referenceSpace: {
      before: beforeScrollReferenceListeners,
      after: afterScrollReferenceListeners,
    },
  },
  rendererPolicyCalls: {
    before: beforeScrollRendererPolicy,
    after: afterScrollRendererPolicy,
  },
}

const hidden = measurePhaseWorkload('hidden')
const visibleIdle = measurePhaseWorkload('visibleIdle')
const activeScroll = measurePhaseWorkload('activeScroll')

const measurements = { hidden, visibleIdle, activeScroll }
const vanillaEvaluation = evaluatePerformanceVariant(
  performanceBaselineVariants.find(({ id }) => id === 'vanilla'),
  measurements,
  baselines.variants.vanilla,
)
const vanillaWorkloadFailures = Object.entries(measurements)
  .filter(([phase, measurement]) =>
    (phase === 'hidden' ? measurement.menuVisible : !measurement.menuVisible) ||
    (phase === 'activeScroll' &&
      !(measurement.scrollOwnerActive && measurement.scrollOffset > 0)),
  )
  .map(([phase]) => `${phase} workload was not realized`)
const performanceVariants = {
  vanilla: {
    status:
      vanillaEvaluation.status === 'passed' &&
      vanillaWorkloadFailures.length === 0
        ? 'passed'
        : 'failed',
    failures: [...vanillaEvaluation.failures, ...vanillaWorkloadFailures],
    measurements,
  },
}

disposeThreeWristMenu(menu)
const report = {
  instrumentation: 'node-three-scene-counters-v2',
  candidate: '@xleepy/wrist-menu/three',
  gates: {
    allocation: allocationEvidence,
    'identical-frame-mutation': identicalMutationGate,
    construction: constructionGate,
    'resource-growth': resourceGrowthGate,
    'lifecycle-leak': lifecycleProbe(),
    'performance-baseline': {
      status: Object.values(performanceVariants).every(
        ({ status }) => status === 'passed',
      )
        ? 'passed'
        : 'failed',
      variants: performanceVariants,
    },
  },
  invariants: {
    atlasTextureCount: constructed.counts.textures,
    atlasBytes: constructed.counts.textureBytes,
    atlasUploadVersions: constructed.counts.textureUploadVersions,
    poolSlots: constructed.counts.poolSlots,
  },
}

await writeLaneReport('automated-package-gates.json', report)
console.log(JSON.stringify(report, null, 2))
