import { inventoryThreeScene } from './runtime-evidence.mjs'

export const performanceWarmupFrameSamples = 1_000
export const performanceMeasuredFrameSamples = 10_000

export function percentile(values, fraction) {
  if (!Array.isArray(values) || values.length === 0) return Number.NaN
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]
}

export function sceneCounters(root) {
  const resources = inventoryThreeScene(root)
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
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material]
    for (const material of materials) {
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

export function packageUpdateTimingObservation(timings) {
  const samples = Object.freeze([...timings])
  return Object.freeze({
    frameSamples: samples.length,
    packageUpdateSamplesMs: samples,
    packageUpdateP95Ms: percentile(samples, 0.95),
  })
}
