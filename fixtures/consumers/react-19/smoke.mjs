import { assertReactLane } from '../assert-react-lane.mjs'
import * as iwer from 'iwer'
import * as three from 'three'
import * as React from 'react'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'

import { WristMenu } from '@xleepy/wrist-menu/react'
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
    react: '19.2.7',
    'react-dom': '19.2.7',
    three: '0.185.1',
    '@react-three/fiber': '9.6.1',
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

await writeLaneReport('react-19-xr-iwer-lanes.json', {
  candidateSha256: process.env.WRIST_MENU_CANDIDATE_SHA256,
  status: [handJourney, controllerJourney].every(
    ({ status }) => status === 'passed',
  )
    ? 'passed'
    : 'failed',
  testedLanes: [
    'react-19.2.7-r3f-9.6.1',
    'react-xr-6.6.30',
    handJourney.id,
    controllerJourney.id,
  ],
  versions,
  journeys: [handJourney, controllerJourney],
})
