import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const packageVersion = async (packageName, fixtureUrl) => {
  const manifestUrl = new URL(
    `./node_modules/${packageName}/package.json`,
    fixtureUrl,
  )
  return JSON.parse(await readFile(manifestUrl, 'utf8')).version
}

export async function assertReactLane(renderedOutput, expectedVersions, fixtureUrl) {
  assert.equal(renderedOutput, '')

  for (const [packageName, expectedVersion] of Object.entries(expectedVersions)) {
    assert.equal(await packageVersion(packageName, fixtureUrl), expectedVersion)
  }
}
