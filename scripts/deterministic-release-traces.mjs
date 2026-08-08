import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

import {
  createWristMenuRuntimeState,
  disposeWristMenuRuntime,
  stepWristMenuRuntime,
} from '../dist/core/index.js'
import { reachScrollSnapshot, scrollFrame, scrollSource } from '../fixtures/reach-scroll.mjs'
import {
  automaticHandSnapshot,
  wristFrame,
} from '../fixtures/wrist-reveal.mjs'

const FRAME_INTERVALS = Object.freeze({
  '60hz': Object.freeze([1000 / 60]),
  '72hz': Object.freeze([1000 / 72]),
  '90hz': Object.freeze([1000 / 90]),
  '120hz': Object.freeze([1000 / 120]),
  irregular: Object.freeze([7, 23, 11, 41, 5, 19, 31]),
})

function scheduledTimes(start, end, schedule) {
  if (end <= start) return [end]
  const intervals = FRAME_INTERVALS[schedule]
  const times = [start]
  let next = start
  let index = 0
  while (next + intervals[index % intervals.length] < end) {
    next += intervals[index % intervals.length]
    times.push(next)
    index += 1
  }
  if (times.at(-1) !== end) times.push(end)
  return times
}

function viewerAtAngle(degrees) {
  const radians = (degrees * Math.PI) / 180
  return [0, -Math.cos(radians), Math.sin(radians)]
}

function createRuntime(snapshot) {
  return createWristMenuRuntimeState({ snapshot, onEvent: () => undefined })
}

function runFrames(runtime, times, frame) {
  let model
  for (const [index, time] of times.entries()) {
    model = stepWristMenuRuntime(runtime, frame(index + 1, time), [])
  }
  return model
}

function revealObservation(trace, schedule) {
  const runtime = createRuntime(automaticHandSnapshot)
  try {
    if (trace.boundary === 'enter-angle-35-degrees') {
      const model = runFrames(runtime, scheduledTimes(0, 100, schedule), (sequence, time) =>
        wristFrame({
          sequence,
          time,
          viewerPosition: viewerAtAngle(trace.value),
        }),
      )
      return { phase: model.revealPhase, visible: model.visible }
    }

    const step = (sequence, time, overrides = {}) =>
      stepWristMenuRuntime(
        runtime,
        wristFrame({ sequence, time, ...overrides }),
        [],
      )
    let sequence = 0
    const advance = (time, overrides) => step(++sequence, time, overrides)

    for (const time of scheduledTimes(0, 450, schedule)) advance(time)
    advance(451)

    if (trace.boundary === 'exit-angle-50-degrees') {
      const model = advance(500, {
        viewerPosition: viewerAtAngle(trace.value),
      })
      return { phase: model.revealPhase, visible: model.visible }
    }
    if (trace.boundary === 'tracking-grace-250-ms') {
      advance(500, { pose: null })
      const model = advance(500 + trace.value, { pose: null })
      return { phase: model.revealPhase, visible: model.visible }
    }
    if (trace.boundary === 'reacquire-dwell-200-ms') {
      advance(500, { pose: null })
      advance(750, { pose: null })
      advance(800)
      const model = advance(800 + trace.value)
      return { phase: model.revealPhase, visible: model.visible }
    }
  } finally {
    disposeWristMenuRuntime(runtime)
  }
  throw new Error(`unknown reveal boundary ${trace.boundary}`)
}

function freshRevealObservation(trace, schedule) {
  const runtime = createRuntime(automaticHandSnapshot)
  try {
    let sequence = 0
    const advance = (time) =>
      stepWristMenuRuntime(
        runtime,
        wristFrame({ sequence: ++sequence, time }),
        [],
      )
    const end =
      trace.boundary === 'initial-dwell-300-ms'
        ? trace.value
        : 300 + trace.value
    let model
    for (const time of scheduledTimes(0, end, schedule)) model = advance(time)
    return {
      phase: model.revealPhase,
      visible: model.visible,
      opacity: Number(model.opacity.toFixed(6)),
    }
  } finally {
    disposeWristMenuRuntime(runtime)
  }
}

function scrollObservation(trace, schedule) {
  const runtime = createRuntime(reachScrollSnapshot)
  try {
    let sequence = 0
    for (const time of scheduledTimes(0, 100, schedule).slice(0, -1)) {
      stepWristMenuRuntime(
        runtime,
        { ...scrollFrame(++sequence, [scrollSource()]), time },
        [],
      )
    }
    const model = stepWristMenuRuntime(
      runtime,
      {
        ...scrollFrame(++sequence, [
          scrollSource({
            kind: trace.boundary.startsWith('hand-') ? 'hand' : 'controller',
            positionY: -trace.value,
          }),
        ]),
        time: 100,
      },
      [],
    )
    return {
      scrollOwned: runtime.scrollState.ownerSourceId !== null,
      offset: Number(model.scrollOffset.toFixed(6)),
    }
  } finally {
    disposeWristMenuRuntime(runtime)
  }
}

function expectedObservation(trace) {
  if (trace.boundary === 'enter-angle-35-degrees') {
    return trace.position === 'above'
      ? { phase: 'hidden', visible: false }
      : { phase: 'dwelling', visible: false }
  }
  if (trace.boundary === 'exit-angle-50-degrees') {
    return trace.position === 'above'
      ? { phase: 'hiding', visible: true }
      : { phase: 'visible', visible: true }
  }
  if (trace.boundary === 'tracking-grace-250-ms') {
    return trace.position === 'below'
      ? { phase: 'tracking-grace', visible: true }
      : { phase: 'hidden', visible: false }
  }
  if (trace.boundary === 'reacquire-dwell-200-ms') {
    return trace.position === 'below'
      ? { phase: 'reacquire-dwell', visible: false }
      : { phase: 'showing', visible: trace.position === 'above' }
  }
  if (trace.boundary === 'initial-dwell-300-ms') {
    return trace.position === 'below'
      ? { phase: 'dwelling', visible: false, opacity: 0 }
      : {
          phase: 'showing',
          visible: trace.position === 'above',
          opacity:
            trace.position === 'above'
              ? Number(((trace.value - 300) / 150).toFixed(6))
              : 0,
        }
  }
  if (trace.boundary === 'transition-150-ms') {
    return trace.position === 'below'
      ? {
          phase: 'showing',
          visible: true,
          opacity: Number((trace.value / 150).toFixed(6)),
        }
      : { phase: 'visible', visible: true, opacity: 1 }
  }
  if (
    trace.boundary === 'hand-scroll-9-mm' ||
    trace.boundary === 'controller-scroll-13-mm'
  ) {
    return {
      scrollOwned: true,
      offset: Number((trace.value / 0.0225).toFixed(6)),
    }
  }
  return undefined
}

function observe(trace, schedule) {
  if (trace.boundary.endsWith('scroll-9-mm') || trace.boundary.endsWith('scroll-13-mm')) {
    return scrollObservation(trace, schedule)
  }
  if (
    trace.boundary === 'initial-dwell-300-ms' ||
    trace.boundary === 'transition-150-ms'
  ) {
    return freshRevealObservation(trace, schedule)
  }
  return revealObservation(trace, schedule)
}

export async function runDeterministicReleaseTraces(protocolUrl = new URL(
  '../evidence/protocols/automated-v1.json',
  import.meta.url,
)) {
  const protocol = JSON.parse(await readFile(protocolUrl, 'utf8'))
  const results = []

  for (const trace of protocol.deterministicTraces) {
    let reference
    for (const schedule of protocol.frameSchedules) {
      const observed = observe(trace, schedule)
      reference ??= observed
      const expected = expectedObservation(trace)
      const status =
        JSON.stringify(observed) === JSON.stringify(reference) &&
        (expected === undefined || JSON.stringify(observed) === JSON.stringify(expected))
          ? 'passed'
          : 'failed'
      results.push({ trace: trace.id, schedule, status, observed })
    }
  }

  return {
    gate: 'deterministic-boundaries',
    status: results.every(({ status }) => status === 'passed')
      ? 'passed'
      : 'failed',
    protocol: { id: protocol.id, version: protocol.version },
    traceCount: protocol.deterministicTraces.length,
    replayCount: results.length,
    results,
  }
}

async function main() {
  const outputIndex = process.argv.indexOf('--output')
  const report = await runDeterministicReleaseTraces()
  if (outputIndex >= 0) {
    assert.ok(process.argv[outputIndex + 1], '--output requires a path')
    await writeFile(
      process.argv[outputIndex + 1],
      `${JSON.stringify(report, null, 2)}\n`,
    )
  } else {
    console.log(JSON.stringify(report, null, 2))
  }
  if (report.status !== 'passed') process.exitCode = 1
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
