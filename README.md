# @xleepy/wrist-menu

An ESM-only WebXR Wrist Menu Package with framework-neutral, Three.js, and React
Three Fiber entry points.

The first `0.0.0` vertical slice presents one forced-open Action Item and gives
controller target rays the same selection semantics in vanilla Three.js and
React Three Fiber.

```ts
import type { HostSnapshot } from '@xleepy/wrist-menu'

const snapshot = {
  activationMode: 'forced-open',
  wrist: 'left',
  menuDefinition: [
    { type: 'action', id: 'spawn-cube', label: 'Spawn cube' },
  ],
} as const satisfies HostSnapshot
```

Vanilla hosts create a `createThreeWristMenu` instance, attach its stable
`group`, and call `update({ time, frame })` from their existing XR loop. Before
handling a scene action, call `blocksSceneInput(inputSource)` so the same
physical action cannot also affect content behind the menu. React hosts mount
`<WristMenu snapshot={snapshot} onEvent={onEvent} />` inside their R3F tree; its
managed Scene Event Shield stops synthetic events behind active Hit Regions.

The core `createWristMenuRuntime` accepts only portable Frame Samples and Target
Observations. A controller arms on select start and commits on release over the
same Action Item. Newly created presentation geometry becomes targetable only
after one Frame Sample.

Only the package root, `/core`, `/three`, and `/react` are public. Deep imports
are unsupported.
