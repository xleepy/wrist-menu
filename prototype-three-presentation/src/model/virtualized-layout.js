import { OVERSCAN_ENTRIES, POOL_CAPACITY } from "../config.js";

function entryHeight(item, profile) {
  return item.type === "separator" ? profile.separatorHeight : profile.rowHeight;
}

export function measureDefinition(items, profile) {
  let cursor = 0;
  const entries = items.map((item, index) => {
    const height = entryHeight(item, profile);
    const entry = { item, index, top: cursor, bottom: cursor + height, height };
    cursor = entry.bottom + profile.rowGap;
    return entry;
  });

  return {
    entries,
    contentHeight: Math.max(0, cursor - profile.rowGap),
    viewportHeight: profile.viewportHeight,
  };
}

export function maxScroll(layout) {
  return Math.max(0, layout.contentHeight - layout.viewportHeight);
}

export function clampScroll(layout, offset) {
  return Math.min(maxScroll(layout), Math.max(0, offset));
}

export function findFirstVisibleIndex(layout, scrollOffset) {
  let low = 0;
  let high = layout.entries.length;

  while (low < high) {
    const middle = (low + high) >>> 1;
    if (layout.entries[middle].bottom <= scrollOffset) low = middle + 1;
    else high = middle;
  }

  return Math.min(low, Math.max(0, layout.entries.length - 1));
}

export function visibleAssignments(layout, scrollOffset, options = {}) {
  const capacity = options.capacity ?? POOL_CAPACITY;
  const overscan = options.overscan ?? OVERSCAN_ENTRIES;
  if (layout.entries.length === 0) return [];

  const scroll = clampScroll(layout, scrollOffset);
  const firstVisible = findFirstVisibleIndex(layout, scroll);
  const start = Math.max(0, firstVisible - overscan);
  const viewportBottom = scroll + layout.viewportHeight;
  const assignments = [];

  for (let index = start; index < layout.entries.length && assignments.length < capacity; index += 1) {
    const entry = layout.entries[index];
    const beyondViewport = entry.top >= viewportBottom;
    if (beyondViewport && index > firstVisible + overscan && assignments.some((assignment) => assignment.entry.bottom >= viewportBottom)) break;
    assignments.push({ slot: assignments.length, entry });
  }

  const lastVisible = assignments.findLastIndex((assignment) => assignment.entry.top < viewportBottom);
  return assignments.slice(0, Math.min(assignments.length, lastVisible + overscan + 1));
}

export function captureTopAnchor(layout, scrollOffset) {
  if (layout.entries.length === 0) return null;
  const scroll = clampScroll(layout, scrollOffset);
  const entry = layout.entries[findFirstVisibleIndex(layout, scroll)];
  return { itemId: entry.item.id, intraItemOffset: scroll - entry.top };
}

export function restoreTopAnchor(layout, anchor) {
  if (!anchor) return 0;
  const entry = layout.entries.find((candidate) => candidate.item.id === anchor.itemId);
  if (!entry) return 0;
  return clampScroll(layout, entry.top + Math.min(Math.max(0, anchor.intraItemOffset), entry.height));
}

export class VirtualizedMenuViewport {
  constructor(items, profile) {
    this.profile = profile;
    this.items = items;
    this.layout = measureDefinition(items, profile);
    this.scrollOffset = 0;
    this.revision = 0;
  }

  setScroll(offset) {
    const next = clampScroll(this.layout, offset);
    if (Math.abs(next - this.scrollOffset) < 1e-7) return false;
    this.scrollOffset = next;
    this.revision += 1;
    return true;
  }

  updateDefinition(items) {
    const anchor = this.anchor();
    this.items = items;
    this.layout = measureDefinition(items, this.profile);
    this.scrollOffset = restoreTopAnchor(this.layout, anchor);
    this.revision += 1;
  }

  assignments() {
    return visibleAssignments(this.layout, this.scrollOffset);
  }

  anchor() {
    return captureTopAnchor(this.layout, this.scrollOffset);
  }

  maxScroll() {
    return maxScroll(this.layout);
  }
}
