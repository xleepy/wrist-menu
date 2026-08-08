import { createHash } from 'node:crypto'

const SHA256 = /^[a-f0-9]{64}$/
const COMMIT = /^[a-f0-9]{40}$/

function deepFreeze(value) {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value
  }
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

function sortedValue(value) {
  if (Array.isArray(value)) return value.map(sortedValue)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortedValue(value[key])]),
  )
}

export function canonicalJson(value) {
  return `${JSON.stringify(sortedValue(value), null, 2)}\n`
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function requireArray(value, name) {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`)
}

export function validateCompatibilityManifest(manifest) {
  if (manifest?.schemaVersion !== 2) {
    throw new TypeError('compatibility schemaVersion must be 2')
  }
  if (manifest.package !== '@xleepy/wrist-menu') {
    throw new TypeError('compatibility package must be @xleepy/wrist-menu')
  }
  for (const key of [
    'declaredPeers',
    'testedLanes',
    'verifiedClaims',
    'provisionalRows',
    'invalidatedEvidence',
  ]) {
    if (!(key in manifest)) throw new TypeError(`compatibility is missing ${key}`)
  }
  requireArray(manifest.testedLanes, 'testedLanes')
  requireArray(manifest.verifiedClaims, 'verifiedClaims')
  requireArray(manifest.provisionalRows, 'provisionalRows')
  requireArray(manifest.invalidatedEvidence, 'invalidatedEvidence')
  const ids = new Set()
  for (const lane of manifest.testedLanes) {
    if (typeof lane.id !== 'string' || ids.has(lane.id)) {
      throw new TypeError(`Tested Lane id must be unique: ${lane.id}`)
    }
    ids.add(lane.id)
    if (lane.status !== 'unverified') {
      throw new TypeError(`source Tested Lane must remain unverified: ${lane.id}`)
    }
    requireArray(lane.evidenceRecords, `${lane.id}.evidenceRecords`)
  }
  for (const row of manifest.provisionalRows) {
    if (row.status !== 'provisional' || row.evidenceRecords?.length !== 0) {
      throw new TypeError('physical rows without evidence must remain provisional')
    }
  }
  return manifest
}

function assertEvidenceInput(input) {
  if (!SHA256.test(input.candidate?.sha256 ?? '')) {
    throw new TypeError('candidate sha256 must be a lowercase SHA-256 digest')
  }
  if (!COMMIT.test(input.source?.commit ?? '')) {
    throw new TypeError('source commit must be a full Git commit')
  }
  if (!COMMIT.test(input.source?.exampleCommit ?? '')) {
    throw new TypeError('Example App commit must be a full Git commit')
  }
  if (!SHA256.test(input.protocol?.sha256 ?? '')) {
    throw new TypeError('protocol sha256 must be a lowercase SHA-256 digest')
  }
  requireArray(input.lockfiles, 'lockfiles')
  for (const lockfile of input.lockfiles) {
    if (!SHA256.test(lockfile.sha256 ?? '')) {
      throw new TypeError(`lockfile digest is invalid: ${lockfile.path}`)
    }
  }
  requireArray(input.requiredGateIds, 'requiredGateIds')
  requireArray(input.gates, 'gates')
  requireArray(input.testedLanes, 'testedLanes')
  requireArray(input.validationCombinations, 'validationCombinations')
  const gateById = new Map()
  for (const gate of input.gates) {
    if (gateById.has(gate.id)) {
      throw new TypeError(`duplicate Release Gate: ${gate.id}`)
    }
    if (gate.status !== 'passed' && gate.status !== 'failed') {
      throw new TypeError(`invalid Release Gate status: ${gate.id}`)
    }
    if (typeof gate.report !== 'string' || !gate.report.startsWith('raw/')) {
      throw new TypeError(`Release Gate report must be under raw/: ${gate.id}`)
    }
    gateById.set(gate.id, gate)
  }
  for (const gateId of input.requiredGateIds) {
    if (!gateById.has(gateId)) {
      throw new TypeError(`missing required Release Gate: ${gateId}`)
    }
  }
}

export function buildAutomatedEvidenceRecord(input) {
  assertEvidenceInput(input)
  const identity = {
    candidateSha256: input.candidate.sha256,
    sourceCommit: input.source.commit,
    exampleCommit: input.source.exampleCommit,
    lockfiles: input.lockfiles,
    protocol: input.protocol,
    instrumentation: input.instrumentation,
  }
  const recordId = `automated-release-${sha256(canonicalJson(identity)).slice(0, 16)}`
  const result = input.gates.every(({ status }) => status === 'passed')
    ? 'passed'
    : 'failed'
  return deepFreeze({
    schemaVersion: 1,
    recordId,
    kind: 'automated',
    result,
    candidate: input.candidate,
    source: input.source,
    lockfiles: input.lockfiles,
    testedLanes: input.testedLanes,
    validationCombinations: input.validationCombinations,
    protocol: input.protocol,
    instrumentation: input.instrumentation,
    rawReportDirectory: input.rawReportDirectory,
    gates: input.gates,
    invalidationReasons: [],
  })
}

export function evidenceInvalidationReasons(record, current) {
  const fields = [
    ['candidateSha256', 'candidate-digest-changed'],
    ['sourceCommit', 'source-commit-changed'],
    ['exampleCommit', 'example-commit-changed'],
    ['lockfileSha256', 'lockfile-changed'],
    ['protocolSha256', 'protocol-changed'],
    ['instrumentationVersion', 'instrumentation-changed'],
    ['instrumentationSha256', 'instrumentation-changed'],
    ['deviceOsBuild', 'device-os-build-changed'],
    ['browserBuild', 'browser-build-changed'],
  ]
  return [
    ...new Set(
      fields
        .filter(([field]) => record[field] !== current[field])
        .map(([, reason]) => reason),
    ),
  ]
}
