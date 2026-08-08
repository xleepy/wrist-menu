import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import test from 'node:test'

import { cleanGeneratedArtifacts } from '../scripts/clean.mjs'

test('clean removes rebuildable packs but preserves immutable release evidence', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'wrist-menu-clean-'))
  const evidenceDirectory = resolve(directory, 'release-evidence', 'record-1')
  try {
    await mkdir(evidenceDirectory, { recursive: true })
    await writeFile(resolve(evidenceDirectory, 'evidence-record.json'), '{}\n')
    await writeFile(resolve(directory, 'candidate.tgz'), 'replaceable')

    await cleanGeneratedArtifacts(directory)

    assert.equal(
      await readFile(resolve(evidenceDirectory, 'evidence-record.json'), 'utf8'),
      '{}\n',
    )
    await assert.rejects(() => readFile(resolve(directory, 'candidate.tgz')))
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})
