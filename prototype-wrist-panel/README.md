# Wrist-panel presentation prototype

> THROWAWAY HITL ARTIFACT — this is not production package code.

Three structurally different wrist-panel presentations, switchable with
`?variant=A`, `?variant=B`, or `?variant=C`, on the throwaway
`/prototype/wrist-panel` route.

Run from the repository root:

```powershell
npm run prototype:wrist-panel
```

Then open <http://localhost:4173/prototype/wrist-panel?variant=A>.

Use the floating bottom switcher or the left/right arrow keys to cycle. Menu
state is intentionally in-memory only and remains visible in the headset HUD.

## Question

Which structure makes actions, toggles, choices, disabled items, and separators
most legible and reachable on a wrist while leaving clear theming seams for a
Host Application?

## Variants

- **A — Command slab:** scan-first grouped rows with a strong status header.
- **B — Orbit halo:** reach-first radial controls around a wrist hub.
- **C — Thumb deck:** priority-first central action with edge rails and rockers.

No variant has been selected. The artifact exists only to support live user
feedback on the open prototype ticket.
