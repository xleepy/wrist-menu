# Prototype evidence snapshot

Captured 2026-07-18 for [Prototype device-specific wrist offsets and tracking degradation](https://github.com/xleepy/wrist-menu/issues/12).

## Artifact

- Throwaway branch: [`prototype/issue-12-device-wrist-offsets`](https://github.com/xleepy/wrist-menu/tree/prototype/issue-12-device-wrist-offsets)
- Runnable lab and setup: [`prototypes/device-wrist-offsets`](https://github.com/xleepy/wrist-menu/tree/prototype/issue-12-device-wrist-offsets/prototypes/device-wrist-offsets)
- Exact physical gate: [`HITL-CHECKLIST.md`](https://github.com/xleepy/wrist-menu/blob/prototype/issue-12-device-wrist-offsets/prototypes/device-wrist-offsets/HITL-CHECKLIST.md)

This is a progress artifact. The issue remains open because no agent-generated trace can substitute for a headset wearer's feedback.

## Deterministic findings

`pnpm traces` replayed the pure boundary used by the WebXR harness and exposed these exact transitions:

- a tracked hand satisfies the provisional 300 ms initial dwell before becoming visible and interactive;
- losing the required wrist pose makes the surface non-interactive on the loss frame, while the last transform remains visible for exactly the configured 250 ms grace;
- at the grace boundary the surface hides, and the same source must satisfy a fresh 200 ms dwell after reacquisition;
- replacing an input-source object with another object of the same kind, handedness, and profiles cancels the old source and requires the same fresh dwell;
- `emulatedPosition` blocks automatic activation, as does `handedness: none`;
- the Touch Plus candidate mirrors lateral translation and roll between left and right Controller Wrist Proxies;
- tracked-hand palm basis and candidate clearance remain handedness-independent;
- actual profile lists select only neutral baselines automatically; named Quest candidates require explicit selection.

These findings support the fail-closed model. They do not validate the candidate geometry, optical tracking behavior, haptic feel, or comfort.

## Build and smoke evidence

- Node `v25.9.0`
- Three.js `0.185.1`
- Vite `8.1.5`
- `pnpm build`: succeeded; produced a static `dist/` bundle.
- local Vite smoke load: HTTP 200; the lab title and Quest 2 lane were present.

The bundle-size warning is accepted for this disposable, single-route prototype. Production package size and code splitting are outside this ticket.

## Still unknown by construction

- the concrete offsets comfortable on Quest 2, Quest 3, and Quest 3S for either wrist;
- whether Quest 2 evidence supports a provisional profile override or no compatibility claim;
- real hand-occlusion timing/noise and whether 250/200 ms should remain shipped defaults;
- the exact profile strings and haptic actuators/effects exposed by each tested Browser/OS combination;
- whether a reported haptic request is physically felt;
- whether Quest 3 and Quest 3S agree closely enough for package defaults or need profile/device overrides.

The immediate next evidence is a real wearer's Quest 2 run through `HITL-CHECKLIST.md`. Quest 3 and Quest 3S remain required before this issue can make the version-1 release-device decision.
