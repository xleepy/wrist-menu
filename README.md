# @xleepy/wrist-menu

An ESM-only WebXR Wrist Menu Package with framework-neutral, Three.js, and React
Three Fiber entry points.

The current `0.0.0` slice attaches an Action Item menu to a tracked wrist or
Controller Wrist Proxy, reveals it intentionally, and gives controller target
rays the same selection semantics in vanilla Three.js and React Three Fiber.

```ts
import type { HostSnapshot } from '@xleepy/wrist-menu'

const snapshot = {
  activationMode: 'automatic',
  wrist: 'left',
  // Optional values override the documented 35° / 50° and 300 / 200 ms defaults.
  comfort: { enterAngleDegrees: 30 },
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

Tracked hands use the current frame's standard `wrist` joint. Motion
controllers use `gripSpace` plus a Controller Wrist Proxy; `targetRaySpace`
remains dedicated to pointing. The neutral proxy is the unknown-device
fallback. Set `controllerWrist.deviceTarget` to `quest-2` to select the
provisional mirrored Quest 2 candidate A, or provide a named preset or
handedness-specific concrete offsets. Profile aliases never infer a headset.

Automatic activation enters at 35°, exits above 50°, dwells for 300 ms on
initial acquisition and 200 ms after interruption, holds a non-interactive
cached transform for up to 250 ms of tracking loss, and uses 150 ms ordinary
show/hide transitions. These values are available as
`defaultRevealConfiguration` and may be overridden through `comfort`.
`forced-open`, `forced-closed`, and `disabled` are also supported; WebXR hidden
or blurred lifecycle safety always takes precedence.

The core `createWristMenuRuntime` accepts only portable Frame Samples and Target
Observations. A `FrameSample` contains current-frame viewer and wrist poses plus
a `lifecycleRevision` that custom integrations increment after session,
reference-space, recenter, or attachment resets. A controller arms on select
start and commits on release over the same Action Item. Newly revealed, moved,
or recreated presentation geometry becomes targetable only after a following
Frame Sample. Tracking loss, source replacement, visibility interruption,
reparenting, session end, and disposal cancel interaction and require fresh
acquisition.

The event sink also receives source-independent `visibility-change` events with
the authoritative automatic, Host Application, tracking, source-replacement,
or XR lifecycle reason.

Only the package root, `/core`, `/three`, and `/react` are public. Deep imports
are unsupported.
