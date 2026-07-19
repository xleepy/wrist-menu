# Recorded prototype evidence

This directory is generated evidence for the throwaway issue-13 branch, not a
release benchmark or production asset set.

## Automated desktop baseline

Captured with installed Microsoft Edge 150 in headless mode at 1440 × 900,
device scale 1, using software WebGL/SwiftShader. The prototype uses Three.js
0.185.1. All three profiles produced the same initial resource shape:

| Observation | A / B / C initial frame |
| --- | ---: |
| Whole prototype scene draw calls | 8 |
| Triangles | 540 |
| Lines | 223 |
| Geometries | 10 |
| Textures | 1 |
| Programs | 7 |
| Atlas GPU byte estimate | 8 MiB |
| Presentation update p95 | about 0.1 ms in the final capture |
| Active visual slots / pool capacity | 6 / 12 |
| Fully visible explicit Hit Regions | 4 |
| Stationary atlas uploads | 1 |

The debug-Hit-Region frame rises to 11 draw calls, 544 triangles, and 331 lines;
debug rendering is evaluator-only and disabled by default. These counters cover
the slab plus the throwaway host grid, wrist reference, and controller-ray
fixtures. They are useful for resource-shape comparison, not as isolated
package cost.

`browser-evidence.json` records the exact snapshots, a real desktop pointer tap,
a 20 mm controller-proxy drag, deterministic boundary traces for 8.9/9 mm hand
and 12.9/13 mm controller motion, resource URLs, console output, and a successful
IWER Quest-2 capability probe. The browser run observed no page errors, no
external origins, and no runtime WOFF/font requests. The production build emits
no standalone font or icon asset.

The final Vite build reports a 649.4 kB (201.4 kB gzip) main prototype chunk and
a lazy 179.5 kB (48.6 kB gzip) IWER library chunk. That includes the throwaway
Host Application, Three.js, embedded fonts, fixtures, telemetry, and evaluator
UI; it is not a proposed Wrist Menu Package bundle budget.

## Quest 2 decision and follow-up

- **Text and icons:** bundled Inter Latin 400/600 data URLs rendered into one
  1024 × 2048 RGBA CanvasTexture atlas; procedural Canvas2D icon paths. UV
  regions now match each physical quad aspect ratio. Reach primary type targets
  6.5 mm, while secondary, trailing, separator, header-meta, and footer type
  target 4.75 mm without adding textures or draw calls.
- **Physical geometry:** profile B — 192 × 158 mm panel, 176 × 108 mm Menu
  Viewport, 20 mm row, 2.5 mm row gap, 9 mm separator. It is the selected Quest
  2 legibility default; A and C remain comparison profiles.
- **Drag thresholds:** 9 mm direct hand and 13 mm controller ray, measured in
  panel space. Crossing is inclusive, cancels pending selection, acquires Scroll
  Ownership, and rearms targets on the frame after release.
- **Clipping and pooling:** two world-space clipping planes; one 12-slot pool
  sized for the compact profile's short separator case; one entry of overscan on
  each side. The sampled Reach trace used 6–8 slots. Partially clipped and
  off-screen rows render through the clip but expose no undersized Hit Region.
- **Motion:** continuous hard-clamped scrolling with no inertia, elastic
  overscroll, pages, or thumbstick requirement.

The first physical Quest 2 review preferred Reach and exposed vertically
compressed separator/footer text. That atlas geometry is corrected here. A
short second Quest 2 pass still needs to confirm the resulting physical
legibility and direct-hand behavior. Quest 3/3S remain later release-validation
lanes.

## Screenshots

- `screenshots/variant-a-balanced.png`
- `screenshots/variant-b-reach-closeup.png`
- `screenshots/variant-b-reach.png`
- `screenshots/variant-c-compact.png`
- `screenshots/variant-b-hit-regions.png`
