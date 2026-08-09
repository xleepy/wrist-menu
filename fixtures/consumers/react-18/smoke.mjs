import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import * as iwer from 'iwer'
import * as three from 'three'

import { assertReactLane } from '../assert-react-lane.mjs'
import {
  runPackedReactControllerJourney,
  runPackedReactHandJourney,
} from '../controller-action-journey.mjs'
import { writeLaneReport } from '../evidence-report.mjs'
import { runPackedReactPerformanceBaseline } from '../react-performance-baseline.mjs'
import { installReactStateSetterProbe } from '../react-renderer-harness.mjs'
import performanceBaselines from '../../../evidence/baselines/performance-v1.json' with { type: 'json' }

const require = createRequire(import.meta.url)
const reactRuntime = require('react')
const stateSetterProbe = installReactStateSetterProbe(reactRuntime)
const React = await import('react')
const [{ renderToString }, { WristMenu }, fiber, xr] = await Promise.all([
  import('react-dom/server'),
  import('@xleepy/wrist-menu/react'),
  import('@react-three/fiber'),
  import('@react-three/xr'),
])

if (fiber.Canvas === undefined || xr.createXRStore === undefined) {
  throw new Error('React renderer lane did not expose its expected public APIs')
}

const versions = await assertReactLane(
  renderToString(React.createElement(WristMenu)),
  {
    react: '18.3.1',
    'react-dom': '18.3.1',
    three: '0.185.1',
    '@react-three/fiber': '8.18.0',
    '@react-three/xr': '6.6.30',
    iwer: '2.3.0',
  },
  import.meta.url,
)

const controllerJourney = await runPackedReactControllerJourney({
  React,
  WristMenu,
  fiber,
  iwer,
  three,
  xr,
})

const handJourney = await runPackedReactHandJourney({
  React,
  WristMenu,
  fiber,
  iwer,
  three,
})

const performanceBaseline = await runPackedReactPerformanceBaseline({
  laneId: 'react-18.3.1-r3f-8.18.0',
  baseline: performanceBaselines.variants['react-18.3.1-r3f-8.18.0'],
  React,
  WristMenu,
  fiber,
  iwer,
  three,
  xr,
  stateSetterProbe,
})
await writeLaneReport('react-18-xr-iwer-lanes.json', {
  candidateSha256: process.env.WRIST_MENU_CANDIDATE_SHA256,
  status: [handJourney, controllerJourney, performanceBaseline].every(
    ({ status }) => status === 'passed',
  )
    ? 'passed'
    : 'failed',
  testedLanes: [
    'react-18.3.1-r3f-8.18.0',
    'react-xr-6.6.30',
    handJourney.id,
    controllerJourney.id,
  ],
  versions,
  journeys: [handJourney, controllerJourney],
  performanceBaseline,
})
stateSetterProbe.restore()
assert.equal(
  performanceBaseline.status,
  'passed',
  performanceBaseline.failures.join('; '),
)
