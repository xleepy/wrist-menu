# Version 1 compatibility, performance, and validation gates

This document resolves
[issue #8](https://github.com/xleepy/wrist-menu/issues/8). It defines what a
candidate must prove; it is not evidence that the current repository passes the
gates. Production implementation and evidence collection happen after the
Wayfinder map closes.

## Release policy

A stable release fails closed. Every advertised Compatibility Claim must have
current passing Evidence Records for all applicable gates. A missing, failed,
invalidated, or provisional record blocks stable publication. The `next`
prerelease tag may contain incomplete combinations when the documentation and
`compatibility.json` call them provisional rather than supported.

Use these claim statuses:

| Status | Meaning |
| --- | --- |
| `verified` | Every applicable gate has a current passing Evidence Record. |
| `provisional` | The combination is available for evaluation but lacks at least one required gate. |
| `unverified` | The project has not run the required evidence. |
| `unsupported` | The combination is outside the version-1 contract or has an unresolved failure. |

Declared peer ranges are installability contracts, not proof that every version
inside the range is a Tested Lane. No browser or device claim may be inferred
from user-agent text, a neighboring model, or standards compliance alone.

## Version 1 compatibility matrix

### Dependency and browser Tested Lanes

| Lane | Exact release evidence | Claim |
| --- | --- | --- |
| Core and package imports | Candidate tarball imported in Node without DOM shims | Required |
| Vanilla Three.js | Three.js `0.185.1` | Required |
| React 18 | Three.js `0.185.1`, R3F `8.18.0`, exact React/React DOM 18 patch locked by the implementation fixture | Required |
| React 19 | Three.js `0.185.1`, R3F `9.6.1`, React/React DOM `19.2.7` | Required |
| React XR compatibility | Both React lanes with `@react-three/xr 6.6.30` | Required |
| Browser emulation | Vanilla and React fixtures with IWER `2.3.0`, hands and controllers | Required development evidence only |

The public peers remain `three >=0.185.1 <0.186.0`,
`@react-three/fiber >=8.18.0 <10`, and `react >=18 <19.3`. The React 18 patch is
selected and locked when its consumer fixture is implemented; it is not guessed
in this planning issue. Widening any peer range requires the complete affected
suite on every newly claimed Tested Lane.

Every public entry point must import without reading `window`, `document`, or
`navigator`; creating a renderer or Three.js resource; installing IWER or a
listener; requesting or ending an XR session; or starting a render loop. React
server rendering must succeed without mounting effects.

### Physical device claims

| Device | Required inputs and variants | Version 1 status |
| --- | --- | --- |
| Quest 3 | Hands and paired Touch Plus controllers in both Example Variants | Primary stable-release gate |
| Quest 3S | Hands and paired Touch Plus controllers in both Example Variants | Independent primary stable-release gate |
| Quest 2 | Hands and paired Touch controllers in both Example Variants | Provisional until every gate passes |
| Quest Pro | Best-effort smoke evidence when hardware is available | Unverified; not a release gate |
| Other WebXR devices | External reports recorded against exact combinations | Unverified; no version-1 claim |

Each physical record names the exact device, Horizon OS/build, Meta Quest
Browser build, Example Variant, Selection Source type and profile, menu wrist,
observed refresh rate, session features, package tarball digest, Example App
commit and lockfile digest, protocol version, evaluator, UTC time, and raw
evidence location. At publication, a claimed device must have passed on the
latest stable browser available to that device, with the exact build recorded.

## Deterministic core gates

Every rule below has a named trace. Percentage coverage is not a substitute.
Threshold behavior is exercised immediately below, exactly at, and immediately
above the boundary. Time-based traces produce the same Wrist Menu Events at 60,
72, 90, and 120 Hz and under a deterministic irregular-frame sequence.

- Automatic reveal enters at or below 35 degrees and exits only above 50
  degrees.
- Adversarial angle traces that jitter around either threshold emit at most one
  visibility change per deliberate crossing; hysteresis prevents reveal/hide
  flicker.
- Initial dwell is 300 ms; reacquisition dwell is 200 ms; visual-only tracking
  grace is 250 ms; the ordinary show/hide transition is 150 ms.
- Missing required poses, `visible-blurred`, `hidden`, reference-space reset,
  Selection Source replacement, session end, reparenting, or disposal cancels
  interaction and the Scene Input Claim in the next processed Frame Sample.
  Visual grace is never targetable.
- A direct hand commits once when its fingertip crosses the press plane.
- A controller arms on select start and commits only on release over the same
  Menu Item. Moving between items, leaving before release, or interruption
  cancels.
- Commit and cancellation require a Neutral Selection State before rearming.
  Disabled Menu Items never emit a Selection Intent or haptic request.
- Hand movement acquires Scroll Ownership at an inclusive 9 mm; controller
  movement does so at an inclusive 13 mm. Crossing cancels pending Selection
  Ownership.
- Scrolling is continuous and hard-clamped, with no inertia or elastic
  overscroll. Hit Regions rearm exactly one Frame Sample after release.
- Compatible Menu Definition updates restore the top stable Menu Item and its
  intra-item offset. Wrist/session changes, an empty definition, presentation
  replacement, and disposal reset scrolling.
- Newly revealed or rebound slots remain untargetable for one Frame Sample.
  Partially clipped and off-screen content produces no Target Observation.
- One physical action emits at most one Selection Intent and one terminal
  commit-or-cancellation sequence.

## Renderer and consumer gates

The candidate tarball, not source aliases, drives all fixtures. The Example App
runs the same semantic journey in four IWER combinations: React plus hands,
React plus controllers, vanilla plus hands, and vanilla plus controllers. Each
combination covers both wrists, reveal/hide and fresh dwell, selection,
continuous scrolling, invalid and disabled actions, tracking loss, input
switching, WebXR visibility, session end/re-entry, an empty Menu Definition, an
unavailable wrist, and the behind-menu shield fixture.

The Three.js integration additionally proves:

- poses are transformed through a non-identity Host Application XR origin and
  sampled only from the current frame;
- reference-space reset and reparenting clear stale transforms and interaction;
- only explicit oriented Hit Regions target; clipping and the one-frame barrier
  prevent stale targets;
- no package path changes session, reference-space, framebuffer, foveation,
  render-loop, or Host Application event-manager policy;
- disposal is idempotent and releases only package-owned resources, listeners,
  subscriptions, and Active Menu Ownership.

The React and `@react-three/xr` fixtures additionally prove:

- Frame Samples cause no React state update or React commit;
- the Scene Event Shield never emits a Selection Intent;
- one valid menu action emits exactly one Selection Intent and zero
  behind-menu `pointerdown`, `pointerup`, `click`, `dblclick`, or context-menu
  actions;
- cancellation, holds, leave-before-release, rapid presses, direct-hand input,
  and controller input do not leak scene actions;
- rays beside the menu still reach the scene, while hidden, off-screen,
  decorative, disabled, or settling geometry neither raycasts nor shields;
- default and custom presentations expose only their declared Hit Regions;
- the integration does not rely on pointer capture,
  `nativeEvent.stopImmediatePropagation()`, listener order, or a
  framework-specific priority.

A custom Canvas event manager is unverified unless its exact fixture is added to
`compatibility.json` and passes the same shield gates.

## Allocation and resource gates

The default presentation has these exact invariant gates:

- after construction and application of a Host Snapshot, the core steady-frame
  path allocates zero objects across 10,000 Frame Samples;
- an identical Frame Sample after stabilization causes zero package-owned Three
  property writes;
- one package-owned RGBA atlas is at most 1024 by 2048 pixels and 8 MiB;
- the visual pool contains exactly 12 slots with one entry of overscan on each
  side;
- steady targeting and scrolling create no atlas upload, geometry, material,
  texture, program, listener, subscription, or pool-slot allocation;
- continuous scrolling mutates at most the existing 12 slot bindings and
  transforms per Frame Sample;
- 20 mount, session, replacement, and disposal cycles return every
  package-owned resource and listener count to the pre-test baseline.

Before stable publication, each Example Variant commits hidden, visible-idle,
and active-scroll Performance Baselines for draw calls, triangles, lines,
geometries, textures, programs, atlas uploads, and package update time. A fixed
fixture may not exceed its checked-in baseline without an explicit reviewed
baseline update and renewed physical evidence. The throwaway prototype's
whole-scene numbers are comparison evidence, not production limits.

## Physical performance gate

Run this separately for every claimed device, Example Variant, Selection Source
type, wrist, and supported 72/90 Hz refresh mode:

1. Use a production build and exact candidate tarball. Disable experimental
   flags, remote screencasting, screenshots, and other measurement overhead.
2. Warm the scene for at least 60 seconds.
3. Record three 30-second hidden baseline runs, three independent 30-second
   hidden repeat runs, and three 30-second repeated reveal/target/scroll runs at
   the same observed refresh rate.
4. Record package update p50/p95/p99, frame intervals, long-frame incidence,
   garbage-collection events, and renderer resource counters. A long frame is
   greater than 1.5 times the observed nominal frame period.
5. Establish the run's repeatability envelope from the hidden baseline/repeat
   A/A samples. Bootstrap one-second frame blocks for 10,000 resamples with the
   recorded fixture seed. The upper 95% confidence bound of active-minus-hidden
   long-frame incidence must not exceed the upper 95% bound of the A/A
   difference.
6. The package update p95 must remain below 1.0 ms and the allocation/resource
   gates must remain satisfied. Treat p99 as recorded calibration evidence
   until physical data supports a separate limit.
7. Repeat hidden and active measurements after a ten-minute mixed-interaction
   soak. The p95 and relative frame-impact gates must still pass.

The 1.0 ms p95 target is the repository's provisional project budget, not a
vendor guarantee. It may be tightened after the first complete physical matrix;
relaxing it requires a reviewed gate change and evidence showing the package
still leaves adequate Host Application frame headroom.

## Accessibility and reduced-motion gates

- Primary, secondary, separator, footer, selected, and disabled text assets have
  at least 4.5:1 contrast against their immediate background. Meaningful
  non-text state boundaries have at least 3:1. These are asset-level proxies
  based on [WCAG 2.2 contrast guidance](https://www.w3.org/TR/WCAG22/#contrast-minimum);
  physical headset legibility remains a separate gate.
- Hover, selected, disabled, Selection Ownership, and Scroll Ownership states
  each expose a non-color cue. Disabled state never relies on reduced opacity
  alone and provides an unavailable reason when the Menu Definition has one.
- Reduced-motion mode snaps the 150 ms show/hide transition to its final state
  and adds no pulse, oscillation, inertia, or elastic motion. Reveal dwell,
  targetability, Selection Ownership, Scroll Ownership, event ordering, and
  cancellation semantics remain unchanged. This follows the principle that
  non-essential interaction animation can be disabled in
  [WCAG 2.2 Animation from Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions).
- Both menu wrists, controller and direct-hand input, seated and standing use,
  and Host Application eligibility overrides complete the same semantic
  journey.

## Physical functional, legibility, and comfort protocol

Run the protocol independently on Quest 3 and Quest 3S before stable release,
and on Quest 2 before promoting it from provisional:

1. Complete ten deliberate reveal/hide cycles on each wrist. Pass with zero
   missed deliberate reveals, zero repeated/flickering visibility transitions,
   and zero accidental reveals or commits during a separate two-minute neutral
   Primitive Workshop task.
2. Correctly read every primary, secondary, separator, footer, disabled, and
   longest-supported fixture label from a self-selected comfortable wrist
   posture without moving the panel closer solely to decode text.
3. Target the first, middle, last fully visible, disabled, and partially clipped
   rows three times each. Pass with zero wrong-item or duplicate commits and no
   targetability from the partially clipped row.
4. Complete three top-to-bottom-to-top scroll round trips with each Selection
   Source type. Pass with correct hard clamps, no false Selection Commit,
   preserved anchor, and next-frame rearming.
5. Exercise controller press/hold/release, move-between-items, and
   leave-before-release. Exercise direct-hand fingertip crossing while the
   runtime's pinch/select recognition is also active. Every intended action
   produces exactly one Selection Intent. Equivalent hand and controller
   journeys produce the same semantic Wrist Menu Event sequence except for
   Selection Source metadata and the controller's arm/release phases.
6. Interrupt dwell, pending Selection Ownership, and Scroll Ownership with hand
   occlusion/tracking loss, `visible-blurred`, `hidden`, recenter/reset, source
   replacement, session end/re-entry, and both directions of input switching.
   Pass with zero stale commits or haptics, cancellation in the next processed
   Frame Sample, no targetability during grace, and fresh reacquisition dwell.
7. Complete the primary Primitive Workshop journey in both Example Variants,
   including the empty-definition, unavailable-wrist, disabled-item, both-wrist,
   and behind-menu shield fixtures.
8. Complete a ten-minute mixed seated/standing journey containing repeated
   reveal, targeting, selection, and scrolling. Record before/after discomfort
   from 0 to 10 and free-form wrist, shoulder, eye-strain, dizziness, nausea,
   numbness, and reach notes. Pass only when the evaluator does not stop for or
   report unacceptable discomfort. Numeric scores remain calibration evidence
   until multiple physical runs justify a threshold.

Initial support requires two evaluators per device, including at least one
person who did not implement the feature. This evaluator count is a conservative
process floor, not a claim of ergonomic research significance. Later release
candidates repeat the exact physical smoke and performance blocks; the full
comfort block repeats whenever its applicable evidence is invalidated.

## Evidence freshness and invalidation

Automated, import, consumer, IWER, allocation, and resource Evidence Records are
regenerated from the exact release commit, candidate tarball, and lockfile on
every release candidate.

Physical smoke and performance records must match the candidate runtime digest,
current device OS/browser combination, Example App lockfile, protocol, and
instrumentation used for the Compatibility Claim. A prerelease record may carry
into stable only when the stable runtime payload is materially identical and
the identifying digests still match.

Comfort and legibility records may carry forward only while presentation
geometry, atlas/text, Hit Regions, reveal/selection/scroll timing, reduced-motion
behavior, and device offsets are unchanged. Event-driven invalidation is
authoritative:

| Change | Invalidated evidence |
| --- | --- |
| Dependency version | Affected Tested Lanes and consumer/shield results |
| Device OS or browser build | That Validation Combination's physical functional and performance records |
| Core state machine or event ordering | Deterministic, adapter, and physical functional records |
| Presentation, type, clipping, Hit Regions, or atlas | Legibility, targeting, resource, and physical performance records |
| Controller Wrist Proxy offset | Controller reveal, parity, targeting, and comfort records |
| Fixture, protocol, or instrumentation | Its baseline and all comparisons using the prior version |

`compatibility.json` records declared peers, exact Tested Lanes, claim status,
candidate digest, source commit, Example App and lockfile digests, Validation
Combination, protocol and instrumentation versions, evaluator and UTC time,
raw/report locations, result, and invalidation reason. Stable publication checks
that every claimed row links to current passing records.
