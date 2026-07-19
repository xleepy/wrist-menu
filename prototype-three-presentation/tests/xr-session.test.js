import test from "node:test";
import assert from "node:assert/strict";
import { endXrSession, snapshotXrSession } from "../src/model/xr-session.js";

test("session telemetry tolerates inputSources becoming unavailable after XR teardown", () => {
  const session = {
    frameRate: 72,
    visibilityState: "hidden",
    inputSources: undefined,
  };

  assert.deepEqual(snapshotXrSession(session, () => assert.fail("no input source should be described")), {
    frameRate: 72,
    visibilityState: "hidden",
    inputSources: [],
  });
});

test("session telemetry skips an input source that can no longer be described", () => {
  const readableSource = { id: "right-controller" };
  const expiredSource = { id: "expired-controller" };
  const session = { inputSources: [readableSource, expiredSource] };

  assert.deepEqual(snapshotXrSession(session, (source) => {
    if (source === expiredSource) throw new TypeError("source is detached");
    return source.id;
  }), {
    frameRate: null,
    visibilityState: null,
    inputSources: ["right-controller"],
  });
});

test("ending an XRSession treats an already-ended session as a completed teardown", async () => {
  const error = new Error("XRSession has already ended.");
  error.name = "InvalidStateError";
  const session = { end: async () => { throw error; } };

  assert.equal(await endXrSession(session), "already-ended");
});

test("ending an XRSession still reports unexpected failures", async () => {
  const error = new Error("runtime disconnected");
  const session = { end: async () => { throw error; } };

  await assert.rejects(endXrSession(session), error);
});
