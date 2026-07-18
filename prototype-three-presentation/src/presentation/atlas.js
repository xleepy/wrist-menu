import * as THREE from "three";
import { POOL_CAPACITY } from "../config.js";

const WIDTH = 1024;
const HEIGHT = 2048;
const HEADER_HEIGHT = 160;
const SLOT_HEIGHT = 128;
const FOOTER_TOP = HEADER_HEIGHT + SLOT_HEIGHT * POOL_CAPACITY;
const FOOTER_HEIGHT = 96;

const COLORS = {
  ink: "#ffffff",
  muted: "#aac3bd",
  dim: "#78918b",
  accent: "#9bffd7",
  disabled: "#71827f",
  selectedInk: "#ffffff",
};

function drawIcon(ctx, icon, x, y, size, color) {
  const half = size / 2;
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(2, size * 0.08);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();

  if (["plus", "duplicate", "remove"].includes(icon)) {
    ctx.moveTo(-half * .55, 0); ctx.lineTo(half * .55, 0);
    ctx.moveTo(0, -half * .55); ctx.lineTo(0, half * .55);
    if (icon === "duplicate") ctx.rect(-half * .36, -half * .36, half * .72, half * .72);
    if (icon === "remove") { ctx.moveTo(-half * .55, -half * .55); ctx.lineTo(half * .55, half * .55); }
  } else if (["cube", "grid"].includes(icon)) {
    ctx.rect(-half * .55, -half * .55, half * 1.1, half * 1.1);
    if (icon === "grid") {
      ctx.moveTo(-half * .18, -half * .55); ctx.lineTo(-half * .18, half * .55);
      ctx.moveTo(half * .18, -half * .55); ctx.lineTo(half * .18, half * .55);
      ctx.moveTo(-half * .55, -half * .18); ctx.lineTo(half * .55, -half * .18);
      ctx.moveTo(-half * .55, half * .18); ctx.lineTo(half * .55, half * .18);
    }
  } else if (["sphere", "matte", "gloss", "comfort"].includes(icon)) {
    ctx.arc(0, 0, half * .58, 0, Math.PI * 2);
    if (icon === "gloss") { ctx.moveTo(-half * .05, -half * .35); ctx.arc(-half * .05, -half * .35, half * .12, 0, Math.PI * 2); }
    if (icon === "comfort") { ctx.moveTo(-half * .4, half * .05); ctx.lineTo(-half * .1, half * .35); ctx.lineTo(half * .48, -half * .35); }
  } else if (icon === "cylinder") {
    ctx.ellipse(0, -half * .42, half * .5, half * .18, 0, 0, Math.PI * 2);
    ctx.moveTo(-half * .5, -half * .42); ctx.lineTo(-half * .5, half * .42);
    ctx.moveTo(half * .5, -half * .42); ctx.lineTo(half * .5, half * .42);
    ctx.ellipse(0, half * .42, half * .5, half * .18, 0, 0, Math.PI);
  } else if (["align", "next"].includes(icon)) {
    ctx.moveTo(-half * .55, half * .35); ctx.lineTo(half * .55, -half * .35);
    ctx.moveTo(half * .2, -half * .5); ctx.lineTo(half * .55, -half * .35); ctx.lineTo(half * .4, 0);
  } else if (icon === "clear") {
    ctx.arc(0, 0, half * .58, 0, Math.PI * 2);
    ctx.moveTo(-half * .4, half * .4); ctx.lineTo(half * .4, -half * .4);
  } else if (icon === "reset") {
    ctx.arc(0, 0, half * .55, -Math.PI * .25, Math.PI * 1.4);
    ctx.moveTo(-half * .62, -half * .08); ctx.lineTo(-half * .55, half * .42); ctx.lineTo(-half * .12, half * .24);
  } else {
    ctx.arc(0, 0, half * .42, 0, Math.PI * 2);
  }

  ctx.stroke();
  ctx.restore();
}

function fitText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let value = text;
  while (value.length > 1 && ctx.measureText(`${value}…`).width > maxWidth) value = value.slice(0, -1);
  return `${value}…`;
}

function uvRect(top, height) {
  return {
    u0: 0,
    u1: 1,
    v0: 1 - (top + height) / HEIGHT,
    v1: 1 - top / HEIGHT,
  };
}

export class PresentationAtlas {
  constructor(renderer) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = WIDTH;
    this.canvas.height = HEIGHT;
    this.context = this.canvas.getContext("2d", { alpha: true });
    this.context.clearRect(0, 0, WIDTH, HEIGHT);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.name = "prototype-command-slab-atlas";
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    this.dirty = true;
    this.uploads = 0;
  }

  drawHeader(profile, anchor) {
    const ctx = this.context;
    ctx.clearRect(0, 0, WIDTH, HEADER_HEIGHT);
    ctx.fillStyle = COLORS.accent;
    ctx.font = "600 22px WristMenuInter";
    ctx.fillText("COMMAND SLAB · SCAN FIRST", 8, 31);
    ctx.fillStyle = COLORS.ink;
    ctx.font = "600 48px WristMenuInter";
    ctx.fillText("Quick kit", 8, 83);
    ctx.fillStyle = COLORS.muted;
    ctx.font = "400 21px WristMenuInter";
    ctx.fillText("Primitive Workshop", 8, 118);

    ctx.textAlign = "right";
    ctx.fillStyle = COLORS.accent;
    ctx.font = "600 22px WristMenuInter";
    ctx.fillText("READY", WIDTH - 8, 33);
    ctx.fillStyle = COLORS.muted;
    ctx.font = "400 18px WristMenuInter";
    const anchorText = anchor ? `ANCHOR · ${anchor.itemId} +${Math.round(anchor.intraItemOffset * 1000)} mm` : "ANCHOR · TOP";
    ctx.fillText(anchorText, WIDTH - 8, 80);
    ctx.fillText(`${Math.round(profile.viewportWidth * 1000)} × ${Math.round(profile.viewportHeight * 1000)} mm VIEWPORT`, WIDTH - 8, 112);
    ctx.textAlign = "left";
    this.dirty = true;
  }

  drawRow(slot, item, cues = {}) {
    const top = HEADER_HEIGHT + slot * SLOT_HEIGHT;
    const ctx = this.context;
    ctx.clearRect(0, top, WIDTH, SLOT_HEIGHT);

    if (item.type === "separator") {
      ctx.strokeStyle = "rgba(155,255,215,.22)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(8, top + SLOT_HEIGHT / 2);
      ctx.lineTo(300, top + SLOT_HEIGHT / 2);
      ctx.moveTo(724, top + SLOT_HEIGHT / 2);
      ctx.lineTo(WIDTH - 8, top + SLOT_HEIGHT / 2);
      ctx.stroke();
      ctx.fillStyle = COLORS.dim;
      ctx.textAlign = "center";
      ctx.font = "600 25px WristMenuInter";
      ctx.fillText(item.label, WIDTH / 2, top + SLOT_HEIGHT / 2 + 9);
      ctx.textAlign = "left";
      this.dirty = true;
      return;
    }

    const disabled = item.disabled === true;
    const selected = item.selected === true || item.value === true;
    const primary = disabled ? COLORS.disabled : cues.hovered || selected ? COLORS.selectedInk : COLORS.ink;
    const secondary = disabled ? COLORS.disabled : COLORS.muted;
    const iconColor = disabled ? COLORS.disabled : selected || cues.hovered ? COLORS.accent : "#86a49d";
    drawIcon(ctx, item.icon, 60, top + SLOT_HEIGHT / 2, 54, iconColor);

    ctx.fillStyle = primary;
    ctx.font = "600 38px WristMenuInter";
    ctx.fillText(fitText(ctx, item.label, 640), 112, top + 54);
    ctx.fillStyle = secondary;
    ctx.font = "400 25px WristMenuInter";
    ctx.fillText(fitText(ctx, item.secondary ?? "", 640), 112, top + 91);

    ctx.textAlign = "right";
    ctx.fillStyle = disabled ? COLORS.disabled : selected ? COLORS.accent : COLORS.muted;
    ctx.font = "600 26px WristMenuInter";
    const trailing = disabled ? "UNAVAILABLE" : item.type === "toggle" ? (item.value ? "ON" : "OFF") : item.type === "choice" ? (item.selected ? "SELECTED" : "OPTION") : "ACTIVATE";
    ctx.fillText(trailing, WIDTH - 24, top + 74);
    ctx.textAlign = "left";
    this.dirty = true;
  }

  clearUnused(fromSlot) {
    if (fromSlot >= POOL_CAPACITY) return;
    this.context.clearRect(0, HEADER_HEIGHT + fromSlot * SLOT_HEIGHT, WIDTH, (POOL_CAPACITY - fromSlot) * SLOT_HEIGHT);
    this.dirty = true;
  }

  drawFooter(profile) {
    const ctx = this.context;
    ctx.clearRect(0, FOOTER_TOP, WIDTH, FOOTER_HEIGHT);
    ctx.fillStyle = COLORS.dim;
    ctx.font = "600 24px WristMenuInter";
    ctx.fillText(`${Math.round(profile.panelWidth * 1000)} × ${Math.round(profile.panelHeight * 1000)} mm PANEL`, 8, FOOTER_TOP + 55);
    ctx.textAlign = "right";
    ctx.fillText(`${POOL_CAPACITY} SLOT POOL · EMBEDDED FONT + PROCEDURAL ICONS`, WIDTH - 8, FOOTER_TOP + 55);
    ctx.textAlign = "left";
    this.dirty = true;
  }

  headerUv() { return uvRect(0, HEADER_HEIGHT); }
  rowUv(slot) { return uvRect(HEADER_HEIGHT + slot * SLOT_HEIGHT, SLOT_HEIGHT); }
  footerUv() { return uvRect(FOOTER_TOP, FOOTER_HEIGHT); }

  flush() {
    if (!this.dirty) return false;
    this.texture.needsUpdate = true;
    this.uploads += 1;
    this.dirty = false;
    return true;
  }

  estimateBytes() { return WIDTH * HEIGHT * 4; }
  dispose() { this.texture.dispose(); }
}
