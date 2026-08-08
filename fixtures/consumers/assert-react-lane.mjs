import assert from 'node:assert/strict'
import { installedVersion } from './evidence-report.mjs'

export async function assertReactLane(renderedOutput, expectedVersions, fixtureUrl) {
  assert.equal(renderedOutput, '')

  for (const [packageName, expectedVersion] of Object.entries(expectedVersions)) {
    assert.equal(await installedVersion(packageName, fixtureUrl), expectedVersion)
  }

  return expectedVersions
}
