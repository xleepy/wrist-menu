# Implementation Queue

GitHub's native sub-issue and dependency relationships on [Chart the reusable WebXR Wrist Menu Package](https://github.com/xleepy/wrist-menu/issues/1) are the source of truth. This file is a human-readable orchestration snapshot and must be refreshed whenever a dependency closes.

## Active

- [Define cross-input selection semantics](https://github.com/xleepy/wrist-menu/issues/5) — active HITL design session covering shared hover, commit, cancellation, ownership, and feedback semantics.

## Ready

None.

## Blocked

- [Define the public menu and host-control contract](https://github.com/xleepy/wrist-menu/issues/6) — waiting for **Define cross-input selection semantics**.
- [Design package boundaries and renderer integrations](https://github.com/xleepy/wrist-menu/issues/7) — waiting for **Define the public menu and host-control contract**.
- [Set compatibility, performance, and validation gates](https://github.com/xleepy/wrist-menu/issues/8) — waiting for **Design package boundaries and renderer integrations**.
- [Specify the external-consumer Example App](https://github.com/xleepy/wrist-menu/issues/9) — waiting for **Define the public menu and host-control contract** and **Design package boundaries and renderer integrations**.
- [Define publication, documentation, and repository workflow](https://github.com/xleepy/wrist-menu/issues/10) — waiting for **Design package boundaries and renderer integrations** and **Specify the external-consumer Example App**.
- [Choose the implementation sequence and close remaining gaps](https://github.com/xleepy/wrist-menu/issues/11) — waiting for **Set compatibility, performance, and validation gates**, **Specify the external-consumer Example App**, and **Define publication, documentation, and repository workflow**.

## Production boundary

Do not implement production package or Example App code while the final sequencing decision remains blocked. Unblocked research and throwaway prototypes may proceed because they resolve the decisions that guard implementation.
