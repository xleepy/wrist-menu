import { getProfile, millimetres, POOL_CAPACITY } from "../src/config.js";
import { createMenuDefinition } from "../src/fixtures/menu-definition.js";
import { DragSession } from "../src/model/drag-session.js";
import { VirtualizedMenuViewport } from "../src/model/virtualized-layout.js";

function rounded(value) {
  return Number(value.toFixed(6));
}

function dragTrace(source, movement) {
  const profile = getProfile();
  const session = new DragSession(profile);
  const events = [];
  events.push(...session.begin({ source, pointY: 0, targetId: "snap-grid", scrollOffset: 0.04, frame: 10 }));
  events.push(...session.move({ pointY: movement }));
  events.push(...session.end({ frame: 11 }));
  events.push(...session.advance(11));
  events.push(...session.advance(12));
  return events.map((event) => Object.fromEntries(Object.entries(event).map(([key, value]) => [key, typeof value === "number" ? rounded(value) : value])));
}

export function generateTraceEvidence() {
  const profile = getProfile();
  const viewport = new VirtualizedMenuViewport(createMenuDefinition(), profile);
  const offsets = [0, 0.037, viewport.maxScroll()];

  return {
    schema: "wrist-menu-three-presentation-trace/v1",
    profile: {
      key: profile.key,
      panelMm: [millimetres(profile.panelWidth), millimetres(profile.panelHeight)],
      viewportMm: [millimetres(profile.viewportWidth), millimetres(profile.viewportHeight)],
      rowMm: millimetres(profile.rowHeight),
      thresholdsMm: {
        hand: millimetres(profile.handThreshold),
        controller: millimetres(profile.controllerThreshold),
      },
    },
    pool: {
      capacity: POOL_CAPACITY,
      samples: offsets.map((offset) => {
        viewport.setScroll(offset);
        const anchor = viewport.anchor();
        return {
          scrollOffset: rounded(viewport.scrollOffset),
          activeSlots: viewport.assignments().length,
          firstItem: anchor?.itemId ?? null,
          intraItemOffset: rounded(anchor?.intraItemOffset ?? 0),
        };
      }),
    },
    interactions: {
      handUnderThreshold: dragTrace("hand", profile.handThreshold - .0001),
      handAtThreshold: dragTrace("hand", profile.handThreshold),
      controllerUnderThreshold: dragTrace("controller", profile.controllerThreshold - .0001),
      controllerAtThreshold: dragTrace("controller", profile.controllerThreshold),
    },
  };
}
