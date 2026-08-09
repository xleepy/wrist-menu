import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

export const EXACT_ALLOCATION_INSTRUMENTATION = Object.freeze({
  id: 'node-static-package-allocation-counter',
  version: 2,
})

export const EXACT_ALLOCATION_GLOBAL_SYMBOL =
  '@xleepy/wrist-menu/exact-package-allocation-counter/v2'

export const EXACT_ALLOCATION_MARKER_FILENAME =
  '.wrist-menu-exact-allocations.json'

export const EXACT_ALLOCATION_COVERAGE_PROTOCOL = Object.freeze({
  id: 'typescript-ast-package-allocation-classifier',
  version: 1,
  exactKinds: Object.freeze([
    'array-literal',
    'arrow-function',
    'class-declaration',
    'class-expression',
    'function-declaration',
    'function-expression',
    'new-expression',
    'object-literal',
    'regexp-literal',
    'static:Array.of',
    'static:Object.create',
    'static:Object.keys',
    'static:Object.values',
  ]),
  unsupportedKinds: Object.freeze([
    'arguments-object',
    'async-path',
    'destructuring-assignment',
    'destructuring-iteration',
    'dynamic-import',
    'for-of-iteration',
    'generator-path',
    'object-rest',
    'object-spread',
    'promise-path',
    'rest-array',
    'spread-iteration',
    'tagged-template',
    'variable-cardinality-call',
  ]),
})

export const EXACT_ALLOCATION_MARKER_PROTOCOL = Object.freeze({
  filename: EXACT_ALLOCATION_MARKER_FILENAME,
  schemaVersion: 2,
  coverage: EXACT_ALLOCATION_COVERAGE_PROTOCOL,
})

const sha256 = (bytes) =>
  createHash('sha256').update(bytes).digest('hex')

export async function exactPackageJavaScriptFiles(packageRoot) {
  const absoluteRoot = resolve(packageRoot)
  const dist = resolve(absoluteRoot, 'dist')
  const files = []
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolutePath = resolve(directory, entry.name)
      if (entry.isDirectory()) await visit(absolutePath)
      else if (entry.isFile() && entry.name.endsWith('.js')) {
        files.push({
          absolutePath,
          path: relative(absoluteRoot, absolutePath).replaceAll('\\', '/'),
        })
      }
    }
  }
  await visit(dist)
  return files.sort((left, right) => left.path.localeCompare(right.path))
}

function unavailable(reason) {
  const report = {
    instrumentation: EXACT_ALLOCATION_INSTRUMENTATION,
    status: 'unavailable',
    reason,
  }
  globalThis[Symbol.for(EXACT_ALLOCATION_GLOBAL_SYMBOL)] = () => undefined
  return {
    status: 'unavailable',
    report,
    begin() {},
    finish() {
      return report
    },
  }
}

export function exactAllocationGate(report, frames) {
  const result = {
    instrumentation: report.instrumentation,
    status:
      report.status === 'available' &&
      report.observedPackageObjectAllocations === 0
        ? 'passed'
        : 'failed',
    frames,
    ...(report.status === 'available'
      ? {
          observedPackageObjectAllocations:
            report.observedPackageObjectAllocations,
          sites: report.sites,
          ...(report.coverage === undefined
            ? {}
            : { coverage: report.coverage }),
        }
      : { reason: report.reason }),
  }
  if (
    result.status === 'failed' &&
    report.status === 'available'
  ) {
    result.reason =
      `observed ${report.observedPackageObjectAllocations} ` +
      'package-owned JavaScript object allocations'
  }
  return result
}

export async function prepareExactPackageAllocationEvidence(packageRoot) {
  let marker
  try {
    marker = JSON.parse(
      await readFile(
        resolve(packageRoot, EXACT_ALLOCATION_MARKER_PROTOCOL.filename),
        'utf8',
      ),
    )
  } catch {
    return unavailable('instrumented package manifest is unavailable')
  }

  const coverage = marker.coverage
  if (
    marker.schemaVersion !== EXACT_ALLOCATION_MARKER_PROTOCOL.schemaVersion ||
    marker.instrumentation?.id !== EXACT_ALLOCATION_INSTRUMENTATION.id ||
    marker.instrumentation?.version !== EXACT_ALLOCATION_INSTRUMENTATION.version ||
    marker.globalSymbol !== EXACT_ALLOCATION_GLOBAL_SYMBOL ||
    coverage?.status !== 'complete' ||
    coverage.classifier?.id !== EXACT_ALLOCATION_COVERAGE_PROTOCOL.id ||
    coverage.classifier?.version !== EXACT_ALLOCATION_COVERAGE_PROTOCOL.version ||
    JSON.stringify(coverage.exactKinds) !==
      JSON.stringify(EXACT_ALLOCATION_COVERAGE_PROTOCOL.exactKinds) ||
    JSON.stringify(coverage.unsupportedKinds) !==
      JSON.stringify(EXACT_ALLOCATION_COVERAGE_PROTOCOL.unsupportedKinds) ||
    !Number.isSafeInteger(coverage.visitedNodeCount) ||
    coverage.visitedNodeCount < 1 ||
    !Number.isSafeInteger(coverage.exactSiteCount) ||
    coverage.exactSiteCount < 0 ||
    !Number.isSafeInteger(coverage.unsupportedSiteCount) ||
    coverage.unsupportedSiteCount < 0 ||
    !Number.isSafeInteger(marker.siteCount) ||
    marker.siteCount < 0 ||
    !Array.isArray(marker.files) ||
    !Array.isArray(marker.sites) ||
    marker.sites.length !== marker.siteCount
  ) {
    return unavailable('instrumented package manifest has an incompatible identity or shape')
  }

  if (marker.files.some(
    (file) =>
      typeof file?.path !== 'string' ||
      !/^[a-f0-9]{64}$/.test(file.sourceSha256 ?? '') ||
      !/^[a-f0-9]{64}$/.test(file.instrumentedSha256 ?? '') ||
      !Number.isSafeInteger(file.siteCount) ||
      file.siteCount < 0 ||
      !Number.isSafeInteger(file.visitedNodeCount) ||
      file.visitedNodeCount < 1 ||
      !Number.isSafeInteger(file.exactSiteCount) ||
      file.exactSiteCount < 0 ||
      !Number.isSafeInteger(file.unsupportedSiteCount) ||
      file.unsupportedSiteCount < 0,
  )) {
    return unavailable('instrumented package manifest has an invalid file entry')
  }

  const manifestPaths = marker.files.map(({ path }) => path).sort()
  let packagePaths
  try {
    packagePaths = (await exactPackageJavaScriptFiles(packageRoot))
      .map(({ path }) => path)
  } catch {
    return unavailable('instrumented package output is unavailable')
  }
  if (
    manifestPaths.length !== packagePaths.length ||
    manifestPaths.some((path, index) => path !== packagePaths[index]) ||
    marker.sites.some(
      (site, index) =>
        site?.id !== index ||
        typeof site.path !== 'string' ||
        !manifestPaths.includes(site.path) ||
        !Number.isSafeInteger(site.line) ||
        site.line < 1 ||
        !Number.isSafeInteger(site.column) ||
        site.column < 1 ||
        !(
          site.classification === 'exact' &&
          EXACT_ALLOCATION_COVERAGE_PROTOCOL.exactKinds.includes(site.kind) &&
          Number.isSafeInteger(site.objectsPerEvaluation) &&
          site.objectsPerEvaluation >= 1
        ) && !(
          site.classification === 'unsupported' &&
          EXACT_ALLOCATION_COVERAGE_PROTOCOL.unsupportedKinds.includes(site.kind) &&
          site.objectsPerEvaluation === null
        ),
    ) ||
    marker.files.reduce((total, file) => total + file.siteCount, 0) !==
      marker.siteCount ||
    marker.files.reduce((total, file) => total + file.visitedNodeCount, 0) !==
      coverage.visitedNodeCount ||
    marker.files.reduce((total, file) => total + file.exactSiteCount, 0) !==
      coverage.exactSiteCount ||
    marker.files.reduce(
      (total, file) => total + file.unsupportedSiteCount,
      0,
    ) !== coverage.unsupportedSiteCount ||
    marker.sites.filter(({ classification }) => classification === 'exact')
      .length !== coverage.exactSiteCount ||
    marker.sites.filter(
      ({ classification }) => classification === 'unsupported',
    ).length !== coverage.unsupportedSiteCount ||
    coverage.exactSiteCount + coverage.unsupportedSiteCount !== marker.siteCount
  ) {
    return unavailable('instrumented package manifest does not cover exact package output')
  }

  for (const file of marker.files) {
    if (
      typeof file?.path !== 'string' ||
      !/^[a-f0-9]{64}$/.test(file.instrumentedSha256 ?? '')
    ) {
      return unavailable('instrumented package manifest has an invalid file entry')
    }
    let bytes
    try {
      bytes = await readFile(resolve(packageRoot, file.path))
    } catch {
      return unavailable(`instrumented package file is unavailable: ${file.path}`)
    }
    if (sha256(bytes) !== file.instrumentedSha256) {
      return unavailable(`instrumented package file digest changed: ${file.path}`)
    }
  }

  const counts = new Float64Array(marker.siteCount)
  const expectedObjects = new Float64Array(marker.siteCount)
  const classifications = new Uint8Array(marker.siteCount)
  const unsupported = new Uint8Array(marker.siteCount)
  for (const site of marker.sites) {
    if (site.classification === 'exact') {
      classifications[site.id] = 1
      expectedObjects[site.id] = site.objectsPerEvaluation
    } else {
      classifications[site.id] = 2
    }
  }
  let enabled = false
  let total = 0
  let invalidSite = false
  const record = (siteId, objects, value) => {
    if (!enabled) return value
    if (
      !Number.isSafeInteger(siteId) ||
      siteId < 0 ||
      siteId >= counts.length ||
      (classifications[siteId] === 1 && objects !== expectedObjects[siteId]) ||
      (classifications[siteId] === 2 && objects !== 0)
    ) {
      invalidSite = true
      return value
    }
    if (classifications[siteId] === 1) {
      counts[siteId] += objects
      total += objects
    } else {
      unsupported[siteId] = 1
    }
    return value
  }
  globalThis[Symbol.for(EXACT_ALLOCATION_GLOBAL_SYMBOL)] = record

  return {
    status: 'available',
    report: {
      instrumentation: EXACT_ALLOCATION_INSTRUMENTATION,
      status: 'available',
      observedPackageObjectAllocations: 0,
      sites: [],
      coverage,
    },
    begin() {
      counts.fill(0)
      unsupported.fill(0)
      total = 0
      invalidSite = false
      enabled = true
    },
    finish() {
      enabled = false
      if (invalidSite) {
        return {
          instrumentation: EXACT_ALLOCATION_INSTRUMENTATION,
          status: 'unavailable',
          reason: 'instrumented package reported an unknown allocation site',
        }
      }
      const unsupportedSites = marker.sites.filter(
        (site) => unsupported[site.id] === 1,
      )
      if (unsupportedSites.length !== 0) {
        const first = unsupportedSites[0]
        return {
          instrumentation: EXACT_ALLOCATION_INSTRUMENTATION,
          status: 'unavailable',
          reason:
            `executed unsupported allocation construct ${first.kind} ` +
            `at ${first.path}:${first.line}:${first.column}`,
          unsupportedSites,
          coverage,
        }
      }
      return {
        instrumentation: EXACT_ALLOCATION_INSTRUMENTATION,
        status: 'available',
        observedPackageObjectAllocations: total,
        coverage,
        sites: marker.sites.flatMap((site) =>
          counts[site.id] === 0
            ? []
            : [{ ...site, observedAllocations: counts[site.id] }],
        ),
      }
    },
  }
}
