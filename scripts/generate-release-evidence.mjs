import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { digestNamedCandidate } from './candidate-tarball.mjs'
import {
  buildAutomatedEvidenceRecord,
  buildCandidateUnavailableEvidenceRecord,
  canonicalJson,
  consumerLanePassed,
  createRetainedReportManifest,
  publishImmutableEvidenceBundle,
  sha256,
  validateCompatibilityManifest,
  verifyImmutableEvidenceBundle,
} from './release-evidence-lib.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const npmCli = process.env.npm_execpath
const artifactRoot = resolve(root, 'artifacts', 'release-evidence')
const protocolPath = resolve(root, 'evidence', 'protocols', 'automated-v1.json')
const baselinePath = resolve(root, 'evidence', 'baselines', 'performance-v1.json')
const lockfilePaths = [
  'package-lock.json',
  'fixtures/consumers/three/package-lock.json',
  'fixtures/consumers/react-18/package-lock.json',
  'fixtures/consumers/react-19/package-lock.json',
  'examples/primitive-workshop/package-lock.json',
]
const instrumentationPaths = [
  resolve(root, 'scripts', 'deterministic-release-traces.mjs'),
  resolve(root, 'fixtures', 'consumers', 'import-safety.mjs'),
  resolve(root, 'fixtures', 'consumers', 'journey-evidence.mjs'),
  resolve(root, 'fixtures', 'consumers', 'runtime-evidence.mjs'),
  resolve(root, 'fixtures', 'consumers', 'controller-action-journey.mjs'),
  resolve(root, 'fixtures', 'consumers', 'three', 'import-safety.mjs'),
  resolve(root, 'fixtures', 'consumers', 'three', 'smoke.mjs'),
  resolve(root, 'fixtures', 'consumers', 'three', 'automated-gates.mjs'),
  resolve(root, 'fixtures', 'consumers', 'react-18', 'import-safety.mjs'),
  resolve(root, 'fixtures', 'consumers', 'react-18', 'smoke.mjs'),
  resolve(root, 'fixtures', 'consumers', 'react-19', 'import-safety.mjs'),
  resolve(root, 'fixtures', 'consumers', 'react-19', 'smoke.mjs'),
  baselinePath,
]
const journeyCaseIds = [
  'both-wrists',
  'scrolling',
  'invalid-disabled',
  'tracking-loss',
  'input-switching',
  'visibility-session-reentry',
  'empty-unavailable',
]
const sceneShieldCaseIds = [
  'commit',
  'cancel',
  'hold',
  'leave-before-release',
  'rapid-actions',
]
const sceneActionTypes = [
  'pointerdown',
  'pointerup',
  'click',
  'dblclick',
  'contextmenu',
]

assert.ok(npmCli, 'run release evidence through npm')

function git(...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout)
  return result.stdout.trim()
}

function runNpm(script, environment = {}) {
  const result = spawnSync(
    process.execPath,
    [npmCli, 'run', script],
    {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, ...environment },
    },
  )
  return {
    command: `npm run ${script}`,
    status: result.status === 0 ? 'passed' : 'failed',
    exitCode: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function runNode(script, args, environment = {}, cwd = root) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...environment },
  })
  return {
    command: `node ${relative(root, resolve(cwd, script))}`,
    status: result.status === 0 ? 'passed' : 'failed',
    exitCode: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

async function writeCommandLog(path, result) {
  await writeFile(
    path,
    canonicalJson({
      command: result.command,
      exitCode: result.exitCode,
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    }),
  )
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function readJsonOr(path, fallback) {
  try {
    return await readJson(path)
  } catch {
    return fallback
  }
}

async function fileDigest(path) {
  return sha256(await readFile(path))
}

async function compositeDigest(paths) {
  const hash = createHash('sha256')
  for (const path of [...paths].sort()) {
    hash.update(relative(root, path))
    hash.update(await readFile(path))
  }
  return hash.digest('hex')
}

async function releaseIdentity(protocol) {
  return {
    lockfiles: await Promise.all(
      lockfilePaths.map(async (path) => ({
        path,
        sha256: await fileDigest(resolve(root, path)),
      })),
    ),
    instrumentation: {
      id: 'node-iwer-three-counters',
      version: protocol.instrumentationVersion,
      sha256: await compositeDigest(instrumentationPaths),
      baselineSha256: await fileDigest(baselinePath),
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
    },
  }
}

async function stageAndPublishRecord({
  workingDirectory,
  recordDirectory,
  record,
  resolvedCompatibility,
}) {
  const canonicalRecord = canonicalJson(record)
  await writeFile(
    resolve(workingDirectory, 'evidence-record.json'),
    canonicalRecord,
    { flag: 'wx' },
  )
  await writeFile(
    resolve(workingDirectory, 'compatibility.resolved.json'),
    canonicalJson(resolvedCompatibility),
    { flag: 'wx' },
  )
  await writeFile(
    resolve(workingDirectory, 'evidence-record.sha256'),
    `${sha256(canonicalRecord)}  evidence-record.json\n`,
    { flag: 'wx' },
  )
  return publishImmutableEvidenceBundle(workingDirectory, recordDirectory)
}

function gate(id, status, report, detail) {
  return {
    id,
    status: status === 'passed' ? 'passed' : 'failed',
    report,
    ...(detail === undefined ? {} : { detail }),
  }
}

function resolveCompatibilityEvidence(
  compatibility,
  candidate,
  laneStates,
  evidenceRecord,
) {
  return {
    ...compatibility,
    candidate,
    evidenceRecord,
    testedLanes: compatibility.testedLanes.map((lane) => ({
      ...lane,
      status: laneStates[lane.id] ? 'passed' : 'failed',
      evidenceRecords: [evidenceRecord],
    })),
  }
}

function sameOrderedValues(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  )
}

function journeyCombinationPassed(report, integration, sourceKind) {
  const journey = report?.journeys?.find(
    ({ sceneEventShield }) =>
      sceneEventShield?.rendererIntegration === integration &&
      sceneEventShield.selectionSourceKind === sourceKind,
  )
  const coverage = journey?.coverage
  const shield = journey?.sceneEventShield
  const semanticCases = coverage?.semanticCases
  const shieldCases = shield?.cases
  const actualIntegrationPassed =
    integration === 'three'
      ? journey?.blockedSceneActions === 0
      : shield?.actualFiberCommit?.blockedSceneActions === 0 &&
        (sourceKind !== 'controller' ||
          shield.actualFiberCommit.behindTargetLiveAfterUnmount === true)

  return (
    report?.status === 'passed' &&
    journey?.status === 'passed' &&
    coverage?.status === 'passed' &&
    sameOrderedValues(
      semanticCases?.map(({ id }) => id),
      journeyCaseIds,
    ) &&
    semanticCases.every(({ status }) => status === 'passed') &&
    shield?.status === 'passed' &&
    sameOrderedValues(shield.actionTypes, sceneActionTypes) &&
    sameOrderedValues(
      shieldCases?.map(({ id }) => id),
      sceneShieldCaseIds,
    ) &&
    shieldCases.every(
      ({ status, observations }) =>
        status === 'passed' &&
        sameOrderedValues(
          observations?.sceneActions?.map(({ type }) => type),
          sceneActionTypes,
        ) &&
        observations.sceneActions.every(({ blocked }) => blocked === true),
    ) &&
    actualIntegrationPassed
  )
}

async function main() {
  const arguments_ = process.argv.slice(2)
  if (arguments_[0] === '--verify') {
    const recordId = arguments_[1]
    if (
      arguments_.length !== 2 ||
      !/^(?:automated-release|candidate-unavailable)-[a-f0-9]{16}$/.test(recordId)
    ) {
      throw new TypeError(
        'usage: npm run evidence -- --verify <immutable-record-id>',
      )
    }
    const recordDirectory = resolve(artifactRoot, recordId)
    const record = await verifyImmutableEvidenceBundle(recordDirectory)
    console.log(`verified immutable ${record.recordId}`)
    console.log(`automated release evidence result: ${record.result}`)
    return
  }
  if (arguments_.length !== 0) {
    throw new TypeError('usage: npm run evidence [-- --verify <immutable-record-id>]')
  }

  const dirty = git('status', '--porcelain', '--untracked-files=normal')
  if (dirty !== '') {
    throw new Error(
      `release evidence requires a clean committed worktree:\n${dirty}`,
    )
  }

  const sourceCommit = git('rev-parse', 'HEAD')
  const committedAt = git('show', '-s', '--format=%cI', 'HEAD')
  const compatibility = validateCompatibilityManifest(
    await readJson(resolve(root, 'compatibility.json')),
  )
  const protocolBytes = await readFile(protocolPath)
  const protocol = JSON.parse(protocolBytes)
  const source = {
    commit: sourceCommit,
    exampleCommit: sourceCommit,
    exampleLocation: 'in-repository-packed-public-consumer',
    committedAt,
  }
  const protocolIdentity = {
    id: protocol.id,
    version: protocol.version,
    sha256: sha256(protocolBytes),
  }
  const testedLanes = compatibility.testedLanes.map(({ id }) => id)
  const { lockfiles, instrumentation } = await releaseIdentity(protocol)

  await mkdir(artifactRoot, { recursive: true })
  const workingDirectory = await mkdtemp(resolve(artifactRoot, '.run-'))
  const rawDirectory = resolve(workingDirectory, 'raw')
  await mkdir(rawDirectory)

  const prerequisiteResults = []
  const publishCandidateUnavailable = async ({ stage, result, report }) => {
    const candidate = {
      package: '@xleepy/wrist-menu',
      version: '0.0.0',
      availability: 'unavailable',
    }
    const laneStates = Object.fromEntries(testedLanes.map((id) => [id, false]))
    const resolvedCompatibilityTemplate = resolveCompatibilityEvidence(
      compatibility,
      candidate,
      laneStates,
      'SELF',
    )
    const unavailableInput = {
      candidate,
      source,
      lockfiles,
      protocol: protocolIdentity,
      instrumentation,
      testedLanes,
      validationCombinations: [],
      resolvedCompatibilitySha256: sha256(
        canonicalJson(resolvedCompatibilityTemplate),
      ),
      bundleManifest: await createRetainedReportManifest(workingDirectory),
      rawReportDirectory: 'RAW_DIRECTORY_PLACEHOLDER',
      failure: {
        stage,
        command: result.command,
        exitCode: result.exitCode,
        report,
      },
    }
    const preliminary = buildCandidateUnavailableEvidenceRecord(unavailableInput)
    const recordDirectoryRelative = `artifacts/release-evidence/${preliminary.recordId}`
    const record = buildCandidateUnavailableEvidenceRecord({
      ...unavailableInput,
      rawReportDirectory: `${recordDirectoryRelative}/raw`,
    })
    const recordDirectory = resolve(root, recordDirectoryRelative)
    const evidenceRecord = `${recordDirectoryRelative}/evidence-record.json`
    const resolvedCompatibility = resolveCompatibilityEvidence(
      compatibility,
      record.candidate,
      laneStates,
      evidenceRecord,
    )
    const publishResult = await stageAndPublishRecord({
      workingDirectory,
      recordDirectory,
      record,
      resolvedCompatibility,
    })
    console.log(
      publishResult === 'reused'
        ? `verified reproducible ${record.recordId}`
        : `wrote immutable ${record.recordId} to ${recordDirectoryRelative}`,
    )
    console.log(`automated release evidence result: ${record.result}`)
  }
  try {
    const prerequisiteScripts = [
      'clean',
      'build',
      'build:declarations',
      'check:core-types',
      'test',
      'pack:verify',
    ]
    for (const [index, script] of prerequisiteScripts.entries()) {
      const result = runNpm(script)
      prerequisiteResults.push(result)
      const report = `raw/prerequisite-${index + 1}.json`
      await writeCommandLog(
        resolve(workingDirectory, report),
        result,
      )
      if (result.status === 'failed') {
        await publishCandidateUnavailable({ stage: script, result, report })
        process.exitCode = 1
        return
      }
    }

    let candidate
    try {
      candidate = await digestNamedCandidate(root)
    } catch (error) {
      const result = {
        command: 'digest packed candidate',
        status: 'failed',
        exitCode: 1,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
      }
      const report = 'raw/candidate-digest.json'
      await writeCommandLog(resolve(workingDirectory, report), result)
      await publishCandidateUnavailable({
        stage: 'candidate-digest',
        result,
        report,
      })
      process.exitCode = 1
      return
    }

    const deterministicPath = resolve(rawDirectory, 'deterministic-boundaries.json')
    const deterministicResult = runNode(
      'scripts/deterministic-release-traces.mjs',
      ['--output', deterministicPath],
    )
    await writeCommandLog(
      resolve(rawDirectory, 'deterministic-boundaries-command.json'),
      deterministicResult,
    )

    const evidenceEnvironment = {
      WRIST_MENU_EVIDENCE_DIRECTORY: rawDirectory,
    }
    const consumerResult = runNpm('test:consumers', evidenceEnvironment)
    await writeCommandLog(
      resolve(rawDirectory, 'packed-consumers-command.json'),
      consumerResult,
    )

    const automatedResult = runNode(
      'automated-gates.mjs',
      [],
      evidenceEnvironment,
      resolve(root, 'fixtures', 'consumers', 'three'),
    )
    await writeCommandLog(
      resolve(rawDirectory, 'automated-package-gates-command.json'),
      automatedResult,
    )

    const exampleResult = runNpm('test:examples')
    await writeCommandLog(
      resolve(rawDirectory, 'packed-example-command.json'),
      exampleResult,
    )

    const deterministicReport = await readJsonOr(deterministicPath, {
      status: 'failed',
    })
    const threeReport = await readJsonOr(
      resolve(rawDirectory, 'three-iwer-lanes.json'),
      { status: 'failed' },
    )
    const react18Report = await readJsonOr(
      resolve(rawDirectory, 'react-18-xr-iwer-lanes.json'),
      { status: 'failed' },
    )
    const react19Report = await readJsonOr(
      resolve(rawDirectory, 'react-19-xr-iwer-lanes.json'),
      { status: 'failed' },
    )
    const automatedReport = await readJsonOr(
      resolve(rawDirectory, 'automated-package-gates.json'),
      { gates: {} },
    )
    const importReportNames = [
      'core-three-import-safety.json',
      'react-18-import-safety.json',
      'react-19-import-safety.json',
    ]
    const importReports = await Promise.all(
      importReportNames.map((name) =>
        readJsonOr(resolve(rawDirectory, name), { status: 'failed' }),
      ),
    )

    const laneStates = {
      'three-0.185.1': consumerLanePassed(consumerResult, threeReport, 'three-0.185.1', candidate.sha256),
      'react-18.3.1-r3f-8.18.0': consumerLanePassed(consumerResult, react18Report, 'react-18.3.1-r3f-8.18.0', candidate.sha256),
      'react-19.2.7-r3f-9.6.1': consumerLanePassed(consumerResult, react19Report, 'react-19.2.7-r3f-9.6.1', candidate.sha256),
      'react-xr-6.6.30':
        consumerLanePassed(consumerResult, react18Report, 'react-xr-6.6.30', candidate.sha256) &&
        consumerLanePassed(consumerResult, react19Report, 'react-xr-6.6.30', candidate.sha256),
      'iwer-vanilla-hand': consumerLanePassed(consumerResult, threeReport, 'iwer-vanilla-hand', candidate.sha256),
      'iwer-vanilla-controller': consumerLanePassed(consumerResult, threeReport, 'iwer-vanilla-controller', candidate.sha256),
      'iwer-react-hand': consumerLanePassed(consumerResult, react19Report, 'iwer-react-hand', candidate.sha256),
      'iwer-react-controller': consumerLanePassed(consumerResult, react19Report, 'iwer-react-controller', candidate.sha256),
    }
    laneStates['core-import'] = consumerResult.status === 'passed' && importReports.every(
      ({ status, candidateSha256 }) =>
        status === 'passed' && candidateSha256 === candidate.sha256,
    )
    await writeFile(
      resolve(rawDirectory, 'import-safety.json'),
      canonicalJson({
        candidateSha256: candidate.sha256,
        status: laneStates['core-import'] ? 'passed' : 'failed',
        reports: importReportNames.map((name, index) => ({
          report: `raw/${name}`,
          status:
            consumerResult.status === 'passed' &&
            importReports[index]?.status === 'passed' &&
            importReports[index]?.candidateSha256 === candidate.sha256
              ? 'passed'
              : 'failed',
        })),
      }),
    )

    const sceneShieldCombinations = [
      {
        id: 'three-hand',
        report: threeReport,
        reportPath: 'raw/three-iwer-lanes.json',
        lanePassed: laneStates['three-0.185.1'],
        integration: 'three',
        sourceKind: 'hand',
      },
      {
        id: 'three-controller',
        report: threeReport,
        reportPath: 'raw/three-iwer-lanes.json',
        lanePassed: laneStates['three-0.185.1'],
        integration: 'three',
        sourceKind: 'controller',
      },
      {
        id: 'react-18-hand',
        report: react18Report,
        reportPath: 'raw/react-18-xr-iwer-lanes.json',
        lanePassed: laneStates['react-18.3.1-r3f-8.18.0'],
        integration: 'react',
        sourceKind: 'hand',
      },
      {
        id: 'react-18-controller',
        report: react18Report,
        reportPath: 'raw/react-18-xr-iwer-lanes.json',
        lanePassed: laneStates['react-18.3.1-r3f-8.18.0'],
        integration: 'react',
        sourceKind: 'controller',
      },
      {
        id: 'react-19-hand',
        report: react19Report,
        reportPath: 'raw/react-19-xr-iwer-lanes.json',
        lanePassed: laneStates['react-19.2.7-r3f-9.6.1'],
        integration: 'react',
        sourceKind: 'hand',
      },
      {
        id: 'react-19-controller',
        report: react19Report,
        reportPath: 'raw/react-19-xr-iwer-lanes.json',
        lanePassed: laneStates['react-19.2.7-r3f-9.6.1'],
        integration: 'react',
        sourceKind: 'controller',
      },
    ].map(
      ({ id, report, reportPath, lanePassed, integration, sourceKind }) => ({
        id,
        integration,
        sourceKind,
        report: reportPath,
        status:
          lanePassed &&
          journeyCombinationPassed(report, integration, sourceKind)
            ? 'passed'
            : 'failed',
      }),
    )
    const sceneShieldStatus = sceneShieldCombinations.every(
      ({ status }) => status === 'passed',
    )
      ? 'passed'
      : 'failed'
    await writeFile(
      resolve(rawDirectory, 'scene-event-shield.json'),
      canonicalJson({
        candidateSha256: candidate.sha256,
        status: sceneShieldStatus,
        combinations: sceneShieldCombinations,
      }),
    )

    const automatedGate = (id) =>
      automatedResult.status === 'passed'
        ? automatedReport.gates?.[id]?.status
        : 'failed'
    const gates = [
      gate(
        'deterministic-boundaries',
        deterministicResult.status === 'passed' ? deterministicReport.status : 'failed',
        'raw/deterministic-boundaries.json',
      ),
      gate('core-behavior', prerequisiteResults[4].status, 'raw/prerequisite-5.json'),
      gate(
        'import-safety',
        laneStates['core-import'] ? 'passed' : 'failed',
        'raw/import-safety.json',
      ),
      gate('three-consumer', laneStates['three-0.185.1'] ? 'passed' : 'failed', 'raw/three-iwer-lanes.json'),
      gate('react-18-consumer', laneStates['react-18.3.1-r3f-8.18.0'] ? 'passed' : 'failed', 'raw/react-18-xr-iwer-lanes.json'),
      gate('react-19-consumer', laneStates['react-19.2.7-r3f-9.6.1'] ? 'passed' : 'failed', 'raw/react-19-xr-iwer-lanes.json'),
      gate('react-xr', laneStates['react-xr-6.6.30'] ? 'passed' : 'failed', 'raw/react-19-xr-iwer-lanes.json'),
      gate(
        'iwer-four-lanes',
        [
          'iwer-vanilla-hand',
          'iwer-vanilla-controller',
          'iwer-react-hand',
          'iwer-react-controller',
        ].every((id) => laneStates[id])
          ? 'passed'
          : 'failed',
        'raw/packed-consumers-command.json',
      ),
      ...[
        'allocation',
        'identical-frame-mutation',
        'resource-growth',
        'lifecycle-leak',
        'performance-baseline',
      ].map((id) =>
        gate(
          id,
          automatedGate(id),
          'raw/automated-package-gates.json',
          automatedReport.gates?.[id]?.reason,
        ),
      ),
      gate(
        'scene-event-shield',
        sceneShieldStatus,
        'raw/scene-event-shield.json',
      ),
      gate('example-packed-consumer', exampleResult.status, 'raw/packed-example-command.json'),
    ]

    const candidateIdentity = {
      package: '@xleepy/wrist-menu',
      version: '0.0.0',
      tarball: relative(root, candidate.candidatePath).replaceAll('\\', '/'),
      sha256: candidate.sha256,
    }
    const recordInput = {
      candidate: candidateIdentity,
      source,
      lockfiles,
      protocol: protocolIdentity,
      instrumentation,
      rawReportDirectory: 'RAW_DIRECTORY_PLACEHOLDER',
      requiredGateIds: protocol.requiredGateIds,
      gates,
      testedLanes,
      validationCombinations: [],
      resolvedCompatibilitySha256: sha256(
        canonicalJson(
          resolveCompatibilityEvidence(
            compatibility,
            candidateIdentity,
            laneStates,
            'SELF',
          ),
        ),
      ),
      bundleManifest: await createRetainedReportManifest(workingDirectory),
    }
    const preliminary = buildAutomatedEvidenceRecord(recordInput)
    const recordDirectoryRelative = `artifacts/release-evidence/${preliminary.recordId}`
    const record = buildAutomatedEvidenceRecord({
      ...recordInput,
      rawReportDirectory: `${recordDirectoryRelative}/raw`,
    })
    const recordDirectory = resolve(root, recordDirectoryRelative)
    const resolvedCompatibility = resolveCompatibilityEvidence(
      compatibility,
      record.candidate,
      laneStates,
      `${recordDirectoryRelative}/evidence-record.json`,
    )

    const publishResult = await stageAndPublishRecord({
      workingDirectory,
      recordDirectory,
      record,
      resolvedCompatibility,
    })
    if (publishResult === 'reused') {
      console.log(`verified reproducible ${record.recordId}`)
    } else {
      console.log(`wrote immutable ${record.recordId} to ${recordDirectoryRelative}`)
    }

    console.log(`automated release evidence result: ${record.result}`)
    if (record.result !== 'passed') process.exitCode = 1
  } finally {
    await rm(workingDirectory, { recursive: true, force: true })
  }
}

await main()
