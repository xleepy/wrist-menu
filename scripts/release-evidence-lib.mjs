import { createHash } from 'node:crypto'
import { access, readFile, readdir, rename } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

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

async function listFiles(directory, current = directory) {
  const files = []
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = resolve(current, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listFiles(directory, path)))
    } else if (entry.isFile()) {
      files.push(relative(directory, path).replaceAll('\\', '/'))
    } else {
      throw new TypeError(`evidence bundles cannot contain links: ${entry.name}`)
    }
  }
  return files.sort()
}

export async function createRetainedReportManifest(bundleDirectory) {
  const rawDirectory = resolve(bundleDirectory, 'raw')
  const files = await listFiles(bundleDirectory, rawDirectory)
  return Promise.all(
    files.map(async (path) => {
      const bytes = await readFile(resolve(bundleDirectory, path))
      return { path, bytes: bytes.byteLength, sha256: sha256(bytes) }
    }),
  )
}

export async function verifyImmutableEvidenceBundle(bundleDirectory) {
  const recordBytes = await readFile(resolve(bundleDirectory, 'evidence-record.json'))
  const recordText = recordBytes.toString('utf8')
  const record = JSON.parse(recordText)
  if (canonicalJson(record) !== recordText) {
    throw new Error('evidence-record is not canonical JSON')
  }
  const identity =
    record.kind === 'automated'
      ? automatedRecordIdentity(record)
      : record.kind === 'candidate-unavailable'
        ? unavailableRecordIdentity(record)
        : undefined
  if (identity === undefined) {
    throw new Error(`unknown Evidence Record kind: ${record.kind}`)
  }
  const expectedRecordId =
    record.kind === 'automated'
      ? `automated-release-${sha256(canonicalJson(identity)).slice(0, 16)}`
      : `candidate-unavailable-${sha256(canonicalJson(identity)).slice(0, 16)}`
  if (record.recordId !== expectedRecordId) {
    throw new Error('Evidence Record identity does not match its content')
  }
  if (
    record.rawReportDirectory !==
    `artifacts/release-evidence/${record.recordId}/raw`
  ) {
    throw new Error('Evidence Record raw report directory does not match its identity')
  }
  const actualManifest = await createRetainedReportManifest(bundleDirectory)
  if (canonicalJson(record.bundleManifest) !== canonicalJson(actualManifest)) {
    throw new Error('retained raw report manifest does not match staged files')
  }

  const checksum = await readFile(
    resolve(bundleDirectory, 'evidence-record.sha256'),
    'utf8',
  )
  const expectedChecksum = `${sha256(recordBytes)}  evidence-record.json\n`
  if (checksum !== expectedChecksum) {
    throw new Error('evidence-record checksum does not match staged record')
  }

  const resolvedText = await readFile(
    resolve(bundleDirectory, 'compatibility.resolved.json'),
    'utf8',
  )
  const resolvedCompatibility = JSON.parse(resolvedText)
  if (canonicalJson(resolvedCompatibility) !== resolvedText) {
    throw new Error('resolved compatibility is not canonical JSON')
  }
  const evidenceRecord =
    `artifacts/release-evidence/${record.recordId}/evidence-record.json`
  if (resolvedCompatibility.evidenceRecord !== evidenceRecord) {
    throw new Error('resolved compatibility references a different Evidence Record')
  }
  if (
    record.candidate !== undefined &&
    canonicalJson(resolvedCompatibility.candidate) !== canonicalJson(record.candidate)
  ) {
    throw new Error('resolved compatibility identifies a different candidate')
  }
  if (
    !Array.isArray(resolvedCompatibility.testedLanes) ||
    canonicalJson(resolvedCompatibility.testedLanes.map(({ id }) => id)) !==
      canonicalJson(record.testedLanes)
  ) {
    throw new Error('resolved compatibility identifies different Tested Lanes')
  }
  for (const lane of resolvedCompatibility.testedLanes) {
    if (canonicalJson(lane.evidenceRecords) !== canonicalJson([evidenceRecord])) {
      throw new Error(`resolved Tested Lane references different evidence: ${lane.id}`)
    }
  }
  const normalizedResolved = structuredClone(resolvedCompatibility)
  normalizedResolved.evidenceRecord = 'SELF'
  for (const lane of normalizedResolved.testedLanes) {
    lane.evidenceRecords = ['SELF']
  }
  if (
    sha256(canonicalJson(normalizedResolved)) !==
    record.resolvedCompatibilitySha256
  ) {
    throw new Error('resolved compatibility digest does not match Evidence Record')
  }

  const expectedFiles = [
    'compatibility.resolved.json',
    'evidence-record.json',
    'evidence-record.sha256',
    ...actualManifest.map(({ path }) => path),
  ].sort()
  const actualFiles = await listFiles(bundleDirectory)
  if (canonicalJson(actualFiles) !== canonicalJson(expectedFiles)) {
    throw new Error('staged evidence bundle contains missing or extra files')
  }
  return record
}

export async function publishImmutableEvidenceBundle(
  workingDirectory,
  recordDirectory,
) {
  await verifyImmutableEvidenceBundle(workingDirectory)
  try {
    await access(recordDirectory)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    await rename(workingDirectory, recordDirectory)
    return 'created'
  }

  const expectedFiles = await listFiles(workingDirectory)
  const existingFiles = await listFiles(recordDirectory)
  const collision = () =>
    new Error(`immutable Evidence Record identity collision at ${recordDirectory}`)
  if (canonicalJson(expectedFiles) !== canonicalJson(existingFiles)) {
    throw collision()
  }
  for (const path of expectedFiles) {
    const [expected, existing] = await Promise.all([
      readFile(resolve(workingDirectory, path)),
      readFile(resolve(recordDirectory, path)),
    ])
    if (!expected.equals(existing)) throw collision()
  }
  return 'reused'
}

export function consumerLanePassed(commandResult, report, laneId, candidateSha256) {
  return (
    commandResult?.status === 'passed' &&
    report?.status === 'passed' &&
    report.candidateSha256 === candidateSha256 &&
    report.testedLanes?.includes(laneId) === true
  )
}

function automatedRecordIdentity(input, bundleManifest = input.bundleManifest) {
  return {
    candidateSha256: input.candidate.sha256,
    sourceCommit: input.source.commit,
    exampleCommit: input.source.exampleCommit,
    lockfiles: input.lockfiles,
    protocol: input.protocol,
    instrumentation: input.instrumentation,
    testedLanes: input.testedLanes,
    validationCombinations: input.validationCombinations,
    resolvedCompatibilitySha256: input.resolvedCompatibilitySha256,
    bundleManifest,
    gates: input.gates,
  }
}

function unavailableRecordIdentity(input, bundleManifest = input.bundleManifest) {
  return {
    candidate: input.candidate,
    sourceCommit: input.source.commit,
    exampleCommit: input.source.exampleCommit,
    lockfiles: input.lockfiles,
    protocol: input.protocol,
    instrumentation: input.instrumentation,
    testedLanes: input.testedLanes,
    validationCombinations: input.validationCombinations,
    resolvedCompatibilitySha256: input.resolvedCompatibilitySha256,
    bundleManifest,
    failure: input.failure,
  }
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

function assertCommonEvidenceInput(input) {
  if (!COMMIT.test(input.source?.commit ?? '')) {
    throw new TypeError('source commit must be a full Git commit')
  }
  if (!COMMIT.test(input.source?.exampleCommit ?? '')) {
    throw new TypeError('Example App commit must be a full Git commit')
  }
  if (!SHA256.test(input.protocol?.sha256 ?? '')) {
    throw new TypeError('protocol sha256 must be a lowercase SHA-256 digest')
  }
  if (!SHA256.test(input.resolvedCompatibilitySha256 ?? '')) {
    throw new TypeError('resolved compatibility digest must be a lowercase SHA-256 digest')
  }
  requireArray(input.lockfiles, 'lockfiles')
  for (const lockfile of input.lockfiles) {
    if (!SHA256.test(lockfile.sha256 ?? '')) {
      throw new TypeError(`lockfile digest is invalid: ${lockfile.path}`)
    }
  }
  requireArray(input.testedLanes, 'testedLanes')
  requireArray(input.validationCombinations, 'validationCombinations')
  requireArray(input.bundleManifest, 'bundleManifest')
  const retainedPaths = new Set()
  for (const file of input.bundleManifest) {
    if (typeof file.path !== 'string' || !file.path.startsWith('raw/')) {
      throw new TypeError('bundleManifest must contain only retained raw reports')
    }
    if (retainedPaths.has(file.path)) {
      throw new TypeError(`duplicate retained report: ${file.path}`)
    }
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 0) {
      throw new TypeError(`retained report byte count is invalid: ${file.path}`)
    }
    if (!SHA256.test(file.sha256 ?? '')) {
      throw new TypeError(`retained report digest is invalid: ${file.path}`)
    }
    retainedPaths.add(file.path)
  }
  return retainedPaths
}

function assertEvidenceInput(input) {
  if (!SHA256.test(input.candidate?.sha256 ?? '')) {
    throw new TypeError('candidate sha256 must be a lowercase SHA-256 digest')
  }
  const retainedPaths = assertCommonEvidenceInput(input)
  requireArray(input.requiredGateIds, 'requiredGateIds')
  requireArray(input.gates, 'gates')
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
    if (!retainedPaths.has(gate.report)) {
      throw new TypeError(`Release Gate report is not retained: ${gate.report}`)
    }
  }
  for (const gateId of input.requiredGateIds) {
    if (!gateById.has(gateId)) {
      throw new TypeError(`missing required Release Gate: ${gateId}`)
    }
  }
}

export function buildAutomatedEvidenceRecord(input) {
  assertEvidenceInput(input)
  const bundleManifest = [...input.bundleManifest].sort((left, right) =>
    left.path.localeCompare(right.path),
  )
  const identity = automatedRecordIdentity(input, bundleManifest)
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
    resolvedCompatibilitySha256: input.resolvedCompatibilitySha256,
    bundleManifest,
    rawReportDirectory: input.rawReportDirectory,
    gates: input.gates,
    invalidationReasons: [],
  })
}

export function buildCandidateUnavailableEvidenceRecord(input) {
  if (
    input.candidate?.availability !== 'unavailable' ||
    input.candidate.package !== '@xleepy/wrist-menu'
  ) {
    throw new TypeError('candidate must explicitly be unavailable')
  }
  if ('sha256' in input.candidate) {
    throw new TypeError('candidate-unavailable evidence must not invent a digest')
  }
  const retainedPaths = assertCommonEvidenceInput(input)
  if (
    typeof input.failure?.stage !== 'string' ||
    typeof input.failure.command !== 'string' ||
    !Number.isInteger(input.failure.exitCode) ||
    typeof input.failure.report !== 'string' ||
    !retainedPaths.has(input.failure.report)
  ) {
    throw new TypeError('candidate prerequisite failure must name its retained report')
  }
  const bundleManifest = [...input.bundleManifest].sort((left, right) =>
    left.path.localeCompare(right.path),
  )
  const identity = unavailableRecordIdentity(input, bundleManifest)
  const recordId = `candidate-unavailable-${sha256(canonicalJson(identity)).slice(0, 16)}`
  return deepFreeze({
    schemaVersion: 1,
    recordId,
    kind: 'candidate-unavailable',
    result: 'failed',
    candidate: input.candidate,
    source: input.source,
    lockfiles: input.lockfiles,
    testedLanes: input.testedLanes,
    validationCombinations: input.validationCombinations,
    protocol: input.protocol,
    instrumentation: input.instrumentation,
    resolvedCompatibilitySha256: input.resolvedCompatibilitySha256,
    bundleManifest,
    rawReportDirectory: input.rawReportDirectory,
    failure: input.failure,
    gates: [
      {
        id: 'candidate-prerequisites',
        status: 'failed',
        report: input.failure.report,
      },
    ],
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
