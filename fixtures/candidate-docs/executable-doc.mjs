import assert from 'node:assert/strict'

import {
  createWristMenuRuntimeState,
  disposeWristMenuRuntime,
  stepWristMenuRuntime,
  syncWristMenuRuntime,
  wristMenuRuntimeBlocksSceneInput,
} from '@xleepy/wrist-menu/core'

const firstSnapshot = {
  activationMode: 'forced-closed',
  wrist: 'left',
  menuDefinition: [{ type: 'action', id: 'reset', label: 'Reset' }],
}
const events = []
const state = createWristMenuRuntimeState({
  snapshot: firstSnapshot,
  onEvent: (event) => events.push(event),
})

const frame = (sequence) => ({
  sequence,
  time: sequence * 16,
  visibility: 'visible',
  viewerPosition: [0, 0, 0],
  wristSources: [],
  lifecycleRevision: 0,
  selectionSources: [],
})

const initialModel = stepWristMenuRuntime(state, frame(1), [])
assert.equal(initialModel.visible, false)
assert.strictEqual(state.snapshot.menuDefinition[0].label, 'Reset')

const nextSnapshot = {
  ...firstSnapshot,
  menuDefinition: [
    { type: 'action', id: 'reset', label: 'Reset workshop', disabled: true },
  ],
}
syncWristMenuRuntime(state, nextSnapshot)
assert.strictEqual(state.pendingSnapshot.menuDefinition[0].label, 'Reset workshop')

stepWristMenuRuntime(state, frame(2), [])
assert.strictEqual(state.snapshot.menuDefinition[0].label, 'Reset workshop')
assert.equal(state.pendingSnapshot, undefined)
assert.equal(wristMenuRuntimeBlocksSceneInput(state, 'controller-right'), false)
assert.deepEqual(events, [])

disposeWristMenuRuntime(state)
disposeWristMenuRuntime(state)
assert.throws(() => stepWristMenuRuntime(state, frame(3), []), /disposed/)

console.log('executable state API documentation passed')
