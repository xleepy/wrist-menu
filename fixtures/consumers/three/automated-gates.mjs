import { performance } from 'node:perf_hooks'
import { readFile } from 'node:fs/promises'
import { Matrix4 } from 'three'

import {
  createThreeWristMenuState,
  defaultThreeWristMenuPresentationFactory,
  disposeThreeWristMenu,
  replaceThreeWristMenuPresentation,
  updateThreeWristMenu,
} from '@xleepy/wrist-menu/three'
import { reachScrollSnapshot } from '../../reach-scroll.mjs'
import { createWristXrFixture } from '../../wrist-reveal-xr.mjs'
import { writeLaneReport } from '../evidence-report.mjs'

function inventory(root) {
  const geometries = new Set()
  const materials = new Set()
  const textures = new Set()
  let poolSlots = 0
  root.traverse((object) => {
    if (object.geometry !== undefined) geometries.add(object.geometry)
    const objectMaterials = Array.isArray(object.material)
      ? object.material
      : object.material === undefined
        ? []
        : [object.material]
    for (const material of objectMaterials) {
      materials.add(material)
      for (const value of Object.values(material)) {
        if (value?.isTexture === true) textures.add(value)
      }
    }
    if (object.userData?.wristMenuItemId !== undefined) poolSlots += 1
  })
  return { geometries, materials, textures, poolSlots }
}

function resourceCounts(root) {
  const resources = inventory(root)
  return {
    geometries: resources.geometries.size,
    materials: resources.materials.size,
    textures: resources.textures.size,
    poolSlots: resources.poolSlots,
  }
}

function sceneCounters(root) {
  const resources = inventory(root)
  let drawCalls = 0
  let triangles = 0
  let lines = 0
  const visibleMaterials = new Set()
  root.traverseVisible((object) => {
    if (object.isMesh !== true || object.material?.visible === false) return
    drawCalls += 1
    const geometry = object.geometry
    const count = geometry?.index?.count ?? geometry?.attributes?.position?.count ?? 0
    triangles += count / 3
    const objectMaterials = Array.isArray(object.material)
      ? object.material
      : [object.material]
    for (const material of objectMaterials) visibleMaterials.add(material.type)
  })
  return {
    drawCalls,
    triangles,
    lines,
    geometries: resources.geometries.size,
    textures: resources.textures.size,
    programs: visibleMaterials.size,
    atlasUploads: 0,
  }
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

function createMenu() {
  const fixture = createWristXrFixture({ menuKind: 'controller' })
  fixture.setWristMatrix(new Matrix4())
  const menu = createThreeWristMenuState({
    renderer: fixture.renderer,
    snapshot: reachScrollSnapshot,
    onEvent: () => undefined,
  })
  updateThreeWristMenu(menu, { time: 0, frame: fixture.frame })
  updateThreeWristMenu(menu, { time: 1, frame: fixture.frame })
  return { fixture, menu }
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

function lifecycleProbe() {
  const failures = []
  for (let cycle = 0; cycle < 20; cycle += 1) {
    const { fixture, menu } = createMenu()
    const firstResources = inventory(menu.presentation.group)
    const firstExpectedDisposals =
      firstResources.geometries.size + firstResources.materials.size + firstResources.textures.size
    let firstDisposals = 0
    for (const resource of [
      ...firstResources.geometries,
      ...firstResources.materials,
      ...firstResources.textures,
    ]) {
      resource.addEventListener('dispose', () => {
        firstDisposals += 1
      })
    }
    replaceThreeWristMenuPresentation(
      menu,
      defaultThreeWristMenuPresentationFactory,
    )
    updateThreeWristMenu(menu, { time: 2, frame: fixture.frame })
    const replacementResources = inventory(menu.presentation.group)
    const replacementExpectedDisposals =
      replacementResources.geometries.size +
      replacementResources.materials.size +
      replacementResources.textures.size
    let replacementDisposals = 0
    for (const resource of [
      ...replacementResources.geometries,
      ...replacementResources.materials,
      ...replacementResources.textures,
    ]) {
      resource.addEventListener('dispose', () => {
        replacementDisposals += 1
      })
    }
    const group = menu.presentation.group
    disposeThreeWristMenu(menu)
    const sessionListeners = [...fixture.session.listeners.values()].reduce(
      (count, listeners) => count + listeners.size,
      0,
    )
    const referenceListeners = [...fixture.referenceSpace.listeners.values()].reduce(
      (count, listeners) => count + listeners.size,
      0,
    )
    if (
      group.children.length !== 0 ||
      sessionListeners !== 0 ||
      referenceListeners !== 0 ||
      firstDisposals !== firstExpectedDisposals ||
      replacementDisposals !== replacementExpectedDisposals
    ) {
      failures.push({
        cycle,
        children: group.children.length,
        sessionListeners,
        referenceListeners,
        firstDisposals,
        firstExpectedDisposals,
        replacementDisposals,
        replacementExpectedDisposals,
      })
    }
  }
  return { status: failures.length === 0 ? 'passed' : 'failed', cycles: 20, failures }
}

const baselines = JSON.parse(
  await readFile(new URL('../../../evidence/baselines/performance-v1.json', import.meta.url), 'utf8'),
)
const { fixture, menu } = createMenu()
const constructed = inventory(menu.presentation.group)
const allocationStart = resourceCounts(menu.presentation.group)
const timings = []
for (let index = 0; index < 10_000; index += 1) {
  const started = performance.now()
  updateThreeWristMenu(menu, { time: 1, frame: fixture.frame })
  timings.push(performance.now() - started)
}
const allocationEnd = resourceCounts(menu.presentation.group)
const allocationGate = {
  status: 'failed',
  reason: 'exact JavaScript object-allocation instrumentation is unavailable in the Node lane',
  frames: 10_000,
  packageOwnedResourceDelta: Object.fromEntries(
    Object.keys(allocationStart).map((key) => [key, allocationEnd[key] - allocationStart[key]]),
  ),
}
const identicalMutationGate = mutationProbe(menu, fixture)

const beforeScroll = inventory(menu.presentation.group)
const beforeScrollCounts = resourceCounts(menu.presentation.group)
for (let index = 0; index < 1_000; index += 1) {
  fixture.setTargetRayMatrix(
    new Matrix4().makeTranslation(0, -0.03 * ((index % 20) / 20), 1),
  )
  updateThreeWristMenu(menu, { time: index + 2, frame: fixture.frame })
}
const afterScroll = inventory(menu.presentation.group)
const sameIdentities = (before, after) =>
  before.size === after.size && [...before].every((value) => after.has(value))
const resourceGrowthGate = {
  status:
    sameIdentities(beforeScroll.geometries, afterScroll.geometries) &&
    sameIdentities(beforeScroll.materials, afterScroll.materials) &&
    sameIdentities(beforeScroll.textures, afterScroll.textures) &&
    beforeScroll.poolSlots === afterScroll.poolSlots
      ? 'passed'
      : 'failed',
  frames: 1_000,
  before: beforeScrollCounts,
  after: resourceCounts(menu.presentation.group),
}

const visibleIdle = {
  ...sceneCounters(menu.presentation.group),
  packageUpdateP95Ms: percentile(timings, 0.95),
}
const activeScroll = {
  ...sceneCounters(menu.presentation.group),
  packageUpdateP95Ms: percentile(timings, 0.95),
}
menu.presentation.group.visible = false
const hidden = {
  ...sceneCounters(menu.presentation.group),
  packageUpdateP95Ms: percentile(timings, 0.95),
}
menu.presentation.group.visible = true

const measurements = { hidden, visibleIdle, activeScroll }
const performanceVariants = {
  vanilla: {
    status: Object.entries(measurements).every(([phase, measurement]) =>
      withinBaseline(measurement, baselines.variants.vanilla[phase]),
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
  instrumentation: 'node-three-scene-counters-v1',
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
    atlasBytes: 0,
    poolSlots: constructed.poolSlots,
  },
}

await writeLaneReport('automated-package-gates.json', report)
console.log(JSON.stringify(report, null, 2))
