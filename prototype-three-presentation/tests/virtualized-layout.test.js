import test from "node:test";
import assert from "node:assert/strict";
import { getProfile, POOL_CAPACITY, PROFILES } from "../src/config.js";
import { createMenuDefinition } from "../src/fixtures/menu-definition.js";
import {
  VirtualizedMenuViewport,
  clampScroll,
  maxScroll,
  measureDefinition,
  visibleAssignments,
} from "../src/model/virtualized-layout.js";

test("the fixed pool covers all sampled offsets without exceeding twelve slots", () => {
  const profile = getProfile("C");
  const layout = measureDefinition(createMenuDefinition(), profile);
  const limit = maxScroll(layout);

  for (let step = 0; step <= 20; step += 1) {
    const assignments = visibleAssignments(layout, limit * (step / 20));
    assert.ok(assignments.length <= POOL_CAPACITY);
    assert.ok(assignments.some(({ entry }) => entry.bottom > limit * (step / 20)));
  }
});

test("twelve slots cover the pathological all-separator viewport in every profile", () => {
  for (const profile of PROFILES) {
    const minimumStride = profile.separatorHeight + profile.rowGap;
    const required = Math.ceil(profile.viewportHeight / minimumStride) + 2;
    assert.ok(required <= POOL_CAPACITY, `${profile.key} requires ${required} slots`);
  }
});

test("scroll offsets clamp hard at both ends", () => {
  const layout = measureDefinition(createMenuDefinition(), getProfile("A"));
  assert.equal(clampScroll(layout, -1), 0);
  assert.equal(clampScroll(layout, Number.POSITIVE_INFINITY), maxScroll(layout));
});

test("a compatible definition update preserves the stable top item and intra-item offset", () => {
  const profile = getProfile("A");
  const items = createMenuDefinition();
  const viewport = new VirtualizedMenuViewport(items, profile);
  const target = viewport.layout.entries.find((entry) => entry.item.id === "select-next");
  viewport.setScroll(target.top + 0.004);
  assert.deepEqual(viewport.anchor(), { itemId: "select-next", intraItemOffset: 0.0040000000000000036 });

  viewport.updateDefinition([
    { id: "new-before", type: "action", label: "Inserted", secondary: "Compatible update" },
    ...items,
  ]);

  const restored = viewport.anchor();
  assert.equal(restored.itemId, "select-next");
  assert.ok(Math.abs(restored.intraItemOffset - 0.004) < 1e-9);
});

test("separators occupy visual slots but remain distinguishable from interactive rows", () => {
  const layout = measureDefinition(createMenuDefinition(), getProfile("A"));
  const separator = layout.entries.find((entry) => entry.item.type === "separator");
  assert.ok(separator);
  assert.equal(separator.height, 0.008);
  assert.ok(separator.height < getProfile("A").rowHeight);
});
