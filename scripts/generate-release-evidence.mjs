import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { digestNamedCandidate } from './candidate-tarball.mjs'
import {
  buildAutomatedEvidenceRecord,
  canonicalJson,
  sha256,
  validateCompatibilityManifest,
} from './release-evidence-lib.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const npmCli = process.env.npm_execpath
const artifactRoot = resolve(root, 'artifacts', 'release-evidence')
const protocolPath = resolve(root, 'evidence', 'protocols', 'automated-v1.json')
const baselinePath = resolve(root, 'evidence', 'baselines', 'performance-v1.json')

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

function gate(id, status, report, detail) {
  return {
    id,
    status: status === 'passed' ? 'passed' : 'failed',
    report,
    ...(detail === undefined ? {} : { detail }),
  }
}

function laneReportPassed(report, laneId) {
  return (
    report.status === 'passed' &&
    report.candidateSha256 !== undefined &&
    report.testedLanes?.includes(laneId)
  )
}

async function main() {
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

  const prerequisiteResults = []
  for (const script of [
    'clean',
    'build',
    'build:declarations',
    'check:core-types',
    'test',
    'pack:verify',
  ]) {
    const result = runNpm(script)
    prerequisiteResults.push(result)
    if (result.status === 'failed') {
      throw new Error(
        `${result.command} failed before a candidate Evidence Record could be identified:\n${result.stderr || result.stdout}`,
      )
    }
  }

  const candidate = await digestNamedCandidate(root)
  await mkdir(artifactRoot, { recursive: true })
  const workingDirectory = await mkdtemp(resolve(artifactRoot, '.run-'))
  const rawDirectory = resolve(workingDirectory, 'raw')
  await mkdir(rawDirectory)

  try {
    for (const [index, result] of prerequisiteResults.entries()) {
      await writeCommandLog(
        resolve(rawDirectory, `prerequisite-${index + 1}.json`),
        result,
      )
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
    const importReports = await Promise.all(
      [
        'core-three-import-safety.json',
        'react-18-import-safety.json',
        'react-19-import-safety.json',
      ].map((name) =>
        readJsonOr(resolve(rawDirectory, name), { status: 'failed' }),
      ),
    )

    const candidateMatches = (report) =>
      report.candidateSha256 === candidate.sha256
    const laneStates = {
      'three-0.185.1': laneReportPassed(threeReport, 'three-0.185.1') && candidateMatches(threeReport),
      'react-18.3.1-r3f-8.18.0': laneReportPassed(react18Report, 'react-18.3.1-r3f-8.18.0') && candidateMatches(react18Report),
      'react-19.2.7-r3f-9.6.1': laneReportPassed(react19Report, 'react-19.2.7-r3f-9.6.1') && candidateMatches(react19Report),
      'react-xr-6.6.30':
        laneReportPassed(react18Report, 'react-xr-6.6.30') &&
        laneReportPassed(react19Report, 'react-xr-6.6.30') &&
        candidateMatches(react18Report) &&
        candidateMatches(react19Report),
      'iwer-vanilla-hand': laneReportPassed(threeReport, 'iwer-vanilla-hand') && candidateMatches(threeReport),
      'iwer-vanilla-controller': laneReportPassed(threeReport, 'iwer-vanilla-controller') && candidateMatches(threeReport),
      'iwer-react-hand': laneReportPassed(react19Report, 'iwer-react-hand') && candidateMatches(react19Report),
      'iwer-react-controller': laneReportPassed(react19Report, 'iwer-react-controller') && candidateMatches(react19Report),
    }
    laneStates['core-import'] = importReports.every(
      ({ status, candidateSha256 }) =>
        status === 'passed' && candidateSha256 === candidate.sha256,
    )

    const automatedGate = (id) => automatedReport.gates?.[id]?.status
    const reactControllerJourney = react19Report.journeys?.find(
      ({ id }) => id === 'iwer-react-controller',
    )
    const gates = [
      gate('deterministic-boundaries', deterministicReport.status, 'raw/deterministic-boundaries.json'),
      gate('core-behavior', prerequisiteResults[4].status, 'raw/prerequisite-5.json'),
      gate('import-safety', laneStates['core-import'] ? 'passed' : 'failed', 'raw/core-three-import-safety.json'),
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
        reactControllerJourney?.sceneShield?.blockedWhileMenuOwned === true &&
          reactControllerJourney.sceneShield.behindTargetLiveAfterUnmount === true
          ? 'passed'
          : 'failed',
        'raw/react-19-xr-iwer-lanes.json',
      ),
      gate('example-packed-consumer', exampleResult.status, 'raw/packed-example-command.json'),
    ]

    const lockfilePaths = [
      'package-lock.json',
      'fixtures/consumers/three/package-lock.json',
      'fixtures/consumers/react-18/package-lock.json',
      'fixtures/consumers/react-19/package-lock.json',
      'examples/primitive-workshop/package-lock.json',
    ]
    const lockfiles = await Promise.all(
      lockfilePaths.map(async (path) => ({
        path,
        sha256: await fileDigest(resolve(root, path)),
      })),
    )
    const instrumentationSha256 = await compositeDigest([
      resolve(root, 'scripts', 'deterministic-release-traces.mjs'),
      resolve(root, 'fixtures', 'consumers', 'controller-action-journey.mjs'),
      resolve(root, 'fixtures', 'consumers', 'three', 'automated-gates.mjs'),
      baselinePath,
    ])
    const recordInput = {
      candidate: {
        package: '@xleepy/wrist-menu',
        version: '0.0.0',
        tarball: relative(root, candidate.candidatePath).replaceAll('\\', '/'),
        sha256: candidate.sha256,
      },
      source: {
        commit: sourceCommit,
        exampleCommit: sourceCommit,
        exampleLocation: 'in-repository-packed-public-consumer',
        committedAt,
      },
      lockfiles,
      protocol: {
        id: protocol.id,
        version: protocol.version,
        sha256: sha256(protocolBytes),
      },
      instrumentation: {
        id: 'node-iwer-three-counters',
        version: protocol.instrumentationVersion,
        sha256: instrumentationSha256,
        baselineSha256: await fileDigest(baselinePath),
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
      },
      rawReportDirectory: 'RAW_DIRECTORY_PLACEHOLDER',
      requiredGateIds: protocol.requiredGateIds,
      gates,
      testedLanes: compatibility.testedLanes.map(({ id }) => id),
      validationCombinations: [],
    }
    const preliminary = buildAutomatedEvidenceRecord(recordInput)
    const recordDirectoryRelative = `artifacts/release-evidence/${preliminary.recordId}`
    const record = buildAutomatedEvidenceRecord({
      ...recordInput,
      rawReportDirectory: `${recordDirectoryRelative}/raw`,
    })
    const recordDirectory = resolve(root, recordDirectoryRelative)
    const recordPath = resolve(recordDirectory, 'evidence-record.json')
    const resolvedCompatibility = {
      ...compatibility,
      candidate: record.candidate,
      evidenceRecord: `${recordDirectoryRelative}/evidence-record.json`,
      testedLanes: compatibility.testedLanes.map((lane) => ({
        ...lane,
        status: laneStates[lane.id] ? 'passed' : 'failed',
        evidenceRecords: [`${recordDirectoryRelative}/evidence-record.json`],
      })),
    }

    const canonicalRecord = canonicalJson(record)
    const canonicalResolvedCompatibility = canonicalJson(resolvedCompatibility)
    await writeFile(
      resolve(workingDirectory, 'evidence-record.json'),
      canonicalRecord,
      { flag: 'wx' },
    )
    await writeFile(
      resolve(workingDirectory, 'compatibility.resolved.json'),
      canonicalResolvedCompatibility,
      { flag: 'wx' },
    )
    await writeFile(
      resolve(workingDirectory, 'evidence-record.sha256'),
      `${sha256(canonicalRecord)}  evidence-record.json\n`,
      { flag: 'wx' },
    )

    try {
      await access(recordPath)
      const existing = await readFile(recordPath, 'utf8')
      const existingResolved = await readFile(
        resolve(recordDirectory, 'compatibility.resolved.json'),
        'utf8',
      )
      if (
        existing !== canonicalRecord ||
        existingResolved !== canonicalResolvedCompatibility
      ) {
        throw new Error(
          `immutable Evidence Record identity collision at ${recordDirectoryRelative}`,
        )
      }
      console.log(`verified reproducible ${record.recordId}`)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      await rename(workingDirectory, recordDirectory)
      console.log(`wrote immutable ${record.recordId} to ${recordDirectoryRelative}`)
    }

    console.log(`automated release evidence result: ${record.result}`)
    if (record.result !== 'passed') process.exitCode = 1
  } finally {
    await rm(workingDirectory, { recursive: true, force: true })
  }
}

await main()
