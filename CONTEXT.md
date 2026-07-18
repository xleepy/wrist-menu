# Wrist Menu

This context defines a reusable spatial menu that VR applications can attach to a user's wrist and reveal through deliberate hand orientation. It includes the reusable package and a companion example application.

## Language

**Wrist Menu Package**:
The reusable product consumed by both vanilla Three.js and React Three Fiber VR applications.
_Avoid_: Module, one-off menu

**Wrist Menu Instance**:
The live, disposable realization of one Menu Definition within a Host Application's rendering lifecycle.
_Avoid_: Handle, controller, singleton

**Active Menu Ownership**:
The exclusive relationship between one XR session and its currently enabled Wrist Menu Instance.
_Avoid_: Global singleton, Selection Ownership

**Host Application**:
A VR application that consumes and configures the Wrist Menu Package.
_Avoid_: Client, parent app

**Example App**:
A separate repository that consumes the Wrist Menu Package and demonstrates a realistic use case.
_Avoid_: Use-case repo, library demo

**Selection Source**:
The tracked hand or motion controller through which a user targets a Wrist Menu item.
_Avoid_: Pointer, input device

**Eligible Selection Source**:
A Selection Source permitted to operate the current wrist's menu, normally belonging to the opposite hand.
_Avoid_: Active controller, primary pointer

**Selection Ownership**:
The temporary exclusive relationship between one Selection Source and one menu item while the user's intent is pending.
_Avoid_: Focus lock, pointer capture

**Selection Commit**:
A completed user intent that activates exactly one Wrist Menu item, independent of the Selection Source's physical gesture.
_Avoid_: Click, poke, trigger

**Selection Cancellation**:
The end of a pending selection without activating a Wrist Menu item.
_Avoid_: Failed click, aborted trigger

**Neutral Selection State**:
The safe state in which a Selection Source has no pending intent and may acquire new Selection Ownership.
_Avoid_: Idle pointer, cooldown

**Menu Definition**:
The ordered, Host Application-owned description of the items and current application state presented by a Wrist Menu.
_Avoid_: Menu config, internal menu state

**Host Snapshot**:
The complete immutable set of Host Application-owned inputs applied atomically to a Wrist Menu Instance, including its Menu Definition, activation mode, comfort overrides, and theme.
_Avoid_: Props, patch, partial config

**Menu Item**:
A stable, labeled entry in a Menu Definition: an Action Item, Toggle Item, choice option, or separator.
_Avoid_: Button, control

**Action Item**:
A Menu Item whose Selection Intent requests an operation without proposing a new displayed value.
_Avoid_: Command button, callback item

**Toggle Item**:
A Menu Item that presents a Host Application-owned boolean value and proposes its inverse through a Selection Intent.
_Avoid_: Switch component, internal toggle

**Choice Group**:
A stable group of directly visible option items with exactly one Host Application-owned selection.
_Avoid_: Dropdown, submenu, cycling option

**Interaction State**:
The short-lived reveal, hover, ownership, dwell, and tracking state owned by the Wrist Menu Package.
_Avoid_: Application state, menu data

**Frame Sample**:
The normalized description of poses, lifecycle visibility, and Selection Source state observed for one current WebXR frame.
_Avoid_: XRFrame, raw frame data

**Target Observation**:
The renderer-neutral report that an Eligible Selection Source approaches or intersects one Menu Item during a Frame Sample; it is evidence for interaction, not hover or selection.
_Avoid_: Hit event, click target

**Renderer Integration**:
The boundary that produces Frame Samples and Target Observations from a Host Application's rendering lifecycle and realizes Wrist Menu presentation state.
_Avoid_: Framework plugin, separate renderer

**Presentation Model**:
The read-only renderer-facing description of Menu Item content and visual cues derived from the current Host Snapshot and Interaction State.
_Avoid_: Host Snapshot, scene graph, core state

**Selection Intent**:
The source-independent request emitted after a Selection Commit for the Host Application to interpret.
_Avoid_: Click event, automatic state update

**Wrist Menu Event**:
A source-independent notification emitted by a Wrist Menu Instance for a Selection Intent, visibility change, Selection Cancellation, or runtime status.
_Avoid_: DOM event, renderer event, raw input event
