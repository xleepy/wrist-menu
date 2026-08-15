import assert from 'node:assert/strict'
import { lstat, mkdir, readdir, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'

import { APPROVED_PACKAGE_FILES } from './approved-package-files.mjs'
import { requireSafeRelativePath } from './safe-files.mjs'

const BLOCK_BYTES = 512
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
const MAX_FILE_BYTES = 16 * 1024 * 1024
const decoder = new TextDecoder('utf-8', { fatal: true })

function allZero(bytes) {
  return bytes.every((byte) => byte === 0)
}

function readTextField(header, offset, length, label) {
  const field = header.subarray(offset, offset + length)
  const firstNull = field.indexOf(0)
  const end = firstNull < 0 ? field.length : firstNull
  if (firstNull >= 0 && !allZero(field.subarray(firstNull))) {
    throw new TypeError(`${label} has data after its terminator`)
  }
  return decoder.decode(field.subarray(0, end))
}

function readOctalField(header, offset, length, label) {
  const field = header
    .subarray(offset, offset + length)
    .toString('ascii')
    .replace(/[\0 ]+$/u, '')
  if (!/^[0-7]+$/u.test(field)) {
    throw new TypeError(`${label} is not a portable tar octal value`)
  }
  const value = Number.parseInt(field, 8)
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} exceeds the supported tar range`)
  }
  return value
}

function verifyChecksum(header) {
  const expected = readOctalField(header, 148, 8, 'tar checksum')
  let actual = 0
  for (let index = 0; index < header.length; index += 1) {
    actual += index >= 148 && index < 156 ? 0x20 : header[index]
  }
  if (actual !== expected) throw new Error('tar header checksum is invalid')
}

function parseArchive(archiveBytes) {
  const tar = gunzipSync(archiveBytes, { maxOutputLength: MAX_ARCHIVE_BYTES })
  if (tar.length % BLOCK_BYTES !== 0) {
    throw new Error('tar payload is not block aligned')
  }

  const members = []
  const seen = new Set()
  let offset = 0
  let foundTerminator = false
  while (offset < tar.length) {
    const header = tar.subarray(offset, offset + BLOCK_BYTES)
    if (allZero(header)) {
      const trailer = tar.subarray(offset)
      if (trailer.length < BLOCK_BYTES * 2 || !allZero(trailer)) {
        throw new Error('tar archive has an invalid terminator')
      }
      foundTerminator = true
      break
    }
    verifyChecksum(header)
    const magic = readTextField(header, 257, 6, 'tar magic')
    if (magic !== 'ustar') throw new TypeError('candidate archive must use ustar')
    const name = readTextField(header, 0, 100, 'tar member name')
    const prefix = readTextField(header, 345, 155, 'tar member prefix')
    const path = requireSafeRelativePath(
      prefix.length === 0 ? name : `${prefix}/${name}`,
      'tar member path',
    )
    const type = header[156]
    if (type !== 0 && type !== 0x30) {
      throw new TypeError(`tar member is not a regular file: ${path}`)
    }
    if (readTextField(header, 157, 100, 'tar link name') !== '') {
      throw new TypeError(`regular tar member contains a link target: ${path}`)
    }
    if (seen.has(path)) throw new TypeError(`tar member is duplicated: ${path}`)
    seen.add(path)

    const size = readOctalField(header, 124, 12, 'tar member size')
    if (size > MAX_FILE_BYTES) {
      throw new TypeError(`tar member exceeds the file size limit: ${path}`)
    }
    const dataStart = offset + BLOCK_BYTES
    const dataEnd = dataStart + size
    const nextOffset = dataStart + Math.ceil(size / BLOCK_BYTES) * BLOCK_BYTES
    if (dataEnd > tar.length || nextOffset > tar.length) {
      throw new Error(`tar member exceeds the archive: ${path}`)
    }
    if (!allZero(tar.subarray(dataEnd, nextOffset))) {
      throw new Error(`tar member padding is not empty: ${path}`)
    }
    members.push({ path, bytes: tar.subarray(dataStart, dataEnd) })
    offset = nextOffset
  }
  if (!foundTerminator) throw new Error('tar archive has no terminator')
  return members
}

export function inspectApprovedNpmPackageArchive(archiveBytes) {
  const members = parseArchive(archiveBytes)
  const expected = APPROVED_PACKAGE_FILES.map((path) => `package/${path}`).sort()
  const actual = members.map(({ path }) => path).sort()
  assert.deepEqual(
    actual,
    expected,
    'candidate archive members differ from the exact approved package payload',
  )
  return members
    .map(({ path, bytes }) => ({ path, bytes }))
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
}

export async function extractApprovedNpmPackageArchive(
  archiveBytes,
  destination,
) {
  const members = inspectApprovedNpmPackageArchive(archiveBytes)
  const destinationPath = resolve(destination)
  const destinationStat = await lstat(destinationPath)
  if (!destinationStat.isDirectory() || destinationStat.isSymbolicLink()) {
    throw new TypeError('candidate extraction destination must be a real directory')
  }
  if ((await readdir(destinationPath)).length !== 0) {
    throw new TypeError('candidate extraction destination must be empty')
  }

  for (const { path, bytes } of members) {
    const target = resolve(destinationPath, ...path.split('/'))
    if (relative(destinationPath, target).replaceAll('\\', '/') !== path) {
      throw new TypeError(`candidate extraction escaped its destination: ${path}`)
    }
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, bytes, { flag: 'wx', mode: 0o644 })
  }
}
