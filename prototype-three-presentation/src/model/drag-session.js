export const DRAG_STATES = Object.freeze({
  NEUTRAL: "neutral",
  PENDING: "pending-selection",
  SCROLLING: "scroll-ownership",
  SETTLING: "settling",
});

export class DragSession {
  constructor({ handThreshold, controllerThreshold }) {
    this.thresholds = { hand: handThreshold, controller: controllerThreshold };
    this.state = DRAG_STATES.NEUTRAL;
    this.source = null;
    this.targetId = null;
    this.startPointY = 0;
    this.startScroll = 0;
    this.targetableFrame = 0;
  }

  begin({ source, pointY, targetId = null, scrollOffset, frame }) {
    if (this.state !== DRAG_STATES.NEUTRAL) return [];
    this.state = DRAG_STATES.PENDING;
    this.source = source;
    this.targetId = targetId;
    this.startPointY = pointY;
    this.startScroll = scrollOffset;
    this.targetableFrame = frame;
    return [{ type: "selection-pending", source, targetId }];
  }

  move({ pointY }) {
    if (this.state !== DRAG_STATES.PENDING && this.state !== DRAG_STATES.SCROLLING) return [];
    const movement = pointY - this.startPointY;
    const threshold = this.thresholds[this.source];
    const events = [];

    if (this.state === DRAG_STATES.PENDING && Math.abs(movement) >= threshold) {
      if (this.targetId) events.push({ type: "selection-cancelled", reason: "scroll-threshold", targetId: this.targetId });
      this.state = DRAG_STATES.SCROLLING;
      events.push({ type: "scroll-ownership-acquired", source: this.source, threshold, movement });
    }

    if (this.state === DRAG_STATES.SCROLLING) {
      events.push({ type: "scroll-changed", scrollOffset: this.startScroll + movement, movement });
    }

    return events;
  }

  end({ frame }) {
    if (this.state === DRAG_STATES.PENDING) {
      const targetId = this.targetId;
      const source = this.source;
      this.reset();
      return targetId ? [{ type: "selection-commit", targetId, source }] : [{ type: "selection-cancelled", reason: "no-target" }];
    }

    if (this.state === DRAG_STATES.SCROLLING) {
      this.state = DRAG_STATES.SETTLING;
      this.targetableFrame = frame + 1;
      return [{ type: "scroll-ownership-released", targetableFrame: this.targetableFrame }];
    }

    return [];
  }

  cancel(reason = "interrupted") {
    if (this.state === DRAG_STATES.NEUTRAL) return [];
    const hadSelection = this.targetId != null && this.state === DRAG_STATES.PENDING;
    this.reset();
    return hadSelection ? [{ type: "selection-cancelled", reason }] : [{ type: "scroll-cancelled", reason }];
  }

  advance(frame) {
    if (this.state === DRAG_STATES.SETTLING && frame >= this.targetableFrame) {
      this.reset();
      return [{ type: "targets-rearmed", frame }];
    }
    return [];
  }

  isTargetable() {
    return this.state === DRAG_STATES.NEUTRAL || this.state === DRAG_STATES.PENDING;
  }

  reset() {
    this.state = DRAG_STATES.NEUTRAL;
    this.source = null;
    this.targetId = null;
    this.startPointY = 0;
    this.startScroll = 0;
    this.targetableFrame = 0;
  }
}
