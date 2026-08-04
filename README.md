# @xleepy/wrist-menu

An ESM-only WebXR Wrist Menu Package with framework-neutral, Three.js, and React
Three Fiber entry points.

The `0.0.0` implementation supports a complete, Host-controlled version-1 Menu
Definition and gives controller target rays the same selection semantics in
vanilla Three.js and React Three Fiber.

```ts
import type { HostSnapshot } from '@xleepy/wrist-menu'

const snapshot = {
  activationMode: 'forced-open',
  wrist: 'left',
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

Vanilla hosts create a `createThreeWristMenu` instance, attach its stable
`group`, and call `update({ time, frame })` from their existing XR loop. Before
handling a scene action, call `blocksSceneInput(inputSource)` so the same
physical action cannot also affect content behind the menu. React hosts mount
`<WristMenu snapshot={snapshot} onEvent={onEvent} />` inside their R3F tree; its
managed Scene Event Shield stops synthetic events behind active Hit Regions.

The core `createWristMenuRuntime` accepts only portable Frame Samples and Target
Observations. A controller arms on select start and commits on release over the
same enabled Menu Item. Newly created presentation geometry becomes targetable
only after one Frame Sample.

Only the package root, `/core`, `/three`, and `/react` are public. Deep imports
are unsupported.
