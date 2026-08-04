import assert from 'node:assert/strict'

import { wristMenuSessionFeatures as rootFeatures } from '@xleepy/wrist-menu'
import { wristMenuSessionFeatures as coreFeatures } from '@xleepy/wrist-menu/core'
import { wristMenuSessionFeatures as threeFeatures } from '@xleepy/wrist-menu/three'

assert.deepEqual(rootFeatures.optionalFeatures, ['hand-tracking', 'local-floor'])
assert.equal(coreFeatures, rootFeatures)
assert.equal(threeFeatures, rootFeatures)
