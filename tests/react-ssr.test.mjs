import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'

import { WristMenu } from '../dist/react/index.js'

test('the inert React entry point server-renders without output or effects', () => {
  assert.equal(renderToString(createElement(WristMenu)), '')
})
