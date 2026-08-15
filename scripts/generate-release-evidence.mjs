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
  EXACT_ALLOCATION_INSTRUMENTATION,
  EXACT_ALLOCATION_MARKER_FILENAME,
  EXACT_ALLOCATION_MARKER_SHA256_ENV,
} from '../fixtures/consumers/exact-allocation-evidence.mjs'
import {
  evaluateAutomatedReleaseGates,
  finalizeAutomatedReleaseEvidence,
  finalizeCandidateUnavailableEvidence,
} from './release-gate-evaluation.mjs'
import {
  canonicalJson,
  createRetainedReportManifest,
  publishImmutableEvidenceBundle,
  sha256,
  validateCompatibilityManifest,
  verifyImmutableEvidenceBundle,
} from './release-evidence-lib.mjs'
import { instrumentExactPackageAllocations } from './instrument-exact-allocations.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const npmCli = process.env.npm_execpath
const artifactRoot = resolve(root, 'artifacts', 'release-evidence')
const subprocessMaxBuffer = 16 * 1024 * 1024
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
  resolve(root, 'scripts', 'instrument-exact-allocations.mjs'),
  resolve(root, 'scripts', 'deterministic-release-traces.mjs'),
  resolve(root, 'scripts', 'release-gate-evaluation.mjs'),
  resolve(root, 'fixtures', 'consumers', 'exact-allocation-evidence.mjs'),
  resolve(root, 'fixtures', 'consumers', 'import-safety.mjs'),
  resolve(root, 'fixtures', 'consumers', 'journey-evidence.mjs'),
  resolve(root, 'fixtures', 'consumers', 'runtime-evidence.mjs'),
  resolve(root, 'fixtures', 'consumers', 'performance-baseline.mjs'),
  resolve(root, 'fixtures', 'consumers', 'performance-workload.mjs'),
  resolve(root, 'fixtures', 'consumers', 'reach-scroll-workload.mjs'),
  resolve(root, 'fixtures', 'consumers', 'react-performance-baseline.mjs'),
  resolve(root, 'fixtures', 'consumers', 'react-renderer-harness.mjs'),
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
      maxBuffer: subprocessMaxBuffer,
    },
  )
  return {
    command: `npm run ${script}`,
    status: result.status === 0 ? 'passed' : 'failed',
    exitCode: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr || result.error?.message || '',
  }
}

function runNode(script, args, environment = {}, cwd = root) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...environment },
    maxBuffer: subprocessMaxBuffer,
  })
  return {
    command: `node ${relative(root, resolve(cwd, script))}`,
    status: result.status === 0 ? 'passed' : 'failed',
    exitCode: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr || result.error?.message || '',
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
  assert.deepEqual(
    protocol.allocationInstrumentation,
    EXACT_ALLOCATION_INSTRUMENTATION,
    'allocation instrumentation identity must match the automated protocol',
  )
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
      allocation: protocol.allocationInstrumentation,
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

async function main() {
  assert.ok(npmCli, 'run release evidence through npm')
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
    const finalized = finalizeCandidateUnavailableEvidence({
      evidenceContext: {
        compatibility,
        candidate,
        source,
        lockfiles,
        protocol: protocolIdentity,
        instrumentation,
      },
      bundleManifest: await createRetainedReportManifest(workingDirectory),
      failure: {
        stage,
        command: result.command,
        exitCode: result.exitCode,
        report,
      },
    })
    const {
      recordDirectory: recordDirectoryRelative,
      record,
      resolvedCompatibility,
    } = finalized
    const recordDirectory = resolve(root, recordDirectoryRelative)
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

    const instrumentedCandidateRoot = resolve(
      root,
      'fixtures',
      'consumers',
      'three',
      'node_modules',
      '@xleepy',
      'wrist-menu',
    )
    let trustedAllocationMarkerSha256
    let allocationInstrumentationResult
    try {
      const marker = await instrumentExactPackageAllocations(
        instrumentedCandidateRoot,
      )
      trustedAllocationMarkerSha256 = sha256(
        await readFile(resolve(
          instrumentedCandidateRoot,
          EXACT_ALLOCATION_MARKER_FILENAME,
        )),
      )
      allocationInstrumentationResult = {
        command: 'instrument packed candidate for exact package allocations',
        status: 'passed',
        exitCode: 0,
        stdout: JSON.stringify({
          instrumentation: marker.instrumentation,
          files: marker.files.length,
          allocationSites: marker.siteCount,
          markerSha256: trustedAllocationMarkerSha256,
        }),
        stderr: '',
      }
    } catch (error) {
      allocationInstrumentationResult = {
        command: 'instrument packed candidate for exact package allocations',
        status: 'failed',
        exitCode: 1,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
      }
    }
    await writeCommandLog(
      resolve(rawDirectory, 'exact-allocation-instrumentation-command.json'),
      allocationInstrumentationResult,
    )
    await writeFile(
      resolve(rawDirectory, 'exact-allocation-marker-trust.json'),
      canonicalJson({
        candidateSha256: candidate.sha256,
        instrumentation: EXACT_ALLOCATION_INSTRUMENTATION,
        marker: EXACT_ALLOCATION_MARKER_FILENAME,
        markerSha256: trustedAllocationMarkerSha256 ?? null,
        status:
          trustedAllocationMarkerSha256 === undefined ? 'failed' : 'passed',
      }),
    )

    const automatedResult = runNode(
      'automated-gates.mjs',
      [],
      {
        ...evidenceEnvironment,
        ...(trustedAllocationMarkerSha256 === undefined
          ? {}
          : {
              [EXACT_ALLOCATION_MARKER_SHA256_ENV]:
                trustedAllocationMarkerSha256,
            }),
      },
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
    const performanceBaselinePolicy = await readJson(baselinePath)

    const candidateIdentity = {
      package: '@xleepy/wrist-menu',
      version: '0.0.0',
      tarball: relative(root, candidate.candidatePath).replaceAll('\\', '/'),
      sha256: candidate.sha256,
    }
    const evaluation = evaluateAutomatedReleaseGates({
      evidenceContext: {
        compatibility,
        protocol: {
          ...protocolIdentity,
          requiredGateIds: protocol.requiredGateIds,
        },
        candidate: candidateIdentity,
        source,
        lockfiles,
        instrumentation,
      },
      prerequisiteResults,
      deterministicResult,
      deterministicReport,
      consumerResult,
      automatedResult,
      automatedReport,
      exampleResult,
      threeReport,
      react18Report,
      react19Report,
      importReportNames,
      importReports,
      performanceBaselinePolicy,
    })
    await writeFile(
      resolve(rawDirectory, 'import-safety.json'),
      canonicalJson(evaluation.reports.importSafety),
    )
    await writeFile(
      resolve(rawDirectory, 'scene-event-shield.json'),
      canonicalJson(evaluation.reports.sceneEventShield),
    )
    await writeFile(
      resolve(rawDirectory, 'performance-baseline.json'),
      canonicalJson(evaluation.reports.performanceBaseline),
    )
    const finalized = finalizeAutomatedReleaseEvidence(evaluation, {
      bundleManifest: await createRetainedReportManifest(workingDirectory),
    })
    const {
      recordDirectory: recordDirectoryRelative,
      record,
      resolvedCompatibility,
    } = finalized
    const recordDirectory = resolve(root, recordDirectoryRelative)

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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
