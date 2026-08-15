# Migrating to the 0.0.0 state API

The state-pure API refactor is **breaking**. There are no legacy aliases,
deprecated wrappers, or compatibility methods. Update every call site before
installing this candidate.

## Renderer-neutral runtime

| Removed API | Replacement |
| --- | --- |
| `createWristMenuRuntime(options)` | `createWristMenuRuntimeState(options)` |
| `WristMenuRuntime.sync(snapshot)` | `syncWristMenuRuntime(state, snapshot)` |
| `WristMenuRuntime.step(frame, observations)` | `stepWristMenuRuntime(state, frame, observations)` |
| `WristMenuRuntime.blocksSceneInput(sourceId)` | `wristMenuRuntimeBlocksSceneInput(state, sourceId)` |
| `WristMenuRuntime.dispose()` | `disposeWristMenuRuntime(state)` |

The exported scene-event question is named
`wristMenuRuntimeBlocksSceneInput`; it replaces the old instance method that
decided whether the Wrist Menu blocks the Host Application's scene event.

## Vanilla Three.js

| Removed API | Replacement |
| --- | --- |
| `createThreeWristMenu(options)` | `createThreeWristMenuState(options)` |
| `ThreeWristMenu.group` | `state.presentation.group` |
| `ThreeWristMenu.sync(snapshot)` | `syncThreeWristMenu(state, snapshot)` |
| `ThreeWristMenu.update(update)` | `updateThreeWristMenu(state, update)` |
| `ThreeWristMenu.blocksSceneInput(inputSource)` | `threeWristMenuBlocksSceneInput(state, inputSource)` |
| `ThreeWristMenu.dispose()` | `disposeThreeWristMenu(state)` |

`replaceThreeWristMenuPresentation(state, factory)` remains the functional
presentation-replacement path.

## State ownership and lifetime

Keep the state returned by each `create*State` function. That object is the
source of truth; the functional operations mutate its documented state and do
not hide a second class instance. `stepWristMenuRuntime` returns the current
Presentation Model, while sync, Three update, scene-blocking, replacement, and
dispose operations receive the state explicitly.

Do not clone, reconstruct, spread, freeze, or replace returned state. In
particular, `ThreeWristMenuState.sessionHandlers` and
`ThreeWristMenuState.referenceSpaceHandler` are created once and keep stable
function identity for the lifetime of the state. Stable identity is what lets
session/reference-space transitions remove exactly the listeners previously
installed.

React's `<WristMenu>` props remain declarative. Internally it retains one
`ThreeWristMenuState` and calls the same functional Three integration.

The declaration fixture compiles these mappings against the extracted candidate
and the public-import fixture asserts that the removed constructors are absent.
