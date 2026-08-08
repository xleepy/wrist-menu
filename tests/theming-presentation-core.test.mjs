import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createWristMenuRuntimeState,
  defaultThemeTokens,
  stepWristMenuRuntime,
} from '../dist/core/index.js'
import {
  controllerActionSnapshot,
  frameSample,
} from '../fixtures/controller-action.mjs'

test('Host theme overrides resolve onto the curated Presentation Model without changing Menu Definition semantics', () => {
  const theme = { panelColor: 0x123456, panelWidthMeters: 0.24 }
  const snapshot = {
    ...controllerActionSnapshot,
    theme,
  }
  const runtime = createWristMenuRuntimeState({
    snapshot,
    onEvent: () => undefined,
  })

  theme.panelColor = 0xffffff
  const model = stepWristMenuRuntime(runtime, frameSample(1, false), [])

  assert.deepEqual(model.theme, {
    ...defaultThemeTokens,
    panelColor: 0x123456,
    panelWidthMeters: 0.24,
  })
  assert.ok(Object.isFrozen(model.theme))
  assert.deepEqual(model.items, [
    {
      type: 'action',
      id: 'spawn-cube',
      label: 'Spawn cube',
      disabled: false,
      interaction: 'idle',
    },
  ])
})

test('Host theme validation rejects unsupported and non-portable token values', () => {
  assert.throws(
    () =>
      createWristMenuRuntimeState({
        snapshot: {
          ...controllerActionSnapshot,
          theme: { panelColour: 0x123456 },
        },
        onEvent: () => undefined,
      }),
    /unsupported field: panelColour/,
  )
  assert.throws(
    () =>
      createWristMenuRuntimeState({
        snapshot: {
          ...controllerActionSnapshot,
          theme: { panelColor: 0x1000000 },
        },
        onEvent: () => undefined,
      }),
    /theme\.panelColor must be an integer/,
  )
})
