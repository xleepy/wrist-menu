import { reachScrollSnapshot } from '../reach-scroll.mjs'
import {
  evaluatePerformanceVariant,
  performanceBaselinePhases,
  performanceBaselineVariants,
} from './performance-baseline.mjs'
import {
  packageUpdateTimingObservation,
  performanceMeasuredFrameSamples,
  performanceWarmupFrameSamples,
  sceneCounters,
} from './performance-workload.mjs'
import { activeScrollPositionY } from './reach-scroll-workload.mjs'
import {
  createReactIwerRendererHarness,
  instrumentUniqueAddedFrameSubscription,
} from './react-renderer-harness.mjs'

const REACH_ROW_STRIDE_METERS = 0.0225
const REACH_VIEWPORT_TOP_METERS = 0.039
function observedPresentationScrollOffset(group) {
  let firstVisual
  group.traverse((object) => {
    if (
      firstVisual === undefined &&
      object.visible &&
      /^wrist-menu-action-visual:row-\d+$/.test(object.name)
    ) {
      firstVisual = object
    }
  })
  if (firstVisual === undefined) return null
  const rowIndex = Number(
    firstVisual.name.slice(firstVisual.name.lastIndexOf('-') + 1),
  )
  const rowCenterAtTop = REACH_VIEWPORT_TOP_METERS - 0.01
  const offset = rowIndex +
    (firstVisual.position.y - rowCenterAtTop) / REACH_ROW_STRIDE_METERS
  return Math.abs(offset) < 1e-9 ? 0 : offset
}

function createPerformanceProbe() {
  let recording = false
  let reactCommits = 0
  return {
    reactCommit(_phase) {
      if (!recording) return
      reactCommits += 1
    },
    start() {
      reactCommits = 0
      recording = true
    },
    stop() {
      recording = false
      return Object.freeze({
        reactCommits,
      })
    },
  }
}

async function measurePhase(dependencies, phase) {
  const { React, WristMenu, fiber, iwer, three, xr, stateSetterProbe } = dependencies
  const performanceProbe = createPerformanceProbe()
  const taggedSettersBefore = stateSetterProbe.taggedSetterCount()
  const harness = await createReactIwerRendererHarness({
    React,
    fiber,
    iwer,
    three,
    xr,
    sourceKind: 'controller',
    wrist: reachScrollSnapshot.wrist,
  })
  let samePriorityHostCallbacks = 0
  function SamePriorityHostCallback() {
    fiber.useFrame(() => {
      samePriorityHostCallbacks += 1
    }, -1000)
    return null
  }
  const tree = (includeMenu) => React.createElement(
    React.Fragment,
    null,
    React.createElement(SamePriorityHostCallback, {
      key: 'same-priority-host-callback',
    }),
    includeMenu
      ? React.createElement(
          React.Profiler,
          {
            key: 'packed-wrist-menu',
            id: 'wrist-menu-frame-isolation',
            onRender: (_id, renderPhase) =>
              performanceProbe.reactCommit(renderPhase),
          },
          React.createElement(WristMenu, {
            snapshot: {
              ...reachScrollSnapshot,
              activationMode:
                phase === 'hidden' ? 'forced-closed' : 'forced-open',
            },
            onEvent: () => undefined,
          }),
        )
      : null,
  )
  let time = 0
  let activeScrollFrame = 0
  const activeScroll = phase === 'activeScroll'
  const advanceFrames = async (count) => {
    time = await harness.advanceFrames(count, {
      startTime: time,
      beforeFrame() {
        const group = harness.menuGroup()
        if (activeScroll && group !== undefined) {
          const positionY = activeScrollPositionY(activeScrollFrame)
          harness.aimSelectionAtMenuLocal(group, { y: positionY })
          activeScrollFrame += 1
        } else {
          harness.placeSelectionAway()
        }
      },
    })
  }

  let packageTimingProbe
  try {
    await harness.render(tree(false))
    const hostSubscribers = harness.frameSubscribers()
    await harness.render(tree(true))
    packageTimingProbe = instrumentUniqueAddedFrameSubscription(
      hostSubscribers,
      harness.frameSubscribers(),
    )
    await advanceFrames(2)
    const warmupFrames = performanceWarmupFrameSamples
    await advanceFrames(warmupFrames)
    const group = harness.menuGroup()
    if (group === undefined) {
      throw new Error('packed React Wrist Menu did not mount its public presentation')
    }
    performanceProbe.start()
    packageTimingProbe.start()
    stateSetterProbe.beginFrameSamples()
    await advanceFrames(performanceMeasuredFrameSamples)
    const setterObservation = stateSetterProbe.endFrameSamples()
    const timings = packageTimingProbe.stop()
    const observation = performanceProbe.stop()
    const scrollOffset = observedPresentationScrollOffset(group)
    return {
      ...sceneCounters(group),
      ...packageUpdateTimingObservation(timings),
      reactStateSetterCalls: setterObservation.reactStateSetterCalls,
      reactCommits: observation.reactCommits,
      reactStateSettersInstrumented:
        stateSetterProbe.taggedSetterCount() - taggedSettersBefore,
      workload: phase,
      warmupFrames,
      samePriorityHostCallbacks,
      menuVisible: group.visible,
      scrollOffset,
    }
  } finally {
    packageTimingProbe?.restore()
    await harness.dispose()
  }
}

export async function runPackedReactPerformanceBaseline(dependencies) {
  const measurements = {}
  for (const phase of performanceBaselinePhases) {
    measurements[phase] = await measurePhase(dependencies, phase)
  }
  const evaluated = evaluatePerformanceVariant(
    performanceBaselineVariants.find(({ id }) => id === dependencies.laneId),
    measurements,
    dependencies.baseline,
  )
  const workloadFailures = performanceBaselinePhases.filter((phase) => {
    const measurement = measurements[phase]
    if (phase === 'hidden') return measurement.menuVisible
    if (!measurement.menuVisible) return true
    return phase === 'activeScroll' && !(measurement.scrollOffset > 0)
  })
  return Object.freeze({
    instrumentation: 'node-r3f-scene-counters-v3',
    candidate: '@xleepy/wrist-menu/react',
    laneId: dependencies.laneId,
    renderer: 'react',
    reactFrameIsolation: Object.freeze({
      boundary: 'React.Profiler around the packed public WristMenu consumer',
      stateSetterCalls:
        'dispatches from setters tagged to the packed WristMenu hook-creation module',
      commits: 'all Profiler commits during Frame Samples',
      packageUpdateTiming:
        'exact callback of the unique priority -1000 subscription added when the packed WristMenu mounts into an established React-XR host',
    }),
    status:
      evaluated.status === 'passed' && workloadFailures.length === 0
        ? 'passed'
        : 'failed',
    failures: Object.freeze([
      ...evaluated.failures,
      ...workloadFailures.map((phase) => `${phase} workload was not realized`),
    ]),
    measurements,
  })
}
