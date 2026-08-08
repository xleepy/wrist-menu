# Primitive Workshop

Primitive Workshop demonstrates the Wrist Menu Package's happy path in two
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

This also rebuilds both variants. The static outputs are
`examples/primitive-workshop/dist/vanilla/` and `dist/react/`.

WebXR requires a secure context; `localhost` is suitable for local development.
Use a current immersive-WebXR browser and allow the requested hand-tracking and
local-floor features when available.

## Happy-path journey

1. Enter VR, turn the configured wrist inward, and use the opposite hand or
   controller to operate the Wrist Menu.
2. Point at the table to move the valid Placement Cursor.
3. Spawn once with **Snap placement** enabled, disable it, move the cursor, and
   spawn again to compare snapped and unsnapped positions.
4. Choose cube, sphere, or cylinder; select a Workshop Object in the scene and
   remove it through the menu.
5. Hide/show the grid, switch between left and right menu wrists, and drag the
   long menu panel to exercise continuous menu scrolling.

The desktop **Spawn at cursor** button is a non-XR convenience. Package-owned
menu hit regions still shield the React scene, and the vanilla variant checks
the package Scene Input Claim before applying a controller action to scene
content. The Workshop Model also ignores duplicate deliveries bearing the same
physical-action ID, so one physical action advances it at most once.
