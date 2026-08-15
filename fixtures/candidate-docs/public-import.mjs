import assert from 'node:assert/strict'

import * as root from '@xleepy/wrist-menu'
import * as core from '@xleepy/wrist-menu/core'
import * as react from '@xleepy/wrist-menu/react'
import * as three from '@xleepy/wrist-menu/three'

assert.equal(root.WRIST_MENU_PACKAGE_VERSION, '0.0.0')
assert.equal(core.WRIST_MENU_PACKAGE_VERSION, '0.0.0')
assert.equal(typeof react.WristMenu, 'function')
assert.equal(typeof three.createThreeWristMenuState, 'function')

assert.equal('createWristMenuRuntime' in core, false)
assert.equal('createThreeWristMenu' in three, false)

const snapshot = {
  activationMode: 'forced-closed',
  wrist: 'left',
  menuDefinition: [{ type: 'action', id: 'reset', label: 'Reset' }],
}
const renderer = {
  xr: {
    getSession: () => null,
    getReferenceSpace: () => null,
  },
}
const state = three.createThreeWristMenuState({
  renderer,
  snapshot,
  onEvent: () => undefined,
})
const sessionHandlers = state.sessionHandlers
const referenceSpaceHandler = state.referenceSpaceHandler
const presentationGroup = state.presentation.group

three.syncThreeWristMenu(state, {
  ...snapshot,
  menuDefinition: [{ type: 'action', id: 'reset', label: 'Reset workshop' }],
})
three.updateThreeWristMenu(state, { time: 0, frame: null })

assert.strictEqual(state.sessionHandlers, sessionHandlers)
assert.strictEqual(state.referenceSpaceHandler, referenceSpaceHandler)
assert.strictEqual(state.presentation.group, presentationGroup)
three.disposeThreeWristMenu(state)
three.disposeThreeWristMenu(state)

console.log('public candidate imports and stable handler identities passed')
