import { performance } from 'node:perf_hooks'
import { readFile } from 'node:fs/promises'
import * as three from 'three'
import { BufferGeometry as InstrumentedBufferGeometry } from 'three/src/core/BufferGeometry.js'
import { Group as InstrumentedGroup } from 'three/src/objects/Group.js'
import { Material as InstrumentedMaterial } from 'three/src/materials/Material.js'
import { Texture as InstrumentedTexture } from 'three/src/textures/Texture.js'

import {
  createThreeWristMenuState,
  defaultThreeWristMenuPresentationFactory,
  disposeThreeWristMenu,
  replaceThreeWristMenuPresentation,
  syncThreeWristMenu,
  updateThreeWristMenu,
} from '@xleepy/wrist-menu/three'
import { reachScrollSnapshot } from '../../reach-scroll.mjs'
import { createWristXrFixture } from '../../wrist-reveal-xr.mjs'
import { writeLaneReport } from '../evidence-report.mjs'
import {
  allocationDelta,
  evaluateConstructionInvariants,
  identityGrowth,
  inventoryThreeScene,
  listenerInventory,
  sampleThreeAllocationOrdinals,
} from '../runtime-evidence.mjs'

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

function sceneCounters(root) {
  const resources = inventory(root)
  let drawCalls = 0
  let triangles = 0
  let lines = 0
  const visiblePrograms = new Set()
  root.traverseVisible((object) => {
    if (
      (object.isMesh !== true && object.isLine !== true) ||
      object.material?.visible === false
    ) return
    drawCalls += 1
    const geometry = object.geometry
    const count = geometry?.index?.count ?? geometry?.attributes?.position?.count ?? 0
    if (object.isLine === true) lines += Math.max(0, count - 1)
    else triangles += count / 3
    const objectMaterials = Array.isArray(object.material)
      ? object.material
      : [object.material]
    for (const material of objectMaterials) {
      visiblePrograms.add(`${material.type}:${material.customProgramCacheKey()}`)
    }
  })
  return {
    drawCalls,
    triangles,
    lines,
    geometries: resources.counts.geometries,
    textures: resources.counts.textures,
    programs: visiblePrograms.size,
    atlasUploads: resources.counts.textureUploadVersions,
  }
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

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]
}

function withinBaseline(measurement, baseline) {
  const mappings = {
    drawCalls: 'drawCallsMax',
    triangles: 'trianglesMax',
    lines: 'linesMax',
    geometries: 'geometriesMax',
    textures: 'texturesMax',
    programs: 'programsMax',
    atlasUploads: 'atlasUploadsMax',
    packageUpdateP95Ms: 'packageUpdateP95MsMax',
  }
  return Object.entries(mappings).every(
    ([measurementName, baselineName]) =>
      measurement[measurementName] <= baseline[baselineName],
  )
}

function measurePhaseWorkload(phase) {
  const { fixture, menu } = createMenu()
  const activeScroll = phase === 'activeScroll'
  const driveFrame = (index, time) => {
    if (activeScroll) {
      const origin = menu.presentation.group.localToWorld(
        new Vector3(0.09, -0.03 * ((index % 20) / 20), 1),
      )
      const orientation = menu.presentation.group.getWorldQuaternion(
        new Quaternion(),
      )
      fixture.setTargetRayMatrix(
        new Matrix4().compose(origin, orientation, new Vector3(1, 1, 1)),
      )
    } else {
      fixture.setTargetRayMatrix(new Matrix4().makeTranslation(2, 2, 1))
    }
    updateThreeWristMenu(menu, { time, frame: fixture.frame })
  }
  try {
    syncThreeWristMenu(menu, {
      ...reachScrollSnapshot,
      activationMode: phase === 'hidden' ? 'forced-closed' : 'forced-open',
    })
    driveFrame(0, 2)
    driveFrame(1, 3)
    const warmupFrames = 1_000
    for (let index = 0; index < warmupFrames; index += 1) {
      driveFrame(index, 4 + index)
    }
    const timings = []
    for (let index = 0; index < 10_000; index += 1) {
      const started = performance.now()
      driveFrame(index, 4 + warmupFrames + index)
      timings.push(performance.now() - started)
    }
    return {
      ...sceneCounters(menu.presentation.group),
      packageUpdateP95Ms: percentile(timings, 0.95),
      workload: phase,
      warmupFrames,
      measuredFrames: timings.length,
      menuVisible: menu.presentation.group.visible,
      scrollOwnerActive: menu.runtime.scrollState.ownerSourceId !== null,
      scrollOffset: menu.runtime.scrollState.offset,
    }
  } finally {
    disposeThreeWristMenu(menu)
  }
}

function createMenu() {
  const fixture = createWristXrFixture({ menuKind: 'controller' })
  const rendererPolicyCalls = rendererPolicyProbe(fixture)
  fixture.setWristMatrix(new Matrix4())
  return { fixture, rendererPolicyCalls, menu: mountMenu(fixture) }
}

function mountMenu(fixture) {
  const menu = createThreeWristMenuState({
    renderer: fixture.renderer,
    snapshot: reachScrollSnapshot,
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
for (let index = 0; index < 10_000; index += 1) {
  updateThreeWristMenu(menu, { time: 1, frame: fixture.frame })
}
const allocationEnd = resourceCounts(menu.presentation.group)
const allocationOrdinalsEnd = sampleThreeAllocationOrdinals(instrumentedThree)
const allocationGate = {
  status: 'failed',
  reason: 'exact JavaScript object-allocation instrumentation is unavailable in the Node lane',
  frames: 10_000,
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
const performanceVariants = {
  vanilla: {
    status: Object.entries(measurements).every(([phase, measurement]) =>
      withinBaseline(measurement, baselines.variants.vanilla[phase]) &&
      (phase === 'hidden' ? !measurement.menuVisible : measurement.menuVisible) &&
      (phase !== 'activeScroll' ||
        (measurement.scrollOwnerActive && measurement.scrollOffset > 0)),
    )
      ? 'passed'
      : 'failed',
    measurements,
  },
  react: {
    status: 'failed',
    reason:
      'the packed React Example Variant does not yet expose direct package-update and renderer counters',
    measurements: null,
  },
}

disposeThreeWristMenu(menu)
const report = {
  instrumentation: 'node-three-scene-counters-v2',
  candidate: '@xleepy/wrist-menu/three',
  gates: {
    allocation: allocationGate,
    'identical-frame-mutation': identicalMutationGate,
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
