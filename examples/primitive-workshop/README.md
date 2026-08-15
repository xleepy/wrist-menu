# Primitive Workshop

Primitive Workshop demonstrates the Wrist Menu Package's complete Workshop
journey in two
independently bootstrapped Example Variants:

- `vanilla/` owns a Three.js renderer, XR session, ray interaction, scene, and
  `@xleepy/wrist-menu/three` Wrist Menu Instance.
- `react/` owns a React Three Fiber canvas, `@react-three/xr` store, declarative
  scene interaction, and `@xleepy/wrist-menu/react` component.

The variants share only `shared/workshop-model.js`: deterministic portable
Workshop Model state, transitions, physical-action deduplication, and complete
Host Snapshot derivation. It has no Three.js, React, WebXR, or browser coupling.

## Run against the local package

From the repository root:

```sh
npm run examples:link
npm run examples:dev:vanilla
# or, in another run:
npm run examples:dev:react
```

`examples:link` builds the package, creates the verified npm tarball, installs
that tarball into this Example App without saving a source path, and builds both
static sites. Despite the familiar command name, it does not use an npm symlink.
Imports therefore resolve through the packed package's public `exports` map.

To discard the local install and restore the frozen Example App dependency tree:

```sh
npm run examples:unlink
```

This also rebuilds both variants. The static output has a chooser at
`examples/primitive-workshop/dist/index.html` and directly openable variants at
`dist/vanilla/` and `dist/react/`. All assets use relative paths, so the tree
can be deployed below a project prefix without a router.

WebXR requires a secure context; `localhost` is suitable for local development.
Use a current immersive-WebXR browser and allow the requested hand-tracking and
local-floor features when available.

## Workshop journey

1. Enter VR, turn the configured wrist inward, and use the opposite hand or
   controller to operate the Wrist Menu.
2. Point at the table to move the valid Placement Cursor.
3. Spawn once with **Snap placement** enabled, disable it, move the cursor, and
   spawn again to compare snapped and unsnapped positions.
4. Choose cube, sphere, or cylinder; select a Workshop Object in the scene and
   remove it through the menu.
5. Hide/show the grid, switch between left and right menu wrists, and drag the
   long menu panel to exercise continuous menu scrolling.
6. Switch between tracked hands and controllers. The Workshop Model and
   selection remain intact while the transient Placement Cursor and Wrist Menu
   interaction clear before a fresh reveal.
7. Exercise tracking loss, hidden or blurred XR, session rejection, session
   end, and re-entry. Each interruption suppresses interaction and reports a
   concrete recovery action; re-entry creates a fresh Wrist Menu Instance from
   the preserved Workshop Model.

The shared `fixture` query parameter selects deterministic acceptance states:

- `fixture=default` starts empty with no valid Placement Cursor.
- `fixture=full-workshop` starts at the 12-object capacity and disables Spawn.
- `fixture=empty-definition` supplies a valid empty Menu Definition with no
  panel interaction or Scene Input Claim.
- `fixture=shield` aligns a selectable Workshop Object behind the Wrist Menu so
  the Scene Event Shield/Scene Input Claim can be verified.

Append `debug=1` to either direct path to show the active variant, packed
package version, object count, Workshop Model revision, runtime status, and the
next recovery action. Session and definition errors remain visible without the
debug flag.

The desktop **Spawn at cursor** button is a non-XR convenience. Package-owned
menu hit regions still shield the React scene, and the vanilla variant checks
the package Scene Input Claim before applying a controller action to scene
content. Both variants key XR physical-action identities by the originating
`XRInputSource` and carry them through scene and menu delivery. Instantaneous
hand and menu-only identities expire after a bounded correlation lifetime, even
when no XR `selectend` arrives. The Workshop Model retains the 64 most recently
transitioned identities, so delayed duplicate delivery cannot advance it again
while memory remains explicitly bounded.

Invalid/out-of-bounds and occupied cursor positions are visibly distinct and
disable Spawn with specific guidance. Remove, Reset, unavailable wrist choices,
and full-capacity Spawn likewise expose stable disabled reasons. Reset clears
objects, selection, and cursor and restores primitive/grid defaults while
preserving the chosen menu wrist.
