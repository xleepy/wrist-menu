# THROWAWAY PROTOTYPE: device wrist offsets and tracking degradation

This production-shaped evidence harness asks which controller grip-to-wrist and tracked-hand wrist offsets, confidence rules, visual-grace behavior, source-replacement rules, and optional haptic capabilities are comfortable enough to ship. It is the primary-source artifact for [Prototype device-specific wrist offsets and tracking degradation](https://github.com/xleepy/wrist-menu/issues/12), not Wrist Menu Package implementation code.

Quest 2 Touch candidate A is the **provisional Quest 2 Controller Wrist Proxy default**. It is selected only for the explicit Quest 2 device target and remains Host Application-overridable. Every other offset remains a calibration hypothesis. Deterministic traces can reject unsafe state transitions; physical use is still needed to debug reach, clipping, comfort, tracking quality, and felt haptics.

## Run it

Install once from the repository root:

```powershell
pnpm --dir prototypes/device-wrist-offsets install --frozen-lockfile
```

Then start the whole lab with one command:

```powershell
pnpm --dir prototypes/device-wrist-offsets dev
```

For a Quest connected over USB, keep the development origin trustworthy by reversing the Vite port and opening the headset's own `localhost` origin:

```powershell
adb reverse tcp:5173 tcp:5173
```

Open `http://localhost:5173` in Meta Quest Browser. Alternatively, build with `pnpm --dir prototypes/device-wrist-offsets build` and serve `dist/` from any trusted HTTPS origin. WebXR will not start from an ordinary insecure LAN URL.

### Local VR test logs

The development server forwards prototype lifecycle, anchor-state, configuration, selection, haptic, observation, and evidence-copy events to a small same-origin listener. Uncaught browser errors and promise rejections are included too.

Each server start prints the exact local output path. Logs are newline-delimited JSON under:

```text
prototypes/device-wrist-offsets/.local/vr-test-logs/device-wrist-offsets-<timestamp>.jsonl
```

The `.local/` directory is ignored by Git and requests are limited to 64 KiB. Logging runs only in the Vite development server; the ordinary static build has no logging side effects.

For an explicit marker from the browser console:

```js
window.__VR_TEST_LOG__('tester.note', { note: 'left controller clipped the panel' })
```

The deterministic interruption evidence is one command:

```powershell
pnpm --dir prototypes/device-wrist-offsets traces
```

## What the harness exercises

- standard tracked-hand `wrist` joint poses and the handedness-independent local `-Y` palm normal;
- handedness-specific Controller Wrist Proxies derived from `gripSpace`, never `targetRaySpace`;
- concrete per-profile candidate presets plus six live translation/rotation fields;
- both menu wrists and actual `XRInputSource.profiles` capture;
- immediate non-interactivity on pose loss, a provisional 250 ms cached-transform grace, expiry, and fresh 200 ms dwell;
- replacement of an `XRInputSource` object even when handedness and profiles are unchanged;
- low confidence from `emulatedPosition`, unsupported `handedness: none`, and XR visibility interruption;
- optional Gamepad haptic capability/effect discovery and a deliberately small probe on controller `select`;
- in-memory pass/adjust/fail observations with exact device, Horizon OS, and Browser version fields.

The calibration activation mode deliberately shows a diagnostic panel whenever a source pose exists so an offset can be tuned. Automatic mode applies the already-decided provisional 35° enter, 50° exit, 300 ms initial dwell, 200 ms reacquisition dwell, and 250 ms visual-only grace semantics.

The visual panel turns amber during grace. Its `SAFE / BLOCKED` label means no pending selection may survive. The lab's select probe is only an interruption/haptic diagnostic; it is not a production menu hit-test implementation.

## Preset policy

`oculus-touch-v2`, `oculus-touch-v3`, and other actual profile strings are captured from the session. Quest 2 exposes overlapping Touch compatibility aliases, so profile strings alone do not identify the headset. Candidate A is therefore selected through the explicit Quest 2 target, never user-agent sniffing, and is not claimed to be anatomically exact. Unknown and non-Quest-2 devices keep the neutral Controller Wrist Proxy fallback; every Host Application can override the concrete transform.

Quest 2 is an immediate, useful **provisional evidence lane** because hardware is available. Passing it does not establish a Quest 2 support guarantee and does not replace the unresolved Quest 3 and Quest 3S release-device lanes.

## Files

- `src/anchor-model.mjs` is the pure pose/preset/tracking boundary shared by real WebXR frames and deterministic traces.
- `src/main.js` is the disposable Three.js/WebXR calibration and evidence UI.
- `scripts/run-traces.mjs` replays deterministic hands, controllers, loss/grace, confidence, replacement, and mirrored-offset scenarios without pretending to measure comfort.
- `HITL-CHECKLIST.md` is the smallest physical-user gate that can resolve the ticket.

No state persists automatically. Copying evidence JSON is an explicit user action; clearing the run removes all in-memory observations.
