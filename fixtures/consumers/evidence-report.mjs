import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export async function installedVersion(packageName, fixtureUrl) {
  const manifestUrl = new URL(
    `./node_modules/${packageName}/package.json`,
    fixtureUrl,
  )
  return JSON.parse(await readFile(manifestUrl, 'utf8')).version
}

export async function writeLaneReport(fileName, report) {
  const directory = process.env.WRIST_MENU_EVIDENCE_DIRECTORY
  if (directory === undefined) return

  await mkdir(directory, { recursive: true })
  await writeFile(
    resolve(directory, fileName),
    `${JSON.stringify(report, null, 2)}\n`,
  )
}
