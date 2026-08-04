# @xleepy/wrist-menu

An ESM-only WebXR Wrist Menu Package with framework-neutral, Three.js, and React
Three Fiber entry points.

The `0.0.0` implementation attaches a complete, Host-controlled version-1 Menu
Definition to a tracked wrist or Controller Wrist Proxy, reveals it
intentionally, and gives direct hands and controller target rays the same
selection semantics in vanilla Three.js and React Three Fiber.

```ts
import type { HostSnapshot } from '@xleepy/wrist-menu'

const snapshot = {
  activationMode: 'automatic',
  wrist: 'left',
  // Optional values override the documented 35° / 50° and 300 / 200 ms defaults.
  comfort: { enterAngleDegrees: 30 },
  menuDefinition: [
    { type: 'action', id: 'reset', label: 'Reset workshop', iconKey: 'reset' },
    { type: 'separator', label: 'Scene' },
    { type: 'toggle', id: 'grid', label: 'Show grid', value: true },
    {
      type: 'choice-group',
      id: 'shape',
      label: 'Primitive shape',
      selectedValue: 'cube',
      options: [
        { id: 'cube', label: 'Cube', value: 'cube' },
        { id: 'sphere', label: 'Sphere', value: 'sphere' },
      ],
    },
    {
      type: 'action',
      id: 'remove',
      label: 'Remove selection',
      disabled: true,
      disabledReason: 'Select a Workshop Object first',
    },
  ],
} as const satisfies HostSnapshot
```

Interactive IDs and Choice Group IDs are stable and globally unique. Choice
values are strings or finite numbers; Toggle Item values are booleans. Every
interactive item requires a label, may provide a portable `iconKey`, and may be
disabled with an optional reason. Separators may omit both identity and label.

`sync(nextSnapshot)` validates and deeply copies the complete input immediately,
then applies the latest valid snapshot atomically at the next Frame Sample. A
failed sync leaves both the live and already-queued snapshots unchanged.

Selection Intents are proposals. An Action Item reports its `itemId`; a Toggle
Item reports its current and proposed boolean values; a choice reports its
group, item, current value, and proposed value. The Wrist Menu Package never
changes displayed Toggle or Choice state itself—the Host Application supplies
the next complete snapshot.

The current Renderer Integration preserves this complete semantic content on
ordered rows and explicit Hit Regions, including portable labels, icon keys,
values, selected state, and disabled reasons. The production Reach typography,
procedural icon atlas, and virtualized viewport are a separate presentation
milestone; they do not change this Host or event contract.

Vanilla hosts create a Wrist Menu Instance with `createThreeWristMenuState`,
attach its stable `presentation.group`, and call
`updateThreeWristMenu(state, { time, frame })` from their existing XR loop.
Before handling a scene action, call
`threeWristMenuBlocksSceneInput(state, inputSource)` so the same physical action
cannot also affect content behind the menu. React hosts mount
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

The core `createWristMenuRuntimeState` creates renderer-neutral instance state.
Custom Renderer Integrations pass only portable Frame Samples and Target
Observations to `stepWristMenuRuntime`. A `FrameSample` contains current-frame viewer and wrist
poses plus a `lifecycleRevision` that custom integrations increment after
session, reference-space, recenter, or attachment resets. A controller arms on select
start and commits on release over the same enabled Menu Item. A direct hand
focuses with the index fingertip and commits when its reported fingertip sphere
reaches the Hit Region's press plane. Both routes emit the same source-independent
Selection Intent. Moving or leaving an owned item cancels without transfer;
hands must withdraw beyond the hover volume and controllers must release before
rearming. Disabled items can show unavailable hover feedback but never commit,
claim scene input, or request haptics. Optional controller haptics are best-effort
feedback and cannot affect event delivery.

Newly revealed, moved, or recreated presentation geometry becomes targetable
only after a following Frame Sample. Tracking loss, source replacement,
visibility interruption, reparenting, session end, and disposal cancel
interaction and require fresh acquisition.

Selection Intent diagnostics identify the portable Selection Source ID, kind,
and handedness without exposing raw XR objects. The event sink also receives
source-independent `visibility-change` events with
the authoritative automatic, Host Application, tracking, source-replacement,
or XR lifecycle reason.

Only the package root, `/core`, `/three`, and `/react` are public. Deep imports
are unsupported.
