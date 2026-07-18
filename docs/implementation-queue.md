# Implementation Queue

GitHub's native sub-issue and dependency relationships on [Chart the reusable WebXR Wrist Menu Package](https://github.com/xleepy/wrist-menu/issues/1) are the source of truth. This file is a human-readable orchestration snapshot and must be refreshed whenever a dependency closes.

## Active

- [Prototype wrist anchoring and intentional reveal](https://github.com/xleepy/wrist-menu/issues/3) — HITL logic prototype, promoted after the runtime research closed; it remains open until user feedback resolves the behavior.
- [Prototype the default wrist-panel presentation](https://github.com/xleepy/wrist-menu/issues/4) — HITL UI prototype with a committed initial artifact; it remains open until user feedback resolves the design.

## Ready

None.

## Blocked

- [Define cross-input selection semantics](https://github.com/xleepy/wrist-menu/issues/5) — waiting for **Prototype wrist anchoring and intentional reveal** and **Prototype the default wrist-panel presentation**.
- [Define the public menu and host-control contract](https://github.com/xleepy/wrist-menu/issues/6) — waiting for **Prototype wrist anchoring and intentional reveal**, **Prototype the default wrist-panel presentation**, and **Define cross-input selection semantics**.
- [Design package boundaries and renderer integrations](https://github.com/xleepy/wrist-menu/issues/7) — waiting for **Define the public menu and host-control contract**.
- [Set compatibility, performance, and validation gates](https://github.com/xleepy/wrist-menu/issues/8) — waiting for **Design package boundaries and renderer integrations**.
- [Specify the external-consumer Example App](https://github.com/xleepy/wrist-menu/issues/9) — waiting for **Define the public menu and host-control contract** and **Design package boundaries and renderer integrations**.
- [Define publication, documentation, and repository workflow](https://github.com/xleepy/wrist-menu/issues/10) — waiting for **Design package boundaries and renderer integrations** and **Specify the external-consumer Example App**.
- [Choose the implementation sequence and close remaining gaps](https://github.com/xleepy/wrist-menu/issues/11) — waiting for **Set compatibility, performance, and validation gates**, **Specify the external-consumer Example App**, and **Define publication, documentation, and repository workflow**.

## Production boundary

Do not implement production package or Example App code while the final sequencing decision remains blocked. Unblocked research and throwaway prototypes may proceed because they resolve the decisions that guard implementation.
