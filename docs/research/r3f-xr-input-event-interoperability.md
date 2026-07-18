# R3F and `@react-three/xr` input-event interoperability

Research for [Design package boundaries and renderer integrations](https://github.com/xleepy/wrist-menu/issues/7), captured 2026-07-18. This is a point-in-time inspection of `@react-three/xr` v6.6.30 and React Three Fiber (R3F) v9.6.1. Sources are the WebXR and DOM specifications, official project documentation, and released project source.

## Outcome

A controller primary action can reach both the Wrist Menu Package and Host Application scene handlers:

1. WebXR dispatches `selectstart`, `select`, and `selectend` on the shared `XRSession`.
2. The Wrist Menu Package can observe those events directly and run its own Three.js hit test.
3. Independently, `@react-three/xr` listens for `selectstart` and `selectend`, translates them into synthetic pointer down/up events, and may emit a scene `click`.

There is no WebXR-level spatial propagation path from the menu to scene objects and no standard “handled by this 3D target” flag. Calling `stopPropagation()` or `preventDefault()` on a normal `XRInputSourceEvent` cannot reliably suppress another listener on the same session. `stopImmediatePropagation()` could suppress listeners registered later for that exact raw event, but registration order, event choice, and collateral effects make it unsuitable as an integration contract.

The reliable boundary is the **scene pointer-event layer**. The `/react` adapter should wrap the package-owned Three.js group in an R3F-managed group with pointer handlers that call the synthetic event's `stopPropagation()` whenever an enabled menu hit region is struck. This requires only `@react-three/fiber`; `@react-three/xr` v6.6.30 deliberately recognizes R3F handlers while performing its own XR ray/sphere intersections.

The scene shield prevents R3F/`@react-three/xr` content behind the menu from receiving the synthesized pointer action. It does **not** suppress unrelated raw `XRSession` listeners, and the package must not claim that it does.

## The three event paths are distinct

| Layer | Native trigger | Spatial targeting | Delivery and suppression |
| --- | --- | --- | --- |
| WebXR | Controller primary action | None; the event identifies an `XRInputSource` and is dispatched on `XRSession` | All applicable session listeners can observe it. Normal `select*` events are not a 3D bubbling/cancelable mechanism. |
| R3F core | DOM pointer/mouse/wheel event connected to the canvas | R3F raycasts registered event objects and their descendants | Delivers nearest-to-farthest intersections. Synthetic `stopPropagation()` stops ancestors and farther intersections. |
| `@react-three/xr` v6 | WebXR `selectstart`/`selectend`, hand proximity, or another XR pointer source | `@pmndrs/pointer-events` traverses the Three.js scene and chooses one dominant intersection | Synthetic pointer events bubble from the hit object to ancestors. Distance and `pointerEventsOrder` decide the dominant hit. |

R3F core by itself does not translate tracked-controller `XRSession.select*` events. Its v9.6.1 core event manager accepts DOM `PointerEvent`, `MouseEvent`, and `WheelEvent` inputs; an XR integration such as `@react-three/xr` supplies the additional WebXR-to-pointer translation ([R3F v9.6.1 event source](https://github.com/pmndrs/react-three-fiber/blob/2a528745e9aa7c9e6cca41e404b59d45cf0d0cc7/packages/fiber/src/core/events.ts)).

## Raw WebXR delivery cannot arbitrate scene selection

The WebXR primary-action algorithm fires `selectstart` when the action begins. On a successful end it fires `select` and then `selectend`; a cancellation fires `selectend` without `select` ([WebXR primary actions](https://immersive-web.github.io/webxr/#primary-action)). Each `XRInputSourceEvent` is dispatched on the frame's `XRSession`, not on a spatial scene target ([WebXR input-source event dispatch](https://immersive-web.github.io/webxr/#fire-an-input-source-event)).

WebXR creates these events without overriding the inherited `EventInit` flags. The DOM defaults for `bubbles`, `cancelable`, and `composed` are all `false` ([DOM `EventInit`](https://dom.spec.whatwg.org/#dictdef-eventinit)). Therefore:

- `preventDefault()` has no standard effect on the normal `select*` event because it is not cancelable.
- `stopPropagation()` does not stop later listeners on the same session target. DOM dispatch continues through that target's listener list unless the stop-immediate flag is set.
- `stopImmediatePropagation()` stops later listeners on the same target, but only for that event and only after the caller runs. The DOM listener algorithm invokes listeners in the target's listener-list order and breaks specifically on the stop-immediate flag ([DOM event invocation](https://dom.spec.whatwg.org/#concept-event-listener-inner-invoke), [propagation methods](https://dom.spec.whatwg.org/#dom-event-stopimmediatepropagation)).

Using `stopImmediatePropagation()` would consequently depend on which library registered first, would silence every later session listener rather than only the scene object behind the menu, and would not connect `select` to the separately dispatched `selectend`. It also cannot cover a hand poke that another interaction system derives from per-frame joint proximity rather than a raw `select*` event.

The DOM Overlays module has a separate, cancelable `beforexrselect` event that can suppress WebXR `select*` generation for DOM-overlay content. That mechanism applies to DOM overlay hit testing, not Three.js meshes, and is not an arbitration hook for this wrist menu ([WebXR DOM Overlays event handling](https://immersive-web.github.io/dom-overlays/#onbeforexrselect)).

## How `@react-three/xr` duplicates the action into scene handlers

The released v6.6.30 default controller ray pointer calls `usePointerXRInputSourceEvents(..., 'select', ...)` ([default XR pointer components](https://github.com/pmndrs/xr/blob/8d2fda1ac27acb8959bd8055b8b3a1a7dcfb0611/packages/react/xr/src/default.tsx)). That hook binds to the active session ([React pointer hook](https://github.com/pmndrs/xr/blob/8d2fda1ac27acb8959bd8055b8b3a1a7dcfb0611/packages/react/xr/src/pointer.tsx)). The underlying binder maps:

- `selectstart` to `pointer.down(...)`;
- `selectend` to `pointer.up(...)`.

Both listeners are attached directly to the same `XRSession` and filtered by `event.inputSource` ([XR event binder](https://github.com/pmndrs/xr/blob/8d2fda1ac27acb8959bd8055b8b3a1a7dcfb0611/packages/xr/src/pointer/event.ts)). The XR root updates its combined pointer intersection against `state.scene` every frame before ordinary scene work ([XR React root](https://github.com/pmndrs/xr/blob/8d2fda1ac27acb8959bd8055b8b3a1a7dcfb0611/packages/react/xr/src/xr.tsx)).

`pointer.up()` always emits a synthetic `pointerup` when it has a current intersection. It also emits `click` when down and up correspond to the same target/button within the configured click threshold; the source default is 300 ms ([pointer state machine](https://github.com/pmndrs/xr/blob/8d2fda1ac27acb8959bd8055b8b3a1a7dcfb0611/packages/pointer-events/src/pointer.ts)). Thus the duplicate scene consequence is broader than `onClick`: a Host Application may act on `onPointerDown` or `onPointerUp` even when a long hold does not qualify as a click.

If the Wrist Menu Package commits on WebXR `select`, its callback runs before the separately dispatched `selectend` that drives `@react-three/xr`'s pointer-up/click path. That ordering does not consume the later event. The package's already-approved next-frame Host Snapshot boundary is helpful here: menu geometry remains stable through the remainder of the raw event sequence, so the scene shield can still receive and stop the synthesized pointer-up/click.

## Propagation and pointer capture

### R3F core

R3F intersects every registered event object recursively, collects all intersections, and expands each hit to R3F-managed ancestors. Its source explicitly handles a raw, unmanaged hit object by walking upward to a managed parent for root state ([R3F v9.6.1 event source](https://github.com/pmndrs/react-three-fiber/blob/2a528745e9aa7c9e6cca41e404b59d45cf0d0cc7/packages/fiber/src/core/events.ts)). R3F's official event documentation specifies that events visit the nearest object and its ancestors, then farther objects and their ancestors. Its synthetic `stopPropagation()` stops both ancestor bubbling and delivery to farther objects ([R3F event propagation](https://r3f.docs.pmnd.rs/api/events#event-propagation-bubbling)).

R3F pointer capture is not an exclusive replacement for hit testing. The captured target is appended to the intersection result, after actual hits; the captured handler may then stop propagation ([R3F pointer capture](https://r3f.docs.pmnd.rs/api/events#pointer-capture)). Because an actually hit scene object can receive the event before an appended capture target, capture alone is not a dependable “menu first” shield.

### `@react-three/xr` / `@pmndrs/pointer-events`

`@react-three/xr` documents the familiar R3F handler names and exposes `pointerEvents`, `pointerEventsType`, and `pointerEventsOrder` on Three.js objects. Higher `pointerEventsOrder` values take precedence over lower values, then normal intersection distance applies ([XR interaction documentation](https://pmndrs.github.io/xr/docs/tutorials/interactions)).

The v6.6.30 implementation differs from R3F core internally:

- It traverses the scene, asks each eligible object's `raycast()` method for intersections, and selects one dominant intersection by `pointerEventsOrder` and then distance ([target traversal and sorting](https://github.com/pmndrs/xr/blob/8d2fda1ac27acb8959bd8055b8b3a1a7dcfb0611/packages/pointer-events/src/intersections/utils.ts), [ray intersector](https://github.com/pmndrs/xr/blob/8d2fda1ac27acb8959bd8055b8b3a1a7dcfb0611/packages/pointer-events/src/intersections/ray.ts)).
- It emits to listeners on the selected object and then recursively to its parents. Synthetic `stopPropagation()` stops that ancestor walk; `stopImmediatePropagation()` stops later listeners on the same object ([pointer-event emission](https://github.com/pmndrs/xr/blob/8d2fda1ac27acb8959bd8055b8b3a1a7dcfb0611/packages/pointer-events/src/event.ts)).
- Its pointer capture replaces the normal intersection calculation with an intersection against the captured object's plane, unlike R3F core's additive capture ([pointer capture implementation](https://github.com/pmndrs/xr/blob/8d2fda1ac27acb8959bd8055b8b3a1a7dcfb0611/packages/pointer-events/src/pointer.ts)).

The package should not use pointer capture as a cross-framework shield because the two inspected systems intentionally implement different capture ordering.

## How raw Three.js hit regions participate

A Three.js `Mesh`, `Line`, `Points`, or another object with a usable `raycast()` method can provide geometric intersections; a plain `Group` has no hit surface of its own. Recursive `Raycaster.intersectObject()` includes descendants and returns intersections ordered by distance ([Three.js `Raycaster`](https://threejs.org/docs/pages/Raycaster.html)). Geometry alone, however, is not enough to enter each framework's event target set.

### In R3F core

R3F registers managed objects that have pointer handlers. It recursively raycasts each registered object, so raw Three.js descendants can supply the actual geometry hit even when those descendants were created imperatively. The event then identifies the raw descendant as `event.object` and the managed ancestor that registered the handler as `event.eventObject` ([R3F event source](https://github.com/pmndrs/react-three-fiber/blob/2a528745e9aa7c9e6cca41e404b59d45cf0d0cc7/packages/fiber/src/core/events.ts), [R3F event data](https://r3f.docs.pmnd.rs/api/events#event-data)). A raw subtree with no managed handler at itself or an ancestor is not independently registered by R3F merely because it contains raycastable meshes.

### In `@react-three/xr` v6.6.30

The framework-agnostic pointer walker considers a raw object eligible when any of the following is true:

- it or an ancestor has an R3F handler (`__r3f.eventCount`);
- it or an ancestor has a matching Three.js event listener;
- inherited/configured `pointerEvents` is `auto` rather than the default `listener` mode.

It then calls each eligible object's `raycast()` method. Event emission recognizes both R3F handlers and Three.js `Object3D` listeners ([target eligibility](https://github.com/pmndrs/xr/blob/8d2fda1ac27acb8959bd8055b8b3a1a7dcfb0611/packages/pointer-events/src/intersections/utils.ts), [listener compatibility](https://github.com/pmndrs/xr/blob/8d2fda1ac27acb8959bd8055b8b3a1a7dcfb0611/packages/pointer-events/src/event.ts)). Three.js itself provides `Object3D` with `EventDispatcher` listener methods, but `@react-three/xr`'s decision to inspect those listeners is an upstream implementation contract, not part of WebXR ([Three.js `EventDispatcher`](https://threejs.org/docs/pages/EventDispatcher.html)).

This explains why an R3F-managed wrapper is the useful common seam: one handler on the wrapper makes its package-created raw descendants eligible in both inspected scene event systems.

## Recommended package boundary: an R3F scene-event shield

Keep semantic selection in the existing raw WebXR/Three.js path. The React wrapper's event handlers must only arbitrate the Host Application's scene pointer system; they must never emit a second Selection Intent.

Conceptually, `/react` should mount the `/three` instance like this:

```tsx
const blockSceneEvent = (event: ThreeEvent<PointerEvent>) => {
  if (isEnabledWristMenuHit(event.object)) {
    event.stopPropagation()
  }
}

return (
  <group
    onPointerOver={blockSceneEvent}
    onPointerMove={blockSceneEvent}
    onPointerDown={blockSceneEvent}
    onPointerUp={blockSceneEvent}
    onPointerCancel={blockSceneEvent}
    onClick={blockSceneEvent}
    onDoubleClick={blockSceneEvent}
    onContextMenu={blockSceneEvent}
  >
    <primitive object={threeMenu.group} />
  </group>
)
```

The concrete implementation should obey these constraints:

1. **Only intentional hit regions raycast.** Package-owned decorative/text meshes should use a no-op `raycast`; otherwise the managed wrapper makes those visuals event-eligible too.
2. **Disabled/hidden regions cannot shield.** Detach them from the shield subtree or disable their `raycast()` behavior whenever they are not targetable. Visibility alone should not be treated as the interaction contract.
3. **Shield every actionable pointer event.** R3F requires a stop for each delivered event type; stopping hover does not automatically consume a later down/up/click. Include double-click/context-menu because the XR pointer implementation can synthesize them after repeated or alternate-button actions.
4. **Do not capture by default.** Menu Selection Ownership remains in `/core`; the shield exists only to prevent another scene target from also acting.
5. **Do not touch `nativeEvent`.** In XR the synthetic event's `nativeEvent` can be the shared `XRInputSourceEvent`. Calling its `stopImmediatePropagation()` would reintroduce listener-order coupling and could suppress unrelated Host Application behavior.
6. **Let normal geometric ordering win.** Menu hit regions should sit on or slightly in front of their visible controls. `pointerEventsOrder` is a useful host/framework override but is specific to the upstream pointer system and is not honored by R3F core, so it should not be the package's only guarantee.

This design imports only R3F in `/react`. In a Host Application using `@react-three/xr`, its event system discovers the R3F wrapper handlers through the compatibility path shown above. In a Host Application using ordinary R3F DOM events, the same wrapper and `stopPropagation()` behavior block farther intersections. Vanilla `/three` remains unaware of either React library.

## Required compatibility tests

Add a fixture with a scene button directly behind an enabled wrist-menu item and record both semantic and scene events:

1. With raw R3F events, a pointer action on the menu yields the menu result and zero events on the scene button; a ray beside the menu still reaches the scene button.
2. With `@react-three/xr` v6.6.30, one controller action yields exactly one Wrist Menu Selection Intent and no scene `onPointerDown`, `onPointerUp`, or `onClick` behind it.
3. Repeat with a press longer than the upstream click threshold, a cancelled press, a ray that leaves before release, and two rapid presses.
4. Repeat for default and custom presentation factories, proving that both declare only their intended hit geometry as raycastable.
5. Repeat with direct-hand poke and pinch/select sources; poke-derived pointer events need shielding even when no raw `select*` event exists.
6. Run the fixture in every claimed R3F/React compatibility lane and with any supported custom Canvas event-manager configuration.

## Unresolved facts and limits

- `@react-three/xr` documents R3F-style handlers and pointer configuration, but the exact `__r3f`/raw-listener discovery shown here is implementation source from v6.6.30. Treat the compatibility fixture as a release gate before widening or upgrading the supported version.
- R3F v9.6.1 was inspected directly. The intended R3F 8 / React 18 lane still needs the same fixture; similar API documentation is not proof of identical raw-descendant behavior.
- A Host Application can replace or filter its R3F/`@react-three/xr` event system. The package cannot guarantee scene shielding if that custom system ignores R3F handlers or rewrites intersection order; it should emit/document a compatibility status rather than seize the host's global event manager.
- A Host Application may deliberately assign higher `pointerEventsOrder` to another overlay. The package needs an explicit policy for whether its wrapper exposes an optional order value or leaves all such priority arbitration to the host.
- No standard mechanism prevents arbitrary code from independently observing the same `XRSession.select*` event. The supported guarantee is “one Wrist Menu Selection Intent and no behind-menu scene pointer action,” not exclusive ownership of the physical controller action across the whole application.
- Physical Quest validation is still required for simultaneous pinch-select and fingertip-touch behavior; specifications and source establish delivery mechanics, not device gesture timing.

