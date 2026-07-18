# Wrist Menu

This context defines a reusable spatial menu that VR applications can attach to a user's wrist and reveal through deliberate hand orientation. It includes the reusable package and a companion example application.

## Language

**Wrist Menu Package**:
The reusable product consumed by both vanilla Three.js and React Three Fiber VR applications.
_Avoid_: Module, one-off menu

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

**Interaction State**:
The short-lived reveal, hover, ownership, dwell, and tracking state owned by the Wrist Menu Package.
_Avoid_: Application state, menu data

**Selection Intent**:
The source-independent request emitted after a Selection Commit for the Host Application to interpret.
_Avoid_: Click event, automatic state update
