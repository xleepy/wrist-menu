import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import { APPROVED_PACKAGE_FILES } from '../scripts/approved-package-files.mjs'
import { inventoryRegularFiles } from '../scripts/safe-files.mjs'
import {
  extractApprovedNpmPackageArchive,
  inspectApprovedNpmPackageArchive,
} from '../scripts/safe-tar.mjs'

const BLOCK_BYTES = 512

function writeText(buffer, offset, length, value) {
  const bytes = Buffer.from(value)
  assert.ok(bytes.length <= length)
  bytes.copy(buffer, offset)
}

function writeOctal(buffer, offset, length, value) {
  writeText(buffer, offset, length, `${value.toString(8).padStart(length - 1, '0')}\0`)
}

function tarHeader({ path, bytes, type = '0', link = '' }) {
  const header = Buffer.alloc(BLOCK_BYTES)
  writeText(header, 0, 100, path)
  writeOctal(header, 100, 8, 0o644)
  writeOctal(header, 108, 8, 0)
  writeOctal(header, 116, 8, 0)
  writeOctal(header, 124, 12, bytes.length)
  writeOctal(header, 136, 12, 0)
  header.fill(0x20, 148, 156)
  writeText(header, 156, 1, type)
  writeText(header, 157, 100, link)
  writeText(header, 257, 6, 'ustar\0')
  writeText(header, 263, 2, '00')
  const checksum = header.reduce((total, byte) => total + byte, 0)
  writeText(header, 148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `)
  return header
}

function archive(entries) {
  const blocks = []
  for (const entry of entries) {
    const bytes = Buffer.from(entry.contents ?? `contents:${entry.path}`)
    blocks.push(tarHeader({ ...entry, bytes }), bytes)
    const padding = (BLOCK_BYTES - (bytes.length % BLOCK_BYTES)) % BLOCK_BYTES
    if (padding > 0) blocks.push(Buffer.alloc(padding))
  }
  blocks.push(Buffer.alloc(BLOCK_BYTES * 2))
  return gzipSync(Buffer.concat(blocks))
}

const approvedEntries = APPROVED_PACKAGE_FILES.map((path) => ({
  path: `package/${path}`,
}))

test('candidate archive is validated completely before exact regular files are extracted', async () => {
  const validArchive = archive(approvedEntries)
  assert.deepEqual(
    inspectApprovedNpmPackageArchive(validArchive).map(({ path }) => path),
    approvedEntries.map(({ path }) => path).sort(),
  )

  const extractionRoot = await mkdtemp(join(tmpdir(), 'wrist-menu-safe-tar-'))
  try {
    await extractApprovedNpmPackageArchive(validArchive, extractionRoot)
    assert.deepEqual(
      await inventoryRegularFiles(resolve(extractionRoot, 'package')),
      APPROVED_PACKAGE_FILES,
    )
    assert.equal(
      await readFile(resolve(extractionRoot, 'package', 'LICENSE'), 'utf8'),
      'contents:package/LICENSE',
    )
  } finally {
    await rm(extractionRoot, { recursive: true, force: true })
  }

  const malicious = [
    [
      'traversal',
      [{ ...approvedEntries[0], path: 'package/../outside' }, ...approvedEntries.slice(1)],
    ],
    [
      'absolute',
      [{ ...approvedEntries[0], path: '/package/LICENSE' }, ...approvedEntries.slice(1)],
    ],
    [
      'windows absolute',
      [{ ...approvedEntries[0], path: 'C:/package/LICENSE' }, ...approvedEntries.slice(1)],
    ],
    [
      'backslash',
      [{ ...approvedEntries[0], path: 'package\\LICENSE' }, ...approvedEntries.slice(1)],
    ],
    ['duplicate', [...approvedEntries, approvedEntries[0]]],
    [
      'symbolic link',
      [{ ...approvedEntries[0], type: '2', link: '../outside' }, ...approvedEntries.slice(1)],
    ],
    [
      'hard link',
      [{ ...approvedEntries[0], type: '1', link: 'package/README.md' }, ...approvedEntries.slice(1)],
    ],
    [
      'device',
      [{ ...approvedEntries[0], type: '3' }, ...approvedEntries.slice(1)],
    ],
    ['extra top level', [...approvedEntries, { path: 'outside.txt' }]],
    ['directory member', [...approvedEntries, { path: 'package/extra', type: '5' }]],
  ]

  for (const [name, entries] of malicious) {
    const destination = await mkdtemp(join(tmpdir(), 'wrist-menu-reject-tar-'))
    try {
      await assert.rejects(
        () => extractApprovedNpmPackageArchive(archive(entries), destination),
        undefined,
        name,
      )
      assert.deepEqual(await readdir(destination), [], `${name} wrote before rejection`)
    } finally {
      await rm(destination, { recursive: true, force: true })
    }
  }
})
