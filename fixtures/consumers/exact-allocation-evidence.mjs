import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

import ts from 'typescript'

export const EXACT_ALLOCATION_INSTRUMENTATION = Object.freeze({
  id: 'node-static-package-allocation-counter',
  version: 4,
})

export const EXACT_ALLOCATION_GLOBAL_SYMBOL =
  '@xleepy/wrist-menu/exact-package-allocation-counter/v4'

export const EXACT_ALLOCATION_MARKER_FILENAME =
  '.wrist-menu-exact-allocations.json'

export const EXACT_ALLOCATION_MARKER_SHA256_ENV =
  'WRIST_MENU_EXACT_ALLOCATION_MARKER_SHA256'

export const EXACT_ALLOCATION_RUNTIME_PROTOCOL = Object.freeze({
  id: 'package-allocation-runtime-sentinel',
  version: 1,
  recorderName: '__wristMenuExactAllocation',
  exactToken: '@xleepy/wrist-menu/exact-allocation/exact/v4',
  unsupportedToken: '@xleepy/wrist-menu/exact-allocation/unsupported/v4',
})

export const EXACT_ALLOCATION_COVERAGE_PROTOCOL = Object.freeze({
  id: 'typescript-ast-package-allocation-classifier',
  version: 3,
  exactKinds: Object.freeze([
    'array-literal',
    'arrow-function',
    'class-declaration',
    'class-expression',
    'function-declaration',
    'function-expression',
    'object-literal',
    'regexp-literal',
  ]),
  allocationFreeKinds: Object.freeze([
    'call-expression',
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
    'rest-array',
    'spread-iteration',
    'tagged-template',
    'call-expression',
    'new-expression',
  ]),
})

export const EXACT_ALLOCATION_MARKER_PROTOCOL = Object.freeze({
  filename: EXACT_ALLOCATION_MARKER_FILENAME,
  schemaVersion: 4,
  coverage: EXACT_ALLOCATION_COVERAGE_PROTOCOL,
})

const sha256 = (bytes) =>
  createHash('sha256').update(bytes).digest('hex')

function runtimeSiteCalls(bytes, path) {
  const sourceFile = ts.createSourceFile(
    path,
    bytes.toString('utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  )
  if (sourceFile.parseDiagnostics.length !== 0) return undefined
  const calls = []
  let malformed = false
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === EXACT_ALLOCATION_RUNTIME_PROTOCOL.recorderName
    ) {
      const [token, siteId, objects] = node.arguments
      if (
        !ts.isStringLiteral(token) ||
        !ts.isNumericLiteral(siteId) ||
        !ts.isNumericLiteral(objects)
      ) {
        malformed = true
      } else {
        calls.push({
          token: token.text,
          siteId: Number(siteId.text),
          objects: Number(objects.text),
        })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return malformed ? undefined : calls
}

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
  globalThis[Symbol.for(EXACT_ALLOCATION_GLOBAL_SYMBOL)] = (
    _token,
    _siteId,
    _objects,
    value,
  ) => value
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
          ...(report.markerSha256 === undefined
            ? {}
            : { markerSha256: report.markerSha256 }),
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

export async function prepareExactPackageAllocationEvidence(
  packageRoot,
  trustedMarkerSha256,
) {
  if (!/^[a-f0-9]{64}$/.test(trustedMarkerSha256 ?? '')) {
    return unavailable('trusted instrumented package marker digest is unavailable')
  }
  let markerBytes
  let marker
  try {
    markerBytes = await readFile(
      resolve(packageRoot, EXACT_ALLOCATION_MARKER_PROTOCOL.filename),
    )
    if (sha256(markerBytes) !== trustedMarkerSha256) {
      return unavailable('instrumented package marker digest changed')
    }
    marker = JSON.parse(markerBytes)
  } catch {
    return unavailable('instrumented package manifest is unavailable')
  }

  const coverage = marker.coverage
  if (
    marker.schemaVersion !== EXACT_ALLOCATION_MARKER_PROTOCOL.schemaVersion ||
    marker.instrumentation?.id !== EXACT_ALLOCATION_INSTRUMENTATION.id ||
    marker.instrumentation?.version !== EXACT_ALLOCATION_INSTRUMENTATION.version ||
    marker.globalSymbol !== EXACT_ALLOCATION_GLOBAL_SYMBOL ||
    marker.runtime?.id !== EXACT_ALLOCATION_RUNTIME_PROTOCOL.id ||
    marker.runtime?.version !== EXACT_ALLOCATION_RUNTIME_PROTOCOL.version ||
    marker.runtime?.recorderName !==
      EXACT_ALLOCATION_RUNTIME_PROTOCOL.recorderName ||
    marker.runtime?.exactToken !== EXACT_ALLOCATION_RUNTIME_PROTOCOL.exactToken ||
    marker.runtime?.unsupportedToken !==
      EXACT_ALLOCATION_RUNTIME_PROTOCOL.unsupportedToken ||
    coverage?.status !== 'complete' ||
    coverage.classifier?.id !== EXACT_ALLOCATION_COVERAGE_PROTOCOL.id ||
    coverage.classifier?.version !== EXACT_ALLOCATION_COVERAGE_PROTOCOL.version ||
    JSON.stringify(coverage.exactKinds) !==
      JSON.stringify(EXACT_ALLOCATION_COVERAGE_PROTOCOL.exactKinds) ||
    JSON.stringify(coverage.allocationFreeKinds) !==
      JSON.stringify(EXACT_ALLOCATION_COVERAGE_PROTOCOL.allocationFreeKinds) ||
    JSON.stringify(coverage.unsupportedKinds) !==
      JSON.stringify(EXACT_ALLOCATION_COVERAGE_PROTOCOL.unsupportedKinds) ||
    !Number.isSafeInteger(coverage.visitedNodeCount) ||
    coverage.visitedNodeCount < 1 ||
    !Number.isSafeInteger(coverage.exactSiteCount) ||
    coverage.exactSiteCount < 0 ||
    !Number.isSafeInteger(coverage.allocationFreeSiteCount) ||
    coverage.allocationFreeSiteCount < 0 ||
    !Number.isSafeInteger(coverage.unsupportedSiteCount) ||
    coverage.unsupportedSiteCount < 0 ||
    !Number.isSafeInteger(coverage.callExpressionCount) ||
    coverage.callExpressionCount < 0 ||
    !Number.isSafeInteger(coverage.callDescriptorCount) ||
    coverage.callDescriptorCount !== coverage.callExpressionCount ||
    !Number.isSafeInteger(coverage.newExpressionCount) ||
    coverage.newExpressionCount < 0 ||
    !Number.isSafeInteger(coverage.newDescriptorCount) ||
    coverage.newDescriptorCount !== coverage.newExpressionCount ||
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
      !Number.isSafeInteger(file.allocationFreeSiteCount) ||
      file.allocationFreeSiteCount < 0 ||
      !Number.isSafeInteger(file.unsupportedSiteCount) ||
      file.unsupportedSiteCount < 0 ||
      !Number.isSafeInteger(file.callExpressionCount) ||
      file.callExpressionCount < 0 ||
      !Number.isSafeInteger(file.callDescriptorCount) ||
      file.callDescriptorCount !== file.callExpressionCount ||
      !Number.isSafeInteger(file.newExpressionCount) ||
      file.newExpressionCount < 0 ||
      !Number.isSafeInteger(file.newDescriptorCount) ||
      file.newDescriptorCount !== file.newExpressionCount,
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
        typeof site.nodeKind !== 'string' ||
        typeof site.descriptorId !== 'string' ||
        site.descriptorId.length === 0 ||
        typeof site.identity !== 'string' ||
        site.identity.length === 0 ||
        typeof site.reason !== 'string' ||
        site.reason.length === 0 ||
        !(
          site.classification === 'exact' &&
          EXACT_ALLOCATION_COVERAGE_PROTOCOL.exactKinds.includes(site.kind) &&
          Number.isSafeInteger(site.objectsPerEvaluation) &&
          site.objectsPerEvaluation >= 1
        ) && !(
          site.classification === 'allocation-free' &&
          EXACT_ALLOCATION_COVERAGE_PROTOCOL.allocationFreeKinds.includes(
            site.kind,
          ) &&
          site.objectsPerEvaluation === null
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
      (total, file) => total + file.allocationFreeSiteCount,
      0,
    ) !== coverage.allocationFreeSiteCount ||
    marker.files.reduce(
      (total, file) => total + file.unsupportedSiteCount,
      0,
    ) !== coverage.unsupportedSiteCount ||
    marker.sites.filter(({ classification }) => classification === 'exact')
      .length !== coverage.exactSiteCount ||
    marker.sites.filter(
      ({ classification }) => classification === 'allocation-free',
    ).length !== coverage.allocationFreeSiteCount ||
    marker.sites.filter(
      ({ classification }) => classification === 'unsupported',
    ).length !== coverage.unsupportedSiteCount ||
    marker.files.reduce(
      (total, file) => total + file.callExpressionCount,
      0,
    ) !== coverage.callExpressionCount ||
    marker.files.reduce(
      (total, file) => total + file.callDescriptorCount,
      0,
    ) !== coverage.callDescriptorCount ||
    marker.files.reduce(
      (total, file) => total + file.newExpressionCount,
      0,
    ) !== coverage.newExpressionCount ||
    marker.files.reduce(
      (total, file) => total + file.newDescriptorCount,
      0,
    ) !== coverage.newDescriptorCount ||
    marker.sites.filter(({ nodeKind }) => nodeKind === 'CallExpression')
      .length !== coverage.callExpressionCount ||
    marker.sites.filter(({ nodeKind }) => nodeKind === 'NewExpression')
      .length !== coverage.newExpressionCount ||
    coverage.exactSiteCount + coverage.allocationFreeSiteCount +
      coverage.unsupportedSiteCount !== marker.siteCount
  ) {
    return unavailable('instrumented package manifest does not cover exact package output')
  }

  const runtimeCallCounts = new Uint32Array(marker.siteCount)
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
    const calls = runtimeSiteCalls(bytes, file.path)
    if (calls === undefined) {
      return unavailable(
        `instrumented package runtime sentinels are malformed: ${file.path}`,
      )
    }
    for (const call of calls) {
      const site = marker.sites[call.siteId]
      const expectedToken = site?.classification === 'exact'
        ? EXACT_ALLOCATION_RUNTIME_PROTOCOL.exactToken
        : site?.classification === 'unsupported'
          ? EXACT_ALLOCATION_RUNTIME_PROTOCOL.unsupportedToken
          : undefined
      const expectedObjects = site?.classification === 'exact'
        ? site.objectsPerEvaluation
        : 0
      if (
        site === undefined ||
        site.path !== file.path ||
        expectedToken === undefined ||
        call.token !== expectedToken ||
        call.objects !== expectedObjects
      ) {
        return unavailable(
          `instrumented package runtime sentinel disposition changed: ${file.path}`,
        )
      }
      runtimeCallCounts[call.siteId] += 1
    }
  }
  if (marker.sites.some((site) => (
    site.classification === 'allocation-free'
      ? runtimeCallCounts[site.id] !== 0
      : runtimeCallCounts[site.id] === 0
  ))) {
    return unavailable(
      'instrumented package runtime sentinel coverage does not match the marker',
    )
  }

  const counts = new Float64Array(marker.siteCount)
  const expectedObjects = new Float64Array(marker.siteCount)
  const classifications = new Uint8Array(marker.siteCount)
  const unsupported = new Uint8Array(marker.siteCount)
  for (const site of marker.sites) {
    if (site.classification === 'exact') {
      classifications[site.id] = 1
      expectedObjects[site.id] = site.objectsPerEvaluation
    } else if (site.classification === 'unsupported') {
      classifications[site.id] = 2
    } else {
      classifications[site.id] = 3
    }
  }
  let enabled = false
  let total = 0
  let invalidSite = false
  const record = (token, siteId, objects, value) => {
    if (!enabled) return value
    if (
      !Number.isSafeInteger(siteId) ||
      siteId < 0 ||
      siteId >= counts.length ||
      (
        classifications[siteId] === 1 &&
        token !== EXACT_ALLOCATION_RUNTIME_PROTOCOL.exactToken
      ) ||
      (
        classifications[siteId] === 2 &&
        token !== EXACT_ALLOCATION_RUNTIME_PROTOCOL.unsupportedToken
      ) ||
      classifications[siteId] === 3 ||
      (classifications[siteId] === 1 && objects !== expectedObjects[siteId]) ||
      (classifications[siteId] !== 1 && objects !== 0)
    ) {
      invalidSite = true
      return value
    }
    if (classifications[siteId] === 1) {
      counts[siteId] += objects
      total += objects
    } else if (classifications[siteId] === 2) {
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
      markerSha256: trustedMarkerSha256,
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
          markerSha256: trustedMarkerSha256,
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
          markerSha256: trustedMarkerSha256,
        }
      }
      return {
        instrumentation: EXACT_ALLOCATION_INSTRUMENTATION,
        status: 'available',
        observedPackageObjectAllocations: total,
        coverage,
        markerSha256: trustedMarkerSha256,
        sites: marker.sites.flatMap((site) =>
          counts[site.id] === 0
            ? []
            : [{ ...site, observedAllocations: counts[site.id] }],
        ),
      }
    },
  }
}
