import assert from 'node:assert/strict'
import test from 'node:test'

import { runDeterministicReleaseTraces } from '../scripts/deterministic-release-traces.mjs'

test('every named boundary trace converges across fixed and irregular frames', async () => {
  const report = await runDeterministicReleaseTraces()

  assert.equal(report.traceCount, 24)
  assert.equal(report.replayCount, 120)
  assert.equal(report.status, 'passed')
  assert.deepEqual(
    [...new Set(report.results.map(({ schedule }) => schedule))],
    ['60hz', '72hz', '90hz', '120hz', 'irregular'],
  )
})
