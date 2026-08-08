import { assertReactLane } from '../assert-react-lane.mjs'
import * as iwer from 'iwer'
import * as three from 'three'
import * as React from 'react'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'

import { WristMenu } from '@xleepy/wrist-menu/react'
import * as core from '@xleepy/wrist-menu/react'
import {
  runPackedReactControllerJourney,
  runPackedReactHandJourney,
} from '../controller-action-journey.mjs'
import { writeLaneReport } from '../evidence-report.mjs'

const [fiber, xr] = await Promise.all([
  import('@react-three/fiber'),
  import('@react-three/xr'),
])

if (fiber.Canvas === undefined || xr.createXRStore === undefined) {
  throw new Error('React renderer lane did not expose its expected public APIs')
}

const versions = await assertReactLane(
  renderToString(createElement(WristMenu)),
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
  core,
})

const handJourney = await runPackedReactHandJourney({
  React,
  WristMenu,
  fiber,
  iwer,
  three,
  core,
})

await writeLaneReport('react-18-xr-iwer-lanes.json', {
  candidateSha256: process.env.WRIST_MENU_CANDIDATE_SHA256,
  status: [handJourney, controllerJourney].every(
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
})
