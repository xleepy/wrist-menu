import { lstat, readdir } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

const WINDOWS_ABSOLUTE = /^[A-Za-z]:\//

export function requireSafeRelativePath(path, label = 'path') {
  if (
    typeof path !== 'string' ||
    path.length === 0 ||
    path.includes('\0') ||
    path.includes('\\') ||
    path.includes(':') ||
    path.startsWith('/') ||
    WINDOWS_ABSOLUTE.test(path)
  ) {
    throw new TypeError(`${label} is not a safe relative POSIX path: ${path}`)
  }
  const parts = path.split('/')
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw new TypeError(`${label} contains an unsafe path component: ${path}`)
  }
  return path
}

/** Recursively inventories regular files while rejecting every filesystem link. */
export async function inventoryRegularFiles(directory, current = directory) {
  const root = resolve(directory)
  const currentPath = resolve(current)
  const currentStat = await lstat(currentPath)
  if (!currentStat.isDirectory() || currentStat.isSymbolicLink()) {
    throw new TypeError(`inventory root is not a real directory: ${currentPath}`)
  }

  const files = []
  for (const entry of await readdir(currentPath)) {
    const path = resolve(currentPath, entry)
    const relativePath = relative(root, path).replaceAll('\\', '/')
    requireSafeRelativePath(relativePath, 'inventory path')
    const stat = await lstat(path)
    if (stat.isSymbolicLink()) {
      throw new TypeError(`candidate inventory cannot contain links: ${relativePath}`)
    }
    if (stat.isDirectory()) {
      files.push(...(await inventoryRegularFiles(root, path)))
    } else if (stat.isFile()) {
      files.push(relativePath)
    } else {
      throw new TypeError(
        `candidate inventory requires regular files: ${relativePath}`,
      )
    }
  }
  return files.sort()
}
