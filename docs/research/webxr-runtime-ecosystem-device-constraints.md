# WebXR runtime, ecosystem, and device constraints

Research for [GitHub issue #2](https://github.com/xleepy/wrist-menu/issues/2), captured 2026-07-18. The scope is version 1 of the browser-only, `immersive-vr` Wrist Menu Package and its vanilla Three.js and React Three Fiber (R3F) integrations. Sources are specifications and first-party project/vendor documentation; version values are a point-in-time snapshot, not evergreen guarantees.

## Decision summary

Version 1 can be built on standard WebXR contracts without requiring `@react-three/xr`:

- The Host Application owns the `XRSession`, renderer, reference-space/origin setup, and render loop. The Wrist Menu Package consumes the current `XRFrame`, `XRReferenceSpace`, viewer pose, and `XRInputSource` objects.
- Articulated hands use the `wrist` joint. In a joint's local frame, `-Y` points out through the palm and wrist `-Z` points roughly toward the center of the palm, so palm-facing activation has a standard, handedness-independent normal. The Hand Input specification defines all 25 joints and requires an all-joints-or-no-joints result when a hand is obscured ([WebXR Hand Input, joint spaces](https://www.w3.org/TR/webxr-hand-input-1/#xrjointspace-interface)).
- Motion controllers use `gripSpace` for the approximate wrist anchor and `targetRaySpace` for pointing. These spaces are deliberately different; a target ray runs along local `-Z`, while grip axes model a held object/curled hand ([WebXR Device API, input sources](https://www.w3.org/TR/webxr/#xrinputsource-interface)). Controller-to-wrist translation remains a configurable approximation, not a platform guarantee.
- Tracking is valid only for the current XR frame. A missing pose immediately cancels interaction; a short visual grace period may hold the last transform, but must not keep hit targets active. Input-mode switches, visibility changes, reference-space resets, and session end are first-class state transitions.
- Publish side-effect-free subpath entry points for core, Three.js, and R3F. Importing any entry point must not touch `window`, `navigator`, create a renderer, request a session, or install an emulator. WebXR is a secure-context, `Window`-exposed API and immersive entry requires transient user activation ([WebXR initialization and application flow](https://www.w3.org/TR/webxr/#initialization)).
- Release validation must combine pure deterministic tests, browser integration tests driven by Meta's IWER, adapter harnesses, and real Quest comfort/performance runs. Emulation is not evidence of headset tracking quality or performance.

## Current standards and dependency snapshot

The W3C WebXR Device API is a Candidate Recommendation Draft, while Hand Input, WebXR Gamepads, and Gamepad haptics are still Working Drafts. Their status means the package must feature-detect optional members and keep browser-specific behavior behind adapters, even when the underlying geometry contracts are normative ([WebXR status](https://www.w3.org/TR/webxr/), [Hand Input status](https://www.w3.org/TR/webxr-hand-input-1/), [WebXR Gamepads status](https://www.w3.org/TR/webxr-gamepads-module-1/), [Gamepad status](https://www.w3.org/TR/gamepad/)).

| Surface | Current snapshot | Upstream contract | Version-1 recommendation |
| --- | --- | --- | --- |
| WebXR Device API | W3C Candidate Recommendation Draft | Secure-context `navigator.xr`, `immersive-vr`, spaces, poses, inputs, session lifecycle | Required at runtime; capability-detect `navigator.xr` and `isSessionSupported('immersive-vr')` |
| WebXR Hand Input | W3C Working Draft, 2024-06-05 snapshot | `hand-tracking`, `XRHand`, 25 joints, `getJointPose()` | Request as an optional session feature and use when `inputSource.hand` exists |
| WebXR Gamepads | W3C Working Draft, 2025-07-07 snapshot | Optional `XRInputSource.gamepad`, live button/axis state | Prefer semantic `select*` events; use Gamepad only for optional haptics or non-primary controls |
| Three.js | `0.185.1` / r185 | ESM package; `WebGLRenderer.xr` exposes the session, frame, reference space, target-ray groups, grip groups, and hand groups ([r185 manifest](https://github.com/mrdoob/three.js/blob/r185/package.json), [WebXRManager](https://threejs.org/docs/pages/WebXRManager.html)) | Initial runtime peer: `three >=0.185.1 <0.186.0`; widen only after lower revisions pass the same adapter tests |
| `@types/three` | `0.185.1` | Three.js declarations matching r185 ([npm registry](https://www.npmjs.com/package/@types/three)) | Development/type dependency aligned with the tested Three revision |
| R3F | `9.6.1` current; `8.18.0` maintained React-18 line | v9.6.1 peers on React `>=19 <19.3` and Three `>=0.156`; v8.18 peers on React `>=18 <19` and Three `>=0.133` ([v9.6.1 manifest](https://github.com/pmndrs/react-three-fiber/blob/v9.6.1/packages/fiber/package.json), [npm registry](https://www.npmjs.com/package/%40react-three/fiber)) | Adapter peer: `@react-three/fiber >=8.18.0 <10`, with two CI lanes: R3F 8 + React 18 and R3F 9 + React 19 |
| React | `19.2.7` current | R3F selects the compatible React major ([npm registry](https://www.npmjs.com/package/react)) | Adapter peer: `react >=18 <19.3`; do not import React from core or Three entry points |
| `@react-three/xr` | `6.6.30` | Peers: R3F `>=8`, React/React DOM `>=18`, Three `*`; owns an optional XR store and interaction system ([package](https://www.npmjs.com/package/%40react-three/xr), [store docs](https://pmndrs.github.io/xr/docs/tutorials/store)) | Compatibility lane only; not a dependency or peer of the Wrist Menu Package |
| `@types/webxr` | `0.5.24` | Ambient WebXR declarations ([npm registry](https://www.npmjs.com/package/@types/webxr)) | Type dependency while TypeScript's DOM library lacks the required complete XR declarations |
| IWER / `@iwer/devui` | `2.3.0` | Meta's programmatic WebXR emulation runtime and development UI ([IWER](https://meta-quest.github.io/immersive-web-emulation-runtime/)) | Development dependencies only; pin the exact version used in recorded tests |
| Meta Quest Browser | `146.2`, released 2026-06-03; 146.0 moved to Chromium 146 | Standalone target browser; release train changes independently of npm packages ([Meta Browser release notes](https://developers.meta.com/horizon/release-notes/?search_key=browser)) | Test the latest stable browser on physical Quest devices; never gate behavior on a UA/version string |

The narrow initial Three.js peer is intentional. Three.js is still versioned below `1.0`, and a registry declaration alone cannot prove behavior across older revisions. After CI demonstrates compatibility, a patch release can widen the range (for example, one revision at a time) without pretending an untested range is supported. R3F's published peer ranges are broader, but the Wrist Menu Package should publish only the matrix it continuously tests.

## Runtime ownership and session contract

The Host Application should remain the only owner of immersive session creation. WebXR expects a page to probe `isSessionSupported()`, wait for user activation, then request the session; optional features progressively enhance a session without blocking it ([WebXR application flow and feature dependencies](https://www.w3.org/TR/webxr/#feature-dependencies)). The Wrist Menu Package should therefore export recommended session requirements rather than calling `requestSession()` itself:

```ts
export const wristMenuSessionFeatures = {
  optionalFeatures: ['hand-tracking', 'local-floor'] as const,
}
```

`hand-tracking` must be requested for a user agent to expose `XRInputSource.hand`, but making it required would unnecessarily reject a controller-only session ([Hand Input initialization](https://www.w3.org/TR/webxr-hand-input-1/#initialization)). `local-floor` is useful to the Host Application but is not essential to wrist-relative math, so the package must also work in the default `local` reference space.

The core per-frame boundary should accept normalized data, not browser globals:

```ts
type WristMenuFrame = {
  time: DOMHighResTimeStamp
  viewer: PoseSample | null
  menuSource: InputSample | null
  interactionSources: readonly InputSample[]
  visibility: XRVisibilityState
}
```

The Three.js and R3F adapters translate actual WebXR objects into this boundary. This keeps activation, hysteresis, layout state, and hit testing deterministic and testable without a browser.

### Render-loop integration

All pose queries and menu updates happen in the host's XR animation loop. WebXR warns that `window.requestAnimationFrame()` may not align with, or may stop during, an immersive session ([WebXR animation frames](https://www.w3.org/TR/webxr/#animation-frames)). Three.js recommends `WebGLRenderer.setAnimationLoop()` instead of manually scheduling animation frames ([WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html#setAnimationLoop)). The vanilla adapter should provide `update(xrFrame, time)` and never install a competing loop.

In R3F, `useFrame((state, delta, xrFrame) => ...)` already runs at native refresh inside the shared loop and exposes `state.gl` as the renderer ([R3F hooks](https://r3f.docs.pmnd.rs/api/hooks)). The R3F integration should subscribe with `useFrame`, update Three objects imperatively, reuse math objects, and avoid React state changes per frame.

## Coordinate and frame conventions

### Reference and scene space

An `XRSpace` is opaque; its pose is meaningful only relative to another `XRSpace` at a specific `XRFrame`. Native reference-space axes are right-handed: `+X` right, `+Y` up, and `-Z` forward ([WebXR spaces](https://www.w3.org/TR/webxr/#spaces)). Three.js uses compatible right-handed transforms, but a Host Application may add locomotion or an R3F/`@react-three/xr` origin transform.

Consequently:

1. Query every viewer, joint, grip, and ray pose relative to the exact `XRReferenceSpace` used by the host renderer.
2. Apply one explicit `worldFromReference` transform, or parent the menu under the host's XR-origin object. Do not assume the reference-space transform equals scene world space.
3. Use the current frame only. `XRFrame.getPose()`/`getJointPose()` results describe the frame's time, and Three.js's `getFrame()` is meaningful only in the animation loop ([WebXR spatial tracking](https://immersive-web.github.io/webxr/spatial-tracking-explainer.html), [Three.js WebXRManager](https://threejs.org/docs/pages/WebXRManager.html)).
4. Recompute from source poses after reference-space `reset`; do not patch cached world coordinates.

### Hand joints and palm-facing activation

`XRHand` is an ordered map of exactly 25 standard joints. The Wrist Menu Package needs at least:

- `wrist` for the menu anchor and orientation;
- `index-finger-tip` plus its `XRJointPose.radius` for direct-touch selection;
- optionally the other metacarpals/tips for validation or a fallback palm plane, not as the primary v1 contract.

The complete joint list and indices are normative ([Hand Input skeleton joints](https://www.w3.org/TR/webxr-hand-input-1/#skeleton-joints)). The joint-space local axes are especially useful: local `-Y` points perpendicular to the skin, outward from the palm; local `-Z` follows the associated bone away from the wrist, and wrist `-Z` should point roughly toward the palm center ([Hand Input joint spaces](https://www.w3.org/TR/webxr-hand-input-1/#xrjointspace-interface)). Therefore no left/right sign correction is needed for a tracked-hand palm normal:

```ts
const palmNormal = rotate(wristOrientation, [0, -1, 0])
const towardViewer = normalize(viewerPosition - wristPosition)
const facingScore = dot(palmNormal, towardViewer) // -1..1
```

Automatic activation should compare `facingScore` with configurable angular thresholds (`cos(angle)`), then apply dwell and hysteresis. Enter and exit thresholds must differ; otherwise normal tracking noise around one angle will flicker. Position/angle smoothing must be time-based and must not span a tracking-loss or visibility boundary.

The package should use `getJointPose()` first. Bulk `fillPoses()`/`fillJointRadii()` can be added only after the physical-browser matrix confirms them; the specification defines them, but public compatibility tables have historically lagged device implementations. The Hand Input contract also says a partially obscured hand is either fully emulated or all joint poses are unavailable, so code must treat any required joint failure as a hand-level loss rather than silently mixing old and new joints ([Hand Input frame loop](https://www.w3.org/TR/webxr-hand-input-1/#xrframe-interface)).

### Controller fallback

For a `tracked-pointer` controller with a non-null `gripSpace`:

- Anchor the approximate wrist from the grip pose. The grip origin represents the center of curled fingers; local `-Z` follows a held rod toward the thumb, local `+Y` points roughly toward the arm, and the back of a right hand points `+X` while the back of a left hand points `-X` ([WebXR grip-space definition](https://www.w3.org/TR/webxr/#xrinputsource-interface)).
- A useful initial palm-normal approximation is local `-X` for a right controller and local `+X` for a left controller, transformed by the grip orientation. Offset the wrist from the grip mainly along local `+Y`, but keep translation and rotation offsets configurable per handedness and, later, per `inputSource.profiles` entry.
- Use `targetRaySpace` only for pointing; its ray extends along local `-Z`. Its ergonomic orientation is platform-specific and is not a reliable wrist surface ([WebXR target-ray definition](https://www.w3.org/TR/webxr/#xrinputsource-interface)).
- If `gripSpace` is null, handedness is `none`, or the grip pose is missing/emulated, automatic wrist activation is unavailable by default. A Host Application may force the menu open, but the package should not fabricate a confident wrist pose from a gaze/screen ray.

Three.js already distinguishes these spaces: `getController()` represents the target ray, while `getControllerGrip()` represents grip space ([Three.js WebXRManager](https://threejs.org/docs/pages/WebXRManager.html)). Match input sources by `XRInputSource.handedness` and events, not by assuming renderer index 0 is left or right.

### Selection and haptics

For controllers, consume WebXR `selectstart`, `selectend`, and `select` as the primary action. These semantic events survive controller-profile differences and are fired for a completed primary action by the core WebXR contract ([WebXR input events](https://www.w3.org/TR/webxr/#event-types)). Raycast from target-ray `-Z` against menu hit targets.

For direct hands, intersect the opposite hand's `index-finger-tip` sphere using the reported radius; the Hand Input specification explicitly gives tip joints a non-zero radius so fingertip collisions can work ([joint radius](https://www.w3.org/TR/webxr-hand-input-1/#skeleton-joints)). Use enter/exit penetration thresholds or debouncing so one contact produces one semantic action.

Haptics are optional enhancement. An XR input source may expose a live `gamepad`, and the Gamepad draft exposes supported haptic effects through a `GamepadHapticActuator` ([WebXR Gamepads](https://www.w3.org/TR/webxr-gamepads-module-1/), [Gamepad haptics](https://www.w3.org/TR/gamepad/#gamepadhapticactuator-interface)). Feature-detect the actuator and effect before calling it, cap duration/intensity, swallow rejected promises, and never make action delivery depend on vibration. Hand input normally has no actuator.

## Tracking loss and lifecycle state machine

`getPose()` may return `null` when tracking is lost or an input source is unavailable, and `emulatedPosition` signals that translation is not based on direct sensor data ([WebXR input explainer](https://immersive-web.github.io/webxr/input-explainer.html#targeting-ray-pose)). The package should implement the following rules:

| Event/condition | Required response |
| --- | --- |
| Required wrist/viewer/interaction pose is `null` | Mark source invalid for that frame; cancel hover, press, dwell, and haptics immediately |
| Short hand/grip loss | Optionally display the last menu transform for a small configurable grace period, but make it non-interactive and do not advance activation timers |
| Loss exceeds grace period | Hide the menu and clear smoothed pose/history |
| Pose reacquired | Require fresh activation dwell/stability; never complete a press begun before loss |
| `pose.emulatedPosition === true` | Treat as low confidence; controller visuals may remain, but automatic wrist activation defaults off |
| `inputsourceschange` | Rebuild source bindings from `session.inputSources`; attributes can cause an old source object to be removed and a new one added ([WebXR source changes](https://www.w3.org/TR/webxr/#event-types)) |
| `visibilityState === 'visible-blurred'` | Pause activation and all input; callbacks may be throttled and input is not processed |
| `visibilityState === 'hidden'` | Hide/cancel; XR animation callbacks stop until visibility changes |
| Visibility returns to `visible` | Clear cached poses and require reacquisition/dwell |
| Reference-space `reset` | Clear filters and recompute all transforms in the next valid frame |
| Session `end` or adapter unmount | Remove listeners, clear references, dispose only package-owned Three resources |

The visibility behavior above follows the WebXR session contract: `visible-blurred` may throttle frames and does not process input; `hidden` stops XR animation callbacks ([WebXR visibility state](https://www.w3.org/TR/webxr/#dom-xrsession-visibilitystate)).

## Renderer integrations and `@react-three/xr`

### Vanilla Three.js

The adapter should accept a `WebGLRenderer` and a destination `Object3D`/XR-origin parent. It may read `renderer.xr.getSession()`, `getReferenceSpace()`, and the current frame, but it must not call `setAnimationLoop()`, `setSession()`, change reference-space type, framebuffer scale, or foveation. Those are Host Application policies ([Three.js WebXRManager](https://threejs.org/docs/pages/WebXRManager.html)).

### React Three Fiber

The R3F component should use `useThree(state => state.gl)` and `useFrame(..., negativePriority)` so it runs before ordinary scene work without taking over rendering. It should return/attach ordinary Three objects. React props update configuration and content; frame poses update object transforms outside React state ([R3F hooks](https://r3f.docs.pmnd.rs/api/hooks)).

### Optional `@react-three/xr` compatibility

No import from `@react-three/xr` is necessary. Its `<XR>` component and store still drive the same R3F renderer/session; the Wrist Menu Package can operate from `state.gl.xr` and `xrFrame`. The compatibility example should:

- mount the menu beneath the same transformed origin as the XR rig, so locomotion/`XROrigin` is respected;
- disable or scope overlapping `@react-three/xr` pointer handlers on menu meshes if both systems would otherwise act on them;
- allow `@react-three/xr` to request `hand-tracking` and enter VR;
- test with `@react-three/xr` 6.6.30, but keep it absent from production dependencies.

`@react-three/xr`'s store documents its session, origin reference space, visibility, frame-rate state, and IWER-based `emulate` option ([XR store](https://pmndrs.github.io/xr/docs/tutorials/store)). This is useful for the Example App, but the package's own integration tests should drive IWER directly so compatibility is not conflated with a required framework.

## Browser-only runtime and SSR-safe importing

WebXR globals are exposed on `Window` in secure contexts, and immersive session requests require recent user activation ([WebXR IDL and user intent](https://www.w3.org/TR/webxr/#initialization)). Treat those as runtime constraints, not import-time assumptions.

Recommended export shape:

```json
{
  "sideEffects": false,
  "exports": {
    ".": { "types": "./dist/core/index.d.ts", "import": "./dist/core/index.js" },
    "./three": { "types": "./dist/three/index.d.ts", "import": "./dist/three/index.js" },
    "./react": { "types": "./dist/react/index.d.ts", "import": "./dist/react/index.js" }
  }
}
```

Rules for all entry points:

- no top-level reads of `window`, `document`, `navigator`, `XR*` constructors, canvas, or renderer state;
- no automatic IWER/polyfill installation; the Host Application chooses emulation in development;
- use `import type` where possible and keep React/R3F imports out of the root and Three entry points;
- create DOM/Three resources only from an explicit factory, mount, or client effect, and make disposal idempotent;
- expose capability functions that accept a `Navigator`/`XRSystem` or guard with `typeof navigator !== 'undefined'` when called;
- test `node -e "import('@xleepy/wrist-menu')"`, `./three`, and `./react` in CI with no DOM shim, plus an SSR render that does not mount effects.

Secure deployment is HTTPS; `localhost` is suitable for local development. Embedded hosts must also allow the `xr-spatial-tracking` Permissions Policy, which gates immersive support and session creation ([WebXR permissions policy](https://www.w3.org/TR/webxr/#permissions-policy)).

## Quest-focused browser and device coverage

Meta's release notes list Browser 146.2 as the current stable release at this research date and show that 146.0 moved the browser to Chromium milestone 146 ([Meta Browser release notes](https://developers.meta.com/horizon/release-notes/?search_key=browser)). Browser versions roll forward independently, so the support policy should be capability- and test-based:

| Environment | Inputs | Version-1 status | Required evidence |
| --- | --- | --- | --- |
| Quest 3, latest stable Meta Quest Browser | Touch Plus controllers and articulated hands | Primary release gate | Full functional, comfort, tracking-loss, handedness, and 72/90 Hz performance checklist |
| Quest 3S, latest stable Meta Quest Browser | Touch Plus controllers and articulated hands | Primary release gate | Same checklist; at least a smoke/performance run for every release candidate |
| Quest 2, latest browser available to the device | Touch controllers and articulated hands | Provisional compatibility, not yet a guarantee | Run the same suite if hardware is available and record Browser/Horizon OS versions; decide support only after evidence |
| Quest Pro, latest browser available to the device | Touch Pro controllers and articulated hands | Best effort | Smoke test if hardware is available |
| Desktop Chromium browser + IWER 2.3.0 | Emulated Quest hands/controllers | Required development/CI environment | Deterministic scenarios; no comfort or performance claim |
| Other standards-compliant WebXR headsets/browsers | Capability-dependent | Best effort | No version-1 release gate; accept external reports against captured browser/device versions |

Do not use experimental browser flags for the v1 contract. Meta's current releases include unrelated experimental WebGPU/depth-projection work, but this menu needs only WebGL/WebXR core, Hand Input, Gamepads, and haptics as an optional enhancement. At session start, log a privacy-conscious diagnostic snapshot: browser-reported feature availability, enabled session features, input `profiles`, handedness/target-ray mode, actual frame rate, and whether haptics/bulk hand methods exist. Avoid persistent hardware fingerprinting.

## Emulator and automated-test strategy

### What to use

IWER 2.3.0 is the preferred desktop runtime. Meta documents emulated headsets, hands, controllers, visibility, recenter/reset behavior, switching primary input modes, and beta action recording/playback ([IWER getting started](https://meta-quest.github.io/immersive-web-emulation-runtime/getting-started.html), [action recording/playback](https://meta-quest.github.io/immersive-web-emulation-runtime/action.html)). Pin it and construct known poses in test code rather than depending on a manually installed browser extension.

The W3C WebXR Test API is useful context for scenario design (fake device/input connection, visibility, tracking loss, selection), but it explicitly says the API is testing-only and should not be exposed to normal browsing experiences ([WebXR Test API](https://immersive-web.github.io/webxr-test-api/)). Do not make production or ordinary app tests depend on `navigator.xr.test`.

### Test pyramid

1. **Pure unit tests:** feed matrices/quaternions and timestamps into the core. Cover both hands, dot-product thresholds, dwell, hysteresis, frame-rate-independent smoothing, controller axis signs, force-open/closed precedence, touch debouncing, and every loss/resume transition.
2. **IWER browser tests:** connect/disconnect hands and controllers, switch primary input mode, provide null/lost poses, recenter, change visibility, replay recorded motions, and assert semantic events plus Three object transforms. Run vanilla Three and R3F harnesses against the same scenario fixtures.
3. **SSR/import tests:** import every public subpath in Node without DOM shims and render the React component server-side without mounting effects.
4. **Optional-framework test:** one R3F harness with `@react-three/xr` 6.6.30 verifies shared-session/origin behavior and absence of duplicate actions.
5. **Physical Quest checklist:** use both menu wrists, hands and controllers, input switching, transient occlusion, system UI interruption, recentering, seated/standing reach, reduced motion, accidental activation, and repeated open/close comfort.

Emulator tests prove state-machine and adapter behavior. They do not prove camera hand-tracking quality, controller grip offsets, optical reachability, haptic support, refresh stability, thermals, or comfort.

## Performance measurement

Meta publishes frame budgets of 13.9 ms at 72 FPS, 11.1 ms at 90 FPS, and 8.3 ms at 120 FPS, and treats 72 FPS as the minimum for Quest application guidance ([Meta optimization workflow](https://developers.meta.com/horizon/documentation/unreal/po-perf-opt-mobile/)). Although that page targets native engines, the physical frame budgets are applicable to a browser workload. Query `XRSession.frameRate`/`supportedFrameRates` where available rather than assuming a refresh rate; those members are optional in the WebXR contract ([WebXR frame-rate members](https://www.w3.org/TR/webxr/#dom-xrsession-supportedframerates)).

For every release candidate on Quest 3 and 3S:

1. Warm up the scene, then record at least 30 seconds hidden and 30 seconds repeatedly activating/interacting with the menu at the same target frame rate.
2. Capture callback/frame intervals, p50/p95/p99 update time, missed/long-frame percentage, activation latency, and garbage-collection spikes. The core should allocate no objects in its steady per-frame path.
3. Snapshot `renderer.info.render.calls`, triangles, lines/points, geometries, textures, and programs before/after; Three.js exposes these counters for monitoring ([WebGLRenderer.info](https://threejs.org/docs/pages/WebGLRenderer.html#info)).
4. Use Chrome remote debugging and the Performance panel for CPU/GPU/frame traces, with screencasting and screenshots disabled during measurement because remote screencasting itself can reduce frame rate ([Chrome Android remote debugging](https://developer.chrome.com/docs/devtools/remote-debugging), [Performance panel](https://developer.chrome.com/docs/devtools/performance/reference)).
5. If `EXT_disjoint_timer_query_webgl2` is available, use asynchronous, disjoint-checked timer queries for menu GPU cost; never block waiting for a result ([Khronos extension](https://registry.khronos.org/webgl/extensions/EXT_disjoint_timer_query_webgl2/)). Treat absence of the extension as normal.
6. Repeat after several minutes to reveal thermal/performance drift; report the exact device, Horizon OS, Browser, Three.js, and package versions with the result.

Project recommendation (not a vendor rule): target menu-update CPU p95 below 1 ms on Quest 3/3S, zero steady-state allocations, and no statistically meaningful increase in missed frames at 72 or 90 Hz. Set a draw-call/triangle budget only after the presentation prototype establishes its actual mesh/text strategy. A real-device baseline, not desktop IWER, decides acceptance.

## Evidence-backed implementation recommendations

1. Keep pose sampling, activation, interaction, presentation, and renderer adapters separate. Only adapters know WebXR/Three/R3F objects.
2. Use wrist local `-Y` as the canonical tracked-hand palm normal and viewer-to-wrist direction from the same reference space.
3. Use controller grip axes plus configurable offsets as a compatibility path; never advertise controller wrist placement as anatomically exact.
4. Make missing/blurred input fail closed: no pose means no interaction. Visual grace may reduce flicker but cannot preserve an in-progress action.
5. Use semantic WebXR selection events and standard target rays for controllers; use fingertip radius for direct hand touch.
6. Keep `@react-three/xr` optional. Its store may own session/emulation in a Host Application, while the package consumes R3F's renderer and frame.
7. Start with a narrow, proven Three r185 peer range and two R3F/React lanes. Widen support only when CI evidence exists.
8. Treat SSR-safe import as an acceptance test, not documentation alone.
9. Use IWER for deterministic desktop scenarios and physical Quest 3/3S for release, comfort, offsets, haptics, and performance.

## Explicit unknowns to resolve during implementation/prototyping

- **Quest 2/Quest Pro lifecycle:** Meta's current browser release feed does not provide a durable per-device WebXR support guarantee. Do not promise these devices until a physical test records a supported current browser/OS combination.
- **Controller wrist offsets:** WebXR standardizes grip axes, not the anatomical distance/rotation from each controller grip to a user's wrist. Tune defaults on Quest 3/3S, expose overrides, and later key optional presets by input profile.
- **Occlusion behavior:** The specification permits emulated joints or all-null hand poses. Real Quest timing/noise and the best visual grace/reacquisition dwell require headset tests.
- **Haptics shape/support:** Gamepad haptics remain draft and browser support is optional. The exact actuator/effect exposed by each current Quest controller must be captured on-device.
- **Bulk hand methods:** `fillPoses()` and `fillJointRadii()` are specified, but should remain an optimization behind capability tests until the physical matrix confirms them.
- **Broader Three.js range:** Compatibility below r185 has not been executed. Do not widen the published peer range based only on similar APIs or R3F's broader peer declaration.
- **SSR framework matrix:** Node import safety can be automated immediately; Next.js/Remix/Astro-specific bundling behavior still needs explicit fixture tests if claimed in documentation.
- **Final performance/render budgets:** The presentation prototype must establish text/layout geometry and a baseline before draw-call, triangle, texture-memory, and activation-latency limits become release criteria.

