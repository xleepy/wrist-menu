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
  assert.ok(report.results.every(({ observed }) =>
    Array.isArray(observed.fullEvents) &&
    Array.isArray(observed.semanticEvents) &&
    observed.fullEvents.every(({ time }) => Number.isFinite(time)) &&
    observed.timingInvariants.status === 'passed',
  ))
  for (const trace of new Set(report.results.map(({ trace }) => trace))) {
    const eventSequences = report.results
      .filter(({ trace: candidate }) => candidate === trace)
      .map(({ observed }) => observed.semanticEvents)
    assert.ok(
      eventSequences.every(
        (events) => JSON.stringify(events) === JSON.stringify(eventSequences[0]),
      ),
      `${trace} produced schedule-dependent Wrist Menu Events`,
    )
  }
  for (const kind of ['hand', 'controller']) {
    const below = report.results.find(
      ({ trace }) => trace === `${kind}-scroll-below`,
    )
    assert.equal(below.observed.scrollOwned, false)
    assert.equal(
      below.observed.semanticEvents.some(
        ({ type }) => type === 'selection-cancellation',
      ),
      false,
    )
    for (const position of ['at', 'above']) {
      const acquired = report.results.find(
        ({ trace }) => trace === `${kind}-scroll-${position}`,
      )
      assert.equal(acquired.observed.scrollOwned, true)
      assert.ok(
        acquired.observed.semanticEvents.some(
          ({ type }) => type === 'selection-cancellation',
        ),
      )
    }
  }

  for (const result of report.results) {
    assert.deepEqual(
      result.observed.semanticEvents,
      result.observed.fullEvents.map(({ time: _time, ...event }) => event),
    )
    assert.equal(result.observed.timingInvariants.monotonic, true)
    assert.equal(result.observed.timingInvariants.notAfterLastFrame, true)
  }
})
