# Prototype evidence snapshot

Captured 2026-07-18 for [Prototype device-specific wrist offsets and tracking degradation](https://github.com/xleepy/wrist-menu/issues/12).

## Artifact

- Throwaway branch: [`prototype/issue-12-device-wrist-offsets`](https://github.com/xleepy/wrist-menu/tree/prototype/issue-12-device-wrist-offsets)
- Runnable lab and setup: [`prototypes/device-wrist-offsets`](https://github.com/xleepy/wrist-menu/tree/prototype/issue-12-device-wrist-offsets/prototypes/device-wrist-offsets)
- Exact physical gate: [`HITL-CHECKLIST.md`](https://github.com/xleepy/wrist-menu/blob/prototype/issue-12-device-wrist-offsets/prototypes/device-wrist-offsets/HITL-CHECKLIST.md)

This artifact records both deterministic evidence and the accepted provisional Quest 2 decision. Quest 3 and Quest 3S release validation remains separate.

## Provisional Quest 2 decision

Accepted 2026-07-19: use **Quest 2 Touch candidate A** as the default Controller Wrist Proxy for the explicit Quest 2 device target and debug or tune it later if field issues appear.

- Left controller: translation `[0.02, 0.096, 0.008]` metres; rotation `[0, 0, 8]` degrees.
- Right controller: translation `[-0.02, 0.096, 0.008]` metres; rotation `[0, 0, -8]` degrees.
- The transform remains a Host Application override and is not described as anatomical wrist tracking.
- The resolver keys this provisional default to `deviceTarget: "quest-2"`. It does not infer the headset from `XRInputSource.profiles`, because the tested Quest 2 exposed overlapping `oculus-touch-v3`, `oculus-touch-v2`, and legacy aliases.
- Other devices and unknown targets retain the neutral Controller Wrist Proxy fallback.

The physical log run established that candidate A could complete automatic dwell and reveal from a real right Touch controller while fail-closed transitions remained safe. It did not include a subjective comfort verdict. Promoting the value now is an explicit risk acceptance, with later field debugging replacing a blocking comfort gate.

## Deterministic findings

`pnpm traces` replayed the pure boundary used by the WebXR harness and exposed these exact transitions:

- a tracked hand satisfies the provisional 300 ms initial dwell before becoming visible and interactive;
- losing the required wrist pose makes the surface non-interactive on the loss frame, while the last transform remains visible for exactly the configured 250 ms grace;
- at the grace boundary the surface hides, and the same source must satisfy a fresh 200 ms dwell after reacquisition;
- replacing an input-source object with another object of the same kind, handedness, and profiles cancels the old source and requires the same fresh dwell;
- `emulatedPosition` blocks automatic activation, as does `handedness: none`;
- the Touch Plus candidate mirrors lateral translation and roll between left and right Controller Wrist Proxies;
- tracked-hand palm basis and candidate clearance remain handedness-independent;
- the explicit Quest 2 device target selects candidate A by default, while the same overlapping profile aliases on other device targets remain on the neutral fallback.

These findings support the fail-closed model. They do not validate the candidate geometry, optical tracking behavior, haptic feel, or comfort.

## Build and smoke evidence

- Node `v25.9.0`
- Three.js `0.185.1`
- Vite `8.1.5`
- `pnpm build`: succeeded; produced a static `dist/` bundle.
- local Vite smoke load: HTTP 200; the lab title and Quest 2 lane were present.

The bundle-size warning is accepted for this disposable, single-route prototype. Production package size and code splitting are outside this ticket.

## Still unknown by construction

- whether field use requires adjusting the provisional Quest 2 candidate A transform;
- the concrete offsets comfortable on Quest 3 and Quest 3S for either wrist;
- real hand-occlusion timing/noise and whether 250/200 ms should remain shipped defaults;
- the exact profile strings and haptic actuators/effects exposed by each tested Browser/OS combination;
- whether a reported haptic request is physically felt;
- whether Quest 3 and Quest 3S agree closely enough for package defaults or need profile/device overrides.

The next Quest 2 run is now a regression/debugging activity rather than a release blocker. Quest 3 and Quest 3S remain required before making the version-1 release-device decision.
