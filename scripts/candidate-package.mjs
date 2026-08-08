import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  access,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'

import { APPROVED_PACKAGE_FILES } from './approved-package-files.mjs'
import {
  inventoryRegularFiles,
  requireSafeRelativePath,
} from './safe-files.mjs'
import {
  extractApprovedNpmPackageArchive,
  inspectApprovedNpmPackageArchive,
} from './safe-tar.mjs'
import {
  canonicalJson,
  sha256,
  verifyImmutableEvidenceBundle,
} from './release-evidence-lib.mjs'

const SHA256 = /^[a-f0-9]{64}$/
const COMMIT = /^[a-f0-9]{40}$/
export const PREDECESSOR_EVIDENCE_ID =
  'automated-release-d5827ff6fbbe7c67'
export const PREDECESSOR_SOURCE_COMMIT =
  '6d57b41b3f28a981f2c88e9f7c3cd5dd0a8d7c91'

function requireIdentity(value, pattern, label) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new TypeError(`${label} must be an exact lowercase identity`)
  }
  return value
}

export function verifyCandidateFileList(filePaths) {
  const actual = [...filePaths].sort()
  assert.deepEqual(
    actual,
    APPROVED_PACKAGE_FILES,
    'candidate package file list differs from the approved payload',
  )
}

/** Build the generated documentation index without changing evidence meaning. */
export function createCandidateEvidenceIndex({
  candidate,
  candidateSource,
  predecessorRecord,
}) {
  const candidateSha256 = requireIdentity(
    candidate?.sha256,
    SHA256,
    'candidate sha256',
  )
  const candidateCommit = requireIdentity(
    candidateSource?.commit,
    COMMIT,
    'candidate source commit',
  )
  const evidenceSourceCommit = requireIdentity(
    predecessorRecord?.source?.commit,
    COMMIT,
    'evidence source commit',
  )
  const exampleRevision = requireIdentity(
    predecessorRecord?.source?.exampleCommit,
    COMMIT,
    'Example App revision',
  )
  const evidenceCandidateSha256 = requireIdentity(
    predecessorRecord?.candidate?.sha256,
    SHA256,
    'evidence candidate sha256',
  )

  if (predecessorRecord?.result !== 'failed') {
    throw new TypeError('predecessor Evidence Record must retain its failed result')
  }
  if (!Array.isArray(predecessorRecord.gates)) {
    throw new TypeError('predecessor Evidence Record must contain Release Gates')
  }
  if ((predecessorRecord.validationCombinations?.length ?? 0) !== 0) {
    throw new TypeError('automated evidence must not imply physical validation')
  }

  const appliesToCandidate =
    candidateSha256 === evidenceCandidateSha256 &&
    candidateCommit === evidenceSourceCommit

  return {
    schemaVersion: 1,
    candidate: {
      package: candidate.package,
      version: candidate.version,
      sha256: candidateSha256,
      sourceCommit: candidateCommit,
      worktreeClean: candidateSource.worktreeClean === true,
    },
    exampleApp: {
      revision: exampleRevision,
      relation: 'exact-predecessor-evaluated-revision',
    },
    evidence: {
      recordId: predecessorRecord.recordId,
      result: 'failed',
      sourceCommit: evidenceSourceCommit,
      candidateSha256: evidenceCandidateSha256,
      appliesToCandidate,
      failedGates: predecessorRecord.gates
        .filter(({ status }) => status === 'failed')
        .map(({ id, detail }) => ({ id, ...(detail === undefined ? {} : { detail }) })),
    },
    compatibilityClaimsPromoted: false,
  }
}

async function fileManifest(directory, excluded = new Set()) {
  const files = (await inventoryRegularFiles(directory)).filter(
    (path) => !excluded.has(path),
  )
  return Promise.all(
    files.map(async (path) => {
      const bytes = await readFile(resolve(directory, path))
      return { path, bytes: bytes.byteLength, sha256: sha256(bytes) }
    }),
  )
}

async function directoryDigest(directory) {
  return sha256(canonicalJson(await fileManifest(directory)))
}

async function readCanonicalJson(path, label) {
  const text = await readFile(path, 'utf8')
  const value = JSON.parse(text)
  if (canonicalJson(value) !== text) {
    throw new Error(`${label} is not canonical JSON`)
  }
  return value
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
}

function gitBytes(root, args) {
  return execFileSync('git', args, { cwd: root })
}

export async function captureCandidateSourceState(root) {
  const commit = git(root, ['rev-parse', 'HEAD'])
  requireIdentity(commit, COMMIT, 'candidate source commit')
  const status = gitBytes(root, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
  ])
  const diff = gitBytes(root, ['diff', '--binary', '--no-ext-diff', 'HEAD', '--'])
  const untrackedOutput = gitBytes(root, [
    'ls-files',
    '--others',
    '--exclude-standard',
    '-z',
  ])
  const untrackedPaths = untrackedOutput
    .toString('utf8')
    .split('\0')
    .filter((path) => path.length > 0)
    .map((path) => requireSafeRelativePath(path, 'untracked source path'))
    .sort()
  const untracked = await Promise.all(
    untrackedPaths.map(async (path) => ({
      path,
      sha256: sha256(await readFile(resolve(root, ...path.split('/')))),
    })),
  )
  return {
    commit,
    clean: status.length === 0,
    statusSha256: sha256(status),
    diffSha256: sha256(diff),
    untrackedSha256: sha256(canonicalJson(untracked)),
  }
}

export function assertCandidateSourceUnchanged(before, after) {
  if (canonicalJson(before) !== canonicalJson(after)) {
    throw new Error('candidate source changed while the bundle was staged')
  }
}

async function approvedPackageInputManifest(root) {
  return Promise.all(
    APPROVED_PACKAGE_FILES.map(async (path) => {
      requireSafeRelativePath(path, 'approved package input')
      const file = resolve(root, ...path.split('/'))
      const stat = await lstat(file)
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new TypeError(`approved package input is not a regular file: ${path}`)
      }
      const bytes = await readFile(file)
      return { path, bytes: bytes.byteLength, sha256: sha256(bytes) }
    }),
  )
}

async function captureCandidateBuildInputs(root) {
  const versionedDocs = resolve(root, 'docs', '0.0.0')
  const fixture = resolve(root, 'fixtures', 'candidate-docs')
  const validationGates = await readFile(resolve(root, 'docs', 'validation-gates.md'))
  return {
    packageSha256: sha256(canonicalJson(await approvedPackageInputManifest(root))),
    versionedDocsSha256: await directoryDigest(versionedDocs),
    fixtureSha256: await directoryDigest(fixture),
    validationGatesSha256: sha256(validationGates),
  }
}

function candidateBundleId(identity) {
  return `candidate-${sha256(canonicalJson(identity)).slice(0, 16)}`
}

async function pathExists(path) {
  try {
    await access(path)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function writeCandidateManifest(bundleDirectory) {
  const excluded = new Set(['bundle-manifest.json', 'bundle-manifest.sha256'])
  const manifestText = canonicalJson(await fileManifest(bundleDirectory, excluded))
  await writeFile(resolve(bundleDirectory, 'bundle-manifest.json'), manifestText)
  await writeFile(
    resolve(bundleDirectory, 'bundle-manifest.sha256'),
    `${sha256(manifestText)}  bundle-manifest.json\n`,
  )
}

async function verifyVersionedDocumentationLinks(bundleDirectory) {
  const docsDirectory = resolve(bundleDirectory, 'documentation', '0.0.0')
  const markdownFiles = (await inventoryRegularFiles(docsDirectory)).filter(
    (path) => path.endsWith('.md'),
  )
  for (const path of markdownFiles) {
    const documentPath = resolve(docsDirectory, ...path.split('/'))
    const markdown = await readFile(documentPath, 'utf8')
    for (const match of markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/gu)) {
      const target = match[1].trim()
      if (/^(?:https?:|mailto:|#)/u.test(target)) continue
      const pathWithoutFragment = target.split('#', 1)[0]
      const resolvedTarget = resolve(
        dirname(documentPath),
        ...decodeURIComponent(pathWithoutFragment).split('/'),
      )
      const bundleRelative = relative(bundleDirectory, resolvedTarget).replaceAll(
        '\\',
        '/',
      )
      if (bundleRelative === '..' || bundleRelative.startsWith('../')) {
        throw new Error(`documentation link escapes the candidate bundle: ${target}`)
      }
      const stat = await lstat(resolvedTarget)
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error(`documentation link is not a bundled file: ${target}`)
      }
    }
  }
}

export async function verifyCandidateBundle(bundleDirectory) {
  const manifestBytes = await readFile(
    resolve(bundleDirectory, 'bundle-manifest.json'),
  )
  const manifestText = manifestBytes.toString('utf8')
  const expectedManifest = JSON.parse(manifestText)
  if (canonicalJson(expectedManifest) !== manifestText) {
    throw new Error('candidate bundle manifest is not canonical JSON')
  }
  const actualManifest = await fileManifest(
    bundleDirectory,
    new Set(['bundle-manifest.json', 'bundle-manifest.sha256']),
  )
  assert.deepEqual(actualManifest, expectedManifest, 'candidate bundle bytes changed')
  const checksum = await readFile(
    resolve(bundleDirectory, 'bundle-manifest.sha256'),
    'utf8',
  )
  assert.equal(
    checksum,
    `${sha256(manifestBytes)}  bundle-manifest.json\n`,
    'candidate bundle manifest checksum changed',
  )

  const packageDirectory = resolve(bundleDirectory, 'package')
  assert.equal(
    (await lstat(packageDirectory)).isDirectory(),
    true,
    'candidate package must be extracted',
  )
  verifyCandidateFileList(await inventoryRegularFiles(packageDirectory))

  const candidate = await readCanonicalJson(
    resolve(bundleDirectory, 'candidate.json'),
    'candidate identity',
  )
  assert.equal(
    basename(bundleDirectory),
    candidate.bundleId,
    'candidate bundle directory must match its identity',
  )
  assert.equal(
    sha256(await readFile(resolve(bundleDirectory, 'package.tgz'))),
    candidate.package.sha256,
  )
  assert.deepEqual(candidate.package.files, APPROVED_PACKAGE_FILES)
  requireIdentity(candidate.package.sha256, SHA256, 'candidate sha256')
  requireIdentity(candidate.source?.commit, COMMIT, 'candidate source commit')
  assert.equal(
    candidate.documentation.sha256,
    await directoryDigest(resolve(bundleDirectory, 'documentation', '0.0.0')),
    'candidate documentation digest changed',
  )
  assert.equal(
    candidate.documentation.revision,
    candidate.source.worktreeClean ? candidate.source.commit : null,
    'documentation revision must exist only for a clean source commit',
  )
  assert.equal(
    candidate.documentation.state,
    candidate.source.worktreeClean ? 'committed' : 'working-tree',
  )
  const expectedResources = [
    {
      path: 'documentation/validation-gates.md',
      sha256: sha256(
        await readFile(resolve(bundleDirectory, 'documentation', 'validation-gates.md')),
      ),
    },
    {
      path: 'fixtures/candidate-docs',
      sha256: await directoryDigest(
        resolve(bundleDirectory, 'fixtures', 'candidate-docs'),
      ),
    },
  ]
  assert.deepEqual(candidate.documentation.resources, expectedResources)
  await verifyVersionedDocumentationLinks(bundleDirectory)

  const evidenceDirectory = resolve(
    bundleDirectory,
    'documentation',
    'evidence',
    PREDECESSOR_EVIDENCE_ID,
  )
  const evidenceRecord = await verifyImmutableEvidenceBundle(evidenceDirectory)
  assert.equal(evidenceRecord.recordId, PREDECESSOR_EVIDENCE_ID)
  assert.equal(evidenceRecord.source.commit, PREDECESSOR_SOURCE_COMMIT)
  assert.equal(evidenceRecord.source.exampleCommit, PREDECESSOR_SOURCE_COMMIT)
  assert.equal(evidenceRecord.result, 'failed')
  const evidenceIndex = await readCanonicalJson(
    resolve(bundleDirectory, 'documentation', 'evidence-index.json'),
    'candidate evidence index',
  )
  assert.deepEqual(
    evidenceIndex,
    createCandidateEvidenceIndex({
      candidate: candidate.package,
      candidateSource: candidate.source,
      predecessorRecord: evidenceRecord,
    }),
  )
  assert.equal(evidenceIndex.compatibilityClaimsPromoted, false)
  const evidenceChecksum = await readFile(
    resolve(evidenceDirectory, 'evidence-record.sha256'),
    'utf8',
  )
  assert.equal(
    candidate.bundleId,
    candidateBundleId({
      candidateSha256: candidate.package.sha256,
      docsSha256: candidate.documentation.sha256,
      documentationResourcesSha256: sha256(canonicalJson(expectedResources)),
      evidenceChecksum: evidenceChecksum.trim(),
      sourceCommit: candidate.source.commit,
      worktreeClean: candidate.source.worktreeClean,
    }),
    'candidate bundle identity does not match its inputs',
  )

  const archiveMembers = inspectApprovedNpmPackageArchive(
    await readFile(resolve(bundleDirectory, 'package.tgz')),
  )
  for (const { path, bytes } of archiveMembers) {
    const packagePath = path.slice('package/'.length)
    assert.equal(
      sha256(await readFile(resolve(packageDirectory, packagePath))),
      sha256(bytes),
      `candidate extraction differs from package.tgz: ${packagePath}`,
    )
  }
  return candidate
}

export async function buildCandidateBundle({
  root,
  evidenceBundleDirectory,
  outputRoot = resolve(root, 'artifacts', 'candidates'),
  npmCli = process.env.npm_execpath,
  beforeSourceRecheck,
}) {
  if (typeof npmCli !== 'string' || npmCli.length === 0) {
    throw new Error('run candidate generation through npm')
  }
  const predecessorRecord = await verifyImmutableEvidenceBundle(
    evidenceBundleDirectory,
  )
  if (
    predecessorRecord.recordId !== PREDECESSOR_EVIDENCE_ID ||
    predecessorRecord.source?.commit !== PREDECESSOR_SOURCE_COMMIT ||
    predecessorRecord.source?.exampleCommit !== PREDECESSOR_SOURCE_COMMIT ||
    predecessorRecord.result !== 'failed'
  ) {
    throw new Error(
      'candidate documentation requires the exact failed predecessor Evidence Record',
    )
  }

  const docsDirectory = resolve(root, 'docs', '0.0.0')
  const sourceBefore = await captureCandidateSourceState(root)
  const inputsBefore = await captureCandidateBuildInputs(root)
  const docsSha256 = inputsBefore.versionedDocsSha256
  const sourceCommit = sourceBefore.commit
  const worktreeClean = sourceBefore.clean
  const stagingRoot = await mkdtemp(join(tmpdir(), 'wrist-menu-candidate-'))

  try {
    const packOutput = execFileSync(
      process.execPath,
      [npmCli, 'pack', '--json', '--pack-destination', stagingRoot],
      { cwd: root, encoding: 'utf8' },
    )
    const [archive] = JSON.parse(packOutput)
    assert.ok(archive, 'npm pack did not report an archive')
    verifyCandidateFileList(archive.files.map(({ path }) => path))

    const sourceArchive = resolve(stagingRoot, archive.filename)
    const candidateSha256 = sha256(await readFile(sourceArchive))
    const evidenceChecksum = await readFile(
      resolve(evidenceBundleDirectory, 'evidence-record.sha256'),
      'utf8',
    )
    const bundleId = candidateBundleId({
      candidateSha256,
      docsSha256,
      documentationResourcesSha256: sha256(
        canonicalJson([
          {
            path: 'documentation/validation-gates.md',
            sha256: inputsBefore.validationGatesSha256,
          },
          {
            path: 'fixtures/candidate-docs',
            sha256: inputsBefore.fixtureSha256,
          },
        ]),
      ),
      evidenceChecksum: evidenceChecksum.trim(),
      sourceCommit,
      worktreeClean,
    })
    const stagedBundle = resolve(stagingRoot, bundleId)
    await mkdir(stagedBundle)
    await cp(sourceArchive, resolve(stagedBundle, 'package.tgz'))
    const extractionRoot = resolve(stagingRoot, 'package-extraction')
    await mkdir(extractionRoot)
    await extractApprovedNpmPackageArchive(
      await readFile(sourceArchive),
      extractionRoot,
    )
    await cp(resolve(extractionRoot, 'package'), resolve(stagedBundle, 'package'), {
      recursive: true,
    })
    verifyCandidateFileList(
      await inventoryRegularFiles(resolve(stagedBundle, 'package')),
    )

    const documentationDirectory = resolve(stagedBundle, 'documentation')
    await mkdir(documentationDirectory)
    await cp(docsDirectory, resolve(documentationDirectory, '0.0.0'), {
      recursive: true,
    })
    await cp(
      resolve(root, 'docs', 'validation-gates.md'),
      resolve(documentationDirectory, 'validation-gates.md'),
    )
    await mkdir(resolve(stagedBundle, 'fixtures'))
    await cp(
      resolve(root, 'fixtures', 'candidate-docs'),
      resolve(stagedBundle, 'fixtures', 'candidate-docs'),
      { recursive: true },
    )
    const copiedEvidenceDirectory = resolve(
      documentationDirectory,
      'evidence',
      PREDECESSOR_EVIDENCE_ID,
    )
    await mkdir(resolve(documentationDirectory, 'evidence'), { recursive: true })
    await cp(evidenceBundleDirectory, copiedEvidenceDirectory, { recursive: true })

    const packageManifest = JSON.parse(
      await readFile(resolve(stagedBundle, 'package', 'package.json'), 'utf8'),
    )
    const packageIdentity = {
      package: packageManifest.name,
      version: packageManifest.version,
      sha256: candidateSha256,
    }
    const source = { commit: sourceCommit, worktreeClean }
    const evidenceIndex = createCandidateEvidenceIndex({
      candidate: packageIdentity,
      candidateSource: source,
      predecessorRecord,
    })
    await writeFile(
      resolve(documentationDirectory, 'evidence-index.json'),
      canonicalJson(evidenceIndex),
    )
    const candidate = {
      schemaVersion: 1,
      bundleId,
      package: { ...packageIdentity, files: APPROVED_PACKAGE_FILES },
      source,
      documentation: {
        path: 'documentation/0.0.0',
        sha256: docsSha256,
        revision: worktreeClean ? sourceCommit : null,
        state: worktreeClean ? 'committed' : 'working-tree',
        resources: [
          {
            path: 'documentation/validation-gates.md',
            sha256: inputsBefore.validationGatesSha256,
          },
          {
            path: 'fixtures/candidate-docs',
            sha256: inputsBefore.fixtureSha256,
          },
        ],
      },
      evidence: {
        path: `documentation/evidence/${PREDECESSOR_EVIDENCE_ID}`,
        recordId: PREDECESSOR_EVIDENCE_ID,
        result: 'failed',
        appliesToCandidate: evidenceIndex.evidence.appliesToCandidate,
      },
    }
    await writeFile(
      resolve(stagedBundle, 'candidate.json'),
      canonicalJson(candidate),
    )
    await writeCandidateManifest(stagedBundle)
    await verifyCandidateBundle(stagedBundle)
    await beforeSourceRecheck?.()
    assertCandidateSourceUnchanged(
      sourceBefore,
      await captureCandidateSourceState(root),
    )
    assert.deepEqual(
      await captureCandidateBuildInputs(root),
      inputsBefore,
      'candidate package or documentation inputs changed while the bundle was staged',
    )

    await mkdir(outputRoot, { recursive: true })
    const destination = resolve(outputRoot, bundleId)
    if (await pathExists(destination)) {
      assert.deepEqual(
        await verifyCandidateBundle(destination),
        candidate,
        `candidate identity collision at ${destination}`,
      )
    } else {
      await cp(stagedBundle, destination, {
        recursive: true,
        errorOnExist: true,
        force: false,
      })
    }
    return { bundleDirectory: destination, candidate }
  } finally {
    await rm(stagingRoot, { recursive: true, force: true })
  }
}
