import assert from 'node:assert/strict'
import * as iwer from 'iwer'
import * as three from 'three'

import { wristMenuSessionFeatures as rootFeatures } from '@xleepy/wrist-menu'
import { wristMenuSessionFeatures as coreFeatures } from '@xleepy/wrist-menu/core'
import {
  createThreeWristMenuState,
  disposeThreeWristMenu,
  threeWristMenuBlocksSceneInput,
  updateThreeWristMenu,
  wristMenuSessionFeatures as threeFeatures,
} from '@xleepy/wrist-menu/three'
import {
  runPackedThreeControllerJourney,
  runPackedThreeHandJourney,
} from '../controller-action-journey.mjs'
import { installedVersion, writeLaneReport } from '../evidence-report.mjs'

assert.deepEqual(rootFeatures.optionalFeatures, ['hand-tracking', 'local-floor'])
assert.equal(coreFeatures, rootFeatures)
assert.equal(threeFeatures, rootFeatures)

const controllerJourney = await runPackedThreeControllerJourney({
  createThreeWristMenuState,
  disposeThreeWristMenu,
  threeWristMenuBlocksSceneInput,
  updateThreeWristMenu,
  iwer,
  three,
})
const handJourney = await runPackedThreeHandJourney({
  createThreeWristMenuState,
  disposeThreeWristMenu,
  threeWristMenuBlocksSceneInput,
  updateThreeWristMenu,
  iwer,
  three,
})

await writeLaneReport('three-iwer-lanes.json', {
  candidateSha256: process.env.WRIST_MENU_CANDIDATE_SHA256,
  status: 'passed',
  testedLanes: ['three-0.185.1', handJourney.id, controllerJourney.id],
  versions: {
    three: await installedVersion('three', import.meta.url),
    iwer: await installedVersion('iwer', import.meta.url),
  },
  journeys: [handJourney, controllerJourney],
})
