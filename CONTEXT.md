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
