import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'

import { WristMenu } from '../dist/react/index.js'
import { controllerActionSnapshot } from '../fixtures/controller-action.mjs'

test('the React integration server-renders without output or effects', () => {
  assert.equal(
    renderToString(
      createElement(WristMenu, {
        snapshot: controllerActionSnapshot,
        onEvent: () => assert.fail('server rendering emitted an event'),
      }),
    ),
    '',
  )
})
