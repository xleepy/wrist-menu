import { readdir, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export async function cleanGeneratedArtifacts(artifactDirectory) {
  let entries
  try {
    entries = await readdir(artifactDirectory)
  } catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }

  await Promise.all(
    entries
      .filter((name) => name !== 'release-evidence')
      .map((name) =>
        rm(resolve(artifactDirectory, name), { force: true, recursive: true }),
      ),
  )
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  await Promise.all([
    rm(resolve(root, 'dist'), { force: true, recursive: true }),
    cleanGeneratedArtifacts(resolve(root, 'artifacts')),
  ])
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
