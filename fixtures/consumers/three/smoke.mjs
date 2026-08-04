import assert from 'node:assert/strict'
import * as iwer from 'iwer'
import * as three from 'three'

import { wristMenuSessionFeatures as rootFeatures } from '@xleepy/wrist-menu'
import { wristMenuSessionFeatures as coreFeatures } from '@xleepy/wrist-menu/core'
import {
  createThreeWristMenu,
  wristMenuSessionFeatures as threeFeatures,
} from '@xleepy/wrist-menu/three'
import {
  runPackedThreeControllerJourney,
  runPackedThreeHandJourney,
} from '../controller-action-journey.mjs'

assert.deepEqual(rootFeatures.optionalFeatures, ['hand-tracking', 'local-floor'])
assert.equal(coreFeatures, rootFeatures)
assert.equal(threeFeatures, rootFeatures)

await runPackedThreeControllerJourney({ createThreeWristMenu, iwer, three })
await runPackedThreeHandJourney({ createThreeWristMenu, iwer, three })
