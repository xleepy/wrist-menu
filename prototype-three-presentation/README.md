# Three.js Command slab and continuous-scroll prototype

> THROWAWAY HITL ARTIFACT — this is not production Wrist Menu Package code.

This branch answers the concrete presentation questions in
[Prototype the default Three.js presentation and continuous scrolling](https://github.com/xleepy/wrist-menu/issues/13).
It reuses the content hierarchy and visual direction selected by
[Prototype the default wrist-panel presentation](https://github.com/xleepy/wrist-menu/issues/4),
but none of that earlier DOM/CSS implementation is promoted here. The scene,
text/icon technique, clipping, row pool, Hit Regions, and drag model are new
Three.js prototype code.

## Run

From the repository root:

```powershell
npm install
npm run prototype:three
```

Open <http://127.0.0.1:4173/prototype/three-presentation?variant=A>.

For a physical headset, load the same route from a trusted HTTPS origin that
the headset can reach (for example, a temporary HTTPS deployment or trusted
tunnel to the local Vite server). A plain `http://<LAN-IP>` URL is not a secure
WebXR context. Do not add `?iwer=1` on the physical Quest; that flag deliberately
replaces native WebXR with the pinned desktop emulator.

- `A — Balanced` is the provisional default: 180 × 142 mm panel, 164 × 96 mm
  Menu Viewport, 18 mm rows, 8/12 mm hand/controller drag thresholds.
- `B — Reach` makes the contrast case physically larger: 192 × 158 mm panel,
  176 × 108 mm viewport, 20 mm rows, 9/13 mm thresholds.
- `C — Compact` makes the contrast case smaller: 168 × 128 mm panel, 152 ×
  84 mm viewport, 16 mm rows, 7/10 mm thresholds.

The variants intentionally retain the already-selected Command slab structure.
They vary the unresolved physical geometry rather than reopening the layout
decision. Use the bottom switcher, `←`/`→`, or the shareable `?variant=` value.

Desktop controls:

- drag vertically on an item or the viewport to acquire Scroll Ownership;
- switch between controller-ray and direct-hand proxy thresholds;
- use the wheel for continuous inspection without inertia;
- toggle `Hit Regions` to see the explicit oriented-box targets;
- use `?iwer=1` before loading to install IWER 2.3.0, then press `Enter XR`.

On XR entry the throwaway Host Application stages the slab once, 0.50 m in
front of and 0.15 m below the viewer, so seated and standing review can reach
the same presentation. It is deliberately not a production wrist anchor;
device-specific attachment is owned by the separate wrist-offset prototype.

## What the prototype makes concrete

- A single 1024 × 2048 RGBA `CanvasTexture` atlas. Inter Latin 400/600 WOFF2
  files are bundled into the JavaScript as data URLs; icon paths are drawn by
  the prototype. There are no implicit CDN, application-relative font, or icon
  requests.
- One atlas-text batch and one row-background batch for the viewport. Rows and
  separators are clipped by two world-space Three.js clipping planes.
- A fixed 12-slot visual pool sized from the compact profile's minimum entry
  height. Typical frames bind five visible entries and one overscan entry on
  either side; off-screen slots and separators expose no Hit Region.
- Explicit row-oriented boxes (not visible meshes) produce targeting. Disabled
  items remain targetable for unavailable feedback but cannot commit.
- A pending Selection Ownership becomes continuous Scroll Ownership only after
  source-specific panel-space movement crosses the profile threshold. Crossing
  cancels pending selection, disables row targets through the drag, and rearms
  them on the frame after release. There is no inertia or elastic overscroll.
- Scroll position is represented by the stable top item id plus its intra-item
  offset, so compatible Menu Definition updates can restore the anchor.

## Deterministic verification

```powershell
npm run test:prototype
npm run trace:prototype
npm run build:prototype
```

Committed evidence lives in `evidence/`. The browser also exposes
`window.__WRIST_MENU_PROTOTYPE__.snapshot()` and
`window.__WRIST_MENU_PROTOTYPE__.runDeterministicTrace()` for automation.

The install step generates an ignored JavaScript data module from the two
OFL-licensed `@fontsource/inter` WOFF2 files. This keeps font bytes inside the
prototype bundle while retaining the upstream package and license as the
source. Re-run `npm install` (or the `postinstall` script directly) if the
generated module is missing.

## Smallest physical HITL review — Quest 2 now

Use the latest Meta Quest Browser available on the user's Quest 2. Do not treat
one device run as broad support evidence.

1. Record Quest model, Horizon OS version, Meta Quest Browser version, selected
   refresh rate, and whether the run uses native WebXR or IWER (physical review
   should say native).
2. At normal wrist viewing distance, compare A/B/C. For each, read every primary
   and secondary label, then target the first, middle, disabled, and partially
   clipped rows using a Touch controller.
3. In `A`, make a short under-threshold controller movement and confirm it
   commits; make a vertical movement over 12 mm and confirm it scrolls without
   committing. Repeat with direct hand at the 8 mm threshold.
4. Scroll to both ends and confirm hard clamping, no inertia/elastic motion, no
   off-screen target, and target rearming only after release.
5. Copy the live renderer readout after 30 seconds idle and after 30 seconds of
   repeated reveal/scrolling. Note visible draw calls, triangles, geometries,
   textures, programs, update p95, atlas uploads, and any visible frame drops.
6. Report the preferred profile plus any unreadable label, uncomfortable reach,
   false commit, missed drag, clipping artifact, or tracking limitation.

Use `evidence/quest-2-review-template.md` to post the result without having to
reconstruct the fields.

Quest 3 and Quest 3S remain later release-device lanes. Quest 2 feedback settles
this prototype's immediate geometry/interaction direction only; it cannot prove
the package's future support matrix or release performance gates.
