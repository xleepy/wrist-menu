import test from "node:test";
import assert from "node:assert/strict";
import { DragSession, DRAG_STATES } from "../src/model/drag-session.js";

const thresholds = { handThreshold: 0.008, controllerThreshold: 0.012 };

test("under-threshold hand movement preserves the pending Selection Commit", () => {
  const session = new DragSession(thresholds);
  session.begin({ source: "hand", pointY: 0, targetId: "spawn-cube", scrollOffset: 0.04, frame: 1 });

  assert.deepEqual(session.move({ pointY: 0.0079 }), []);
  assert.equal(session.state, DRAG_STATES.PENDING);
  assert.deepEqual(session.end({ frame: 2 }), [
    { type: "selection-commit", targetId: "spawn-cube", source: "hand" },
  ]);
  assert.equal(session.state, DRAG_STATES.NEUTRAL);
});

test("controller movement at the threshold cancels selection and acquires Scroll Ownership", () => {
  const session = new DragSession(thresholds);
  session.begin({ source: "controller", pointY: 0.02, targetId: "snap-grid", scrollOffset: 0.04, frame: 10 });

  const moveEvents = session.move({ pointY: 0.032 });
  assert.equal(moveEvents[0].type, "selection-cancelled");
  assert.equal(moveEvents[1].type, "scroll-ownership-acquired");
  assert.equal(moveEvents[1].threshold, 0.012);
  assert.deepEqual(moveEvents[2], { type: "scroll-changed", scrollOffset: 0.052000000000000005, movement: 0.012 });
  assert.equal(session.state, DRAG_STATES.SCROLLING);
  assert.equal(session.isTargetable(), false);

  assert.deepEqual(session.end({ frame: 11 }), [
    { type: "scroll-ownership-released", targetableFrame: 12 },
  ]);
  assert.equal(session.state, DRAG_STATES.SETTLING);
  assert.deepEqual(session.advance(11), []);
  assert.deepEqual(session.advance(12), [{ type: "targets-rearmed", frame: 12 }]);
  assert.equal(session.isTargetable(), true);
});

test("a viewport press without an item can scroll but cannot commit", () => {
  const session = new DragSession(thresholds);
  session.begin({ source: "controller", pointY: 0, scrollOffset: 0.08, frame: 1 });
  assert.deepEqual(session.move({ pointY: 0.005 }), []);
  assert.deepEqual(session.end({ frame: 2 }), [{ type: "selection-cancelled", reason: "no-target" }]);
});
