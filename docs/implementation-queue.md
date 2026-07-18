# Implementation Queue

GitHub's native sub-issue and dependency relationships on [Chart the reusable WebXR Wrist Menu Package](https://github.com/xleepy/wrist-menu/issues/1) are the source of truth. This file is a human-readable orchestration snapshot and must be refreshed whenever a dependency closes.

## Active

- [Prototype device-specific wrist offsets and tracking degradation](https://github.com/xleepy/wrist-menu/issues/12) — active isolated prototype session covering tracked-hand offsets, Controller Wrist Proxy presets, pose confidence, and tracking-loss behavior.
- [Prototype the default Three.js presentation and continuous scrolling](https://github.com/xleepy/wrist-menu/issues/13) — active isolated prototype session covering the production-shaped Command slab, physical geometry, text, clipping, virtualization, and drag interaction.
- [Define publication, documentation, and repository workflow](https://github.com/xleepy/wrist-menu/issues/10) — active isolated decision session covering package publication, documentation, CI, release, and cross-repository coordination.

## Ready

- None.

## Blocked

- [Set compatibility, performance, and validation gates](https://github.com/xleepy/wrist-menu/issues/8) — waiting for **Prototype device-specific wrist offsets and tracking degradation** and **Prototype the default Three.js presentation and continuous scrolling**.
- [Choose the implementation sequence and close remaining gaps](https://github.com/xleepy/wrist-menu/issues/11) — waiting for **Set compatibility, performance, and validation gates** and **Define publication, documentation, and repository workflow**.

## Production boundary

Do not implement production package or Example App code while the final sequencing decision remains blocked. Unblocked research and throwaway prototypes may proceed because they resolve the decisions that guard implementation.
