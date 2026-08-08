# Wrist Menu 0.0.0 candidate documentation

This versioned documentation describes the review candidate, not a stable
release. The source compatibility policy has no verified Compatibility Claims,
and the exact predecessor automated Evidence Record is **failed**. Start with
[compatibility](compatibility.md) before representing any combination as
supported.

## Entry points

| Import | Purpose |
| --- | --- |
| `@xleepy/wrist-menu` | Renderer-neutral behavior, types, and constants. |
| `@xleepy/wrist-menu/core` | Explicit alias of the root entry point. |
| `@xleepy/wrist-menu/three` | Vanilla Three.js Renderer Integration. |
| `@xleepy/wrist-menu/react` | React Three Fiber component and Scene Event Shield. |

The package is ESM-only. Deep imports are unsupported. Importing any public
entry point is inert: it does not read browser globals, allocate Three.js
resources, install listeners, request an XR session, or start a render loop.
The extracted-candidate fixture executes all entry points and compiles their
declarations; see [testing](#testing).

## Host Snapshots

A Host Snapshot is a complete immutable input. It contains the Menu Definition,
activation mode, menu wrist, and optional comfort, controller-wrist, and theme
overrides. Call `syncWristMenuRuntime(state, snapshot)` or
`syncThreeWristMenu(state, snapshot)` with a complete replacement. Validation
and copying happen synchronously; the latest valid queued Host Snapshot applies
atomically at the next Frame Sample. Invalid input leaves live and queued state
unchanged.

Action, Toggle, and Choice items use globally stable IDs. Toggle and Choice
values remain Host Application-owned: a Selection Intent proposes a value, and
the Host Application supplies the accepted value in its next Host Snapshot.
Portable Menu Values are booleans, strings, and finite numbers.

## Behavior and integration

`createWristMenuRuntimeState` creates renderer-neutral state. A custom Renderer
Integration feeds portable Frame Samples and Target Observations to
`stepWristMenuRuntime`; the returned Presentation Model is read-only. Direct
hands commit at the press plane. Controllers arm on select start and commit only
when released over the same enabled item. Selection and scrolling must return
to a Neutral Selection State before rearming. Disabled items never emit a
Selection Intent, Scene Input Claim, or haptic request.

Vanilla Three.js hosts create `createThreeWristMenuState(options)`, attach the
stable `state.presentation.group`, call `updateThreeWristMenu(state, update)`
inside their existing XR loop, and consult
`threeWristMenuBlocksSceneInput(state, inputSource)` before applying the same
physical action to scene content. The Host Application owns the renderer, XR
session, reference space, render loop, and event policy.

React hosts mount `<WristMenu snapshot={snapshot} onEvent={onEvent} />` inside
their R3F tree. Its Scene Event Shield blocks synthetic scene events only for
active Hit Regions. The callback context maps a Selection Intent back to the
originating raw `XRInputSource`; semantic Wrist Menu Events themselves remain
portable.

## Lifecycle

The Three.js session-end, hidden/blurred visibility, and reference-space reset
handlers clear transient interaction and Scene Input Claims immediately. Other
sample-driven interruptions, including tracking loss, source replacement, and
attachment reparenting, are recognized by `updateThreeWristMenu` at the next
Frame Sample. Presentation replacement and disposal also clear interaction
synchronously. Re-entry requires a fresh dwell. The Host Application must create
one Wrist Menu Instance per live realization and dispose it before discarding
its renderer or React tree. Disposal is idempotent.

For Three.js, the session and reference-space listener functions created in
`ThreeWristMenuState` retain their identity for the state's full lifetime. The
integration removes those same functions when the session or reference space
changes. Do not replace or mutate the returned state fields.

## Customization

Use Host Snapshot theme tokens for the default presentation. An advanced host
may provide a synchronous `presentationFactory` to the Three or React entry
point. It receives only the frozen Presentation Model and must return one
disposable content root, explicit Hit Regions, a Menu Viewport, and an
`update(model)` method. Hit Regions and the viewport must be descendant Three.js
Meshes backed by `BoxGeometry`; visible geometry is never an implicit target.
Replacing a presentation clears transient interaction and requires fresh dwell.

## Accessibility

Host Snapshot labels and `disabledReason` values remain available as model data,
but the default Command slab does not render those labels. Its interaction
states use color and material changes only; this candidate has not proved text
contrast, non-color state cues, headset legibility, or screen-reader output for
that presentation. A custom presentation is responsible for rendering readable
labels and reasons and for validating contrast and redundant state cues in its
actual Host Application context.

There is no public reduced-motion override in this candidate. The core ordinary
show/hide transition remains 150 ms, so a Host Application that requires a
reduced-motion path must treat that as a current limitation rather than claim
support. The physical accessibility and comfort protocol remains outstanding.

## Testing

Run `npm run check` for build, declarations, deterministic behavior, consumers,
and the packed Example App. Run `npm run candidate:verify --
--evidence-bundle <record-directory>` to build a digest-addressed candidate,
verify its extracted package, install that extraction into the public-import,
declaration, and executable-document fixtures, and restore the fixture's frozen
checkout. The executable source is
[`fixtures/candidate-docs/executable-doc.mjs`](../../fixtures/candidate-docs/executable-doc.mjs).

Physical device, comfort, optics, thermal, and frame evidence cannot be inferred
from unit tests or IWER. Follow the full protocol in
[`validation-gates.md`](../validation-gates.md).

## Security

Treat Menu Definitions, custom factories, labels, icon keys, and raw XR input as
untrusted Host Application input. The package validates portable values and
dimensions but does not sanitize Host Application rendering or authorize
application actions. Interpret Selection Intents through an explicit allowlist;
do not put secrets in labels, diagnostics, Evidence Records, or haptic metadata.
Pin dependencies and verify the candidate bundle manifest and SHA-256 before
review or installation.

## Troubleshooting

- **Menu never reveals:** confirm a current wrist/grip pose, correct configured
  wrist, visible XR lifecycle, and the initial automatic dwell.
- **Menu is visible but untargetable:** wait one Frame Sample after reveal,
  movement, or presentation replacement and verify explicit Hit Regions.
- **Controller selection cancels:** release over the same item that owned select
  start; movement, tracking loss, and interruption cancel deliberately.
- **Scene receives a duplicate action:** consult the matching scene-blocking
  function before Host Application scene delivery and preserve raw
  `XRInputSource` identity.
- **React renders nothing during SSR:** expected; the component imports safely
  and mounts its R3F integration only in an active client tree.
- **Candidate verification reports failed evidence:** expected for the exact
  predecessor record; read [compatibility](compatibility.md) rather than
  relabelling it.

See [migration](migration.md) for the breaking state API, [release](release.md)
for candidate construction and local override, and
[compatibility](compatibility.md) for exact lanes and evidence.
