import {
  performanceMeasuredFrameSamples,
  percentile,
} from './performance-workload.mjs'

export const performanceBaselinePhases = Object.freeze([
  'hidden',
  'visibleIdle',
  'activeScroll',
])

export const performanceBaselineVariants = Object.freeze([
  Object.freeze({ id: 'vanilla', renderer: 'three' }),
  Object.freeze({ id: 'react-18.3.1-r3f-8.18.0', renderer: 'react' }),
  Object.freeze({ id: 'react-19.2.7-r3f-9.6.1', renderer: 'react' }),
])

export const performanceBaselineVariantIds = Object.freeze(
  performanceBaselineVariants.map(({ id }) => id),
)

export const performanceBaselineMetricLimits = Object.freeze({
  drawCalls: 'drawCallsMax',
  triangles: 'trianglesMax',
  lines: 'linesMax',
  geometries: 'geometriesMax',
  textures: 'texturesMax',
  programs: 'programsMax',
  atlasUploads: 'atlasUploadsMax',
  packageUpdateP95Ms: 'packageUpdateP95MsMax',
})

export function performanceBaselinePrerequisites({
  vanillaAutomatedReport,
  react18PackedConsumer,
  react19PackedConsumer,
}) {
  return {
    vanillaPackedConsumer:
      vanillaAutomatedReport?.gates?.['performance-baseline']?.status ===
      'passed',
    react18PackedConsumer: react18PackedConsumer === true,
    react19PackedConsumer: react19PackedConsumer === true,
  }
}

const isFiniteNonNegative = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0

/**
 * Evaluate one exact Example Variant lane against its reviewed, checked-in
 * Performance Baseline. Invalid or incomplete evidence is a failed gate.
 */
export function evaluatePerformanceVariant(variant, measurements, baseline) {
  const failures = []
  const laneId = variant?.id
  const knownVariant = performanceBaselineVariants.find(
    ({ id }) => id === laneId,
  )
  if (knownVariant?.renderer !== variant?.renderer) {
    failures.push('performance variant metadata is missing or invalid')
  }
  const observedPhases =
    measurements !== null && typeof measurements === 'object'
      ? Object.keys(measurements)
      : []
  if (
    observedPhases.length !== performanceBaselinePhases.length ||
    performanceBaselinePhases.some((phase) => !observedPhases.includes(phase))
  ) {
    failures.push('measurements must contain exactly hidden, visibleIdle, and activeScroll')
  }

  for (const phase of performanceBaselinePhases) {
    const measurement = measurements?.[phase]
    const limits = baseline?.[phase]
    if (measurement === null || typeof measurement !== 'object') {
      failures.push(`${phase} measurement is missing`)
      continue
    }
    if (limits === null || typeof limits !== 'object') {
      failures.push(`${phase} reviewed baseline is missing`)
      continue
    }
    if (measurement.workload !== phase) {
      failures.push(`${phase} workload identity is invalid`)
    }
    const timingSamples = measurement.packageUpdateSamplesMs
    if (
      !Array.isArray(timingSamples) ||
      timingSamples.length !== performanceMeasuredFrameSamples ||
      timingSamples.some((sample) => !isFiniteNonNegative(sample))
    ) {
      failures.push(
        `${phase} must retain exactly ${performanceMeasuredFrameSamples} valid package-update timing samples`,
      )
    }
    if (
      measurement.frameSamples !== performanceMeasuredFrameSamples ||
      measurement.frameSamples !== timingSamples?.length
    ) {
      failures.push(`${phase} reported Frame Sample count does not match timing observations`)
    }
    if (
      Array.isArray(timingSamples) &&
      measurement.packageUpdateP95Ms !== percentile(timingSamples, 0.95)
    ) {
      failures.push(`${phase}.packageUpdateP95Ms does not match retained timings`)
    }
    for (const [metric, limitName] of Object.entries(performanceBaselineMetricLimits)) {
      const observed = measurement[metric]
      const limit = limits[limitName]
      if (!isFiniteNonNegative(observed)) {
        failures.push(`${phase}.${metric} is missing or invalid`)
      } else if (!isFiniteNonNegative(limit)) {
        failures.push(`${phase}.${limitName} reviewed limit is missing or invalid`)
      } else if (observed > limit) {
        failures.push(`${phase}.${metric} exceeded ${limitName}`)
      }
    }
    if (variant?.renderer === 'react') {
      if (
        !Number.isInteger(measurement.reactStateSettersInstrumented) ||
        measurement.reactStateSettersInstrumented <= 0
      ) {
        failures.push(`${phase} did not instrument a packed React state setter`)
      }
      if (measurement.reactStateSetterCalls !== 0) {
        failures.push(`${phase} Frame Samples dispatched a React state setter`)
      }
      if (measurement.reactCommits !== 0) {
        failures.push(`${phase} Frame Samples caused a React commit`)
      }
    }
  }

  return Object.freeze({
    laneId,
    status: failures.length === 0 ? 'passed' : 'failed',
    failures: Object.freeze(failures),
    measurements,
  })
}

export function evaluatePerformanceBaselineGate(baseline, measurementsByVariant) {
  const failures = []
  const baselineIds =
    baseline?.variants !== null && typeof baseline?.variants === 'object'
      ? Object.keys(baseline.variants)
      : []
  if (
    baselineIds.length !== performanceBaselineVariantIds.length ||
    performanceBaselineVariantIds.some((id) => !baselineIds.includes(id))
  ) {
    failures.push('reviewed baselines must name every exact Example Variant lane')
  }
  const variants = Object.fromEntries(
    performanceBaselineVariants.map((variant) => {
      const laneId = variant.id
      const result = evaluatePerformanceVariant(
        variant,
        measurementsByVariant?.[laneId],
        baseline?.variants?.[laneId],
      )
      if (result.status !== 'passed') failures.push(...result.failures)
      return [laneId, result]
    }),
  )
  return Object.freeze({
    status: failures.length === 0 ? 'passed' : 'failed',
    failures: Object.freeze(failures),
    variants: Object.freeze(variants),
  })
}
