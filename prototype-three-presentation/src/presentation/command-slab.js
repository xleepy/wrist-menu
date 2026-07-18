import * as THREE from "three";
import { POOL_CAPACITY } from "../config.js";
import { VirtualizedMenuViewport } from "../model/virtualized-layout.js";
import { PresentationAtlas } from "./atlas.js";
import { QuadBatch } from "./quad-batch.js";

const DECORATIVE_RAYCAST = () => {};
const INTERACTION_LAYER = 0;
const DISABLED_LAYER = 1;

function roundedRectangle(width, height, radius) {
  const left = -width / 2;
  const right = width / 2;
  const bottom = -height / 2;
  const top = height / 2;
  const shape = new THREE.Shape();
  shape.moveTo(left + radius, bottom);
  shape.lineTo(right - radius, bottom);
  shape.quadraticCurveTo(right, bottom, right, bottom + radius);
  shape.lineTo(right, top - radius);
  shape.quadraticCurveTo(right, top, right - radius, top);
  shape.lineTo(left + radius, top);
  shape.quadraticCurveTo(left, top, left, top - radius);
  shape.lineTo(left, bottom + radius);
  shape.quadraticCurveTo(left, bottom, left + radius, bottom);
  return shape;
}

function backgroundColor(item, hovered) {
  if (item.disabled) return 0x151e1d;
  if (hovered) return 0x1d4438;
  if (item.selected || item.value === true) return 0x17372f;
  return 0x102020;
}

export class CommandSlabPresentation {
  constructor({ renderer, profile, items }) {
    this.renderer = renderer;
    this.profile = profile;
    this.viewport = new VirtualizedMenuViewport(items, profile);
    this.root = new THREE.Group();
    this.root.name = "prototype-package-owned-attachment-root";
    this.contentRoot = new THREE.Group();
    this.contentRoot.name = "prototype-presentation-owned-content-root";
    this.root.add(this.contentRoot);
    this.hoveredItemId = null;
    this.frame = 0;
    this.layoutBarrierFrame = 1;
    this.externallyTargetable = true;
    this.debugVisible = false;
    this.activeAssignments = [];

    this.viewportBottom = -profile.panelHeight / 2 + 0.01;
    this.viewportTop = this.viewportBottom + profile.viewportHeight;
    this.localTopPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), this.viewportTop);
    this.localBottomPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.viewportBottom);
    this.worldTopPlane = this.localTopPlane.clone();
    this.worldBottomPlane = this.localBottomPlane.clone();
    this.clippingPlanes = [this.worldTopPlane, this.worldBottomPlane];

    this.atlas = new PresentationAtlas(renderer);
    this.createPanel();
    this.createBatches();
    this.createHitRegions();
    this.renderAssignments({ barrier: true, forceAtlas: true });
  }

  createPanel() {
    const shape = roundedRectangle(this.profile.panelWidth, this.profile.panelHeight, 0.009);
    this.panelGeometry = new THREE.ShapeGeometry(shape, 8);
    this.panelMaterial = new THREE.MeshBasicMaterial({ color: 0x081415 });
    this.panel = new THREE.Mesh(this.panelGeometry, this.panelMaterial);
    this.panel.name = "command-slab-panel";
    this.panel.position.z = -0.001;
    this.panel.renderOrder = 0;
    this.panel.raycast = DECORATIVE_RAYCAST;
    this.contentRoot.add(this.panel);

    const borderPoints = shape.getPoints(42).map((point) => new THREE.Vector3(point.x, point.y, 0.001));
    this.borderGeometry = new THREE.BufferGeometry().setFromPoints(borderPoints);
    this.borderMaterial = new THREE.LineBasicMaterial({ color: 0x527d72, transparent: true, opacity: .62 });
    this.border = new THREE.LineLoop(this.borderGeometry, this.borderMaterial);
    this.border.name = "command-slab-border";
    this.border.renderOrder = 3;
    this.border.raycast = DECORATIVE_RAYCAST;
    this.contentRoot.add(this.border);
  }

  createBatches() {
    const atlasBase = {
      map: this.atlas.texture,
      transparent: true,
      alphaTest: .01,
      depthWrite: false,
      toneMapped: false,
    };
    this.headerBatch = new QuadBatch(2, new THREE.MeshBasicMaterial(atlasBase), "header-and-metrics-atlas-batch");
    this.rowTextBatch = new QuadBatch(POOL_CAPACITY, new THREE.MeshBasicMaterial({ ...atlasBase, clippingPlanes: this.clippingPlanes }), "virtualized-row-atlas-batch");
    this.rowBackgroundBatch = new QuadBatch(
      POOL_CAPACITY + 2,
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: .92, clippingPlanes: this.clippingPlanes }),
      "virtualized-row-background-batch",
    );
    this.rowBackgroundBatch.mesh.renderOrder = 1;
    this.headerBatch.mesh.renderOrder = 2;
    this.rowTextBatch.mesh.renderOrder = 2;
    this.contentRoot.add(this.headerBatch.mesh, this.rowBackgroundBatch.mesh, this.rowTextBatch.mesh);
  }

  createHitRegions() {
    this.hitGeometry = new THREE.BoxGeometry(1, 1, 1);
    this.hitMaterial = new THREE.MeshBasicMaterial({ visible: false });
    this.debugMaterial = new THREE.MeshBasicMaterial({ color: 0x9bffd7, wireframe: true, transparent: true, opacity: .28, depthTest: false });
    this.hitRegions = [];
    this.debugRegions = [];

    for (let slot = 0; slot < POOL_CAPACITY; slot += 1) {
      const region = new THREE.Mesh(this.hitGeometry, this.hitMaterial);
      region.name = `explicit-hit-region-${slot}`;
      region.userData = { kind: "hit-region", slot, eligible: false, itemId: null, disabled: false };
      region.layers.set(DISABLED_LAYER);
      this.contentRoot.add(region);
      this.hitRegions.push(region);

      const debug = new THREE.Mesh(this.hitGeometry, this.debugMaterial);
      debug.name = `debug-hit-region-${slot}`;
      debug.raycast = DECORATIVE_RAYCAST;
      debug.renderOrder = 100;
      debug.visible = false;
      this.contentRoot.add(debug);
      this.debugRegions.push(debug);
    }

    this.scrollSurfaceGeometry = new THREE.PlaneGeometry(1, 1);
    this.scrollSurfaceMaterial = new THREE.MeshBasicMaterial({ visible: false });
    this.scrollSurface = new THREE.Mesh(this.scrollSurfaceGeometry, this.scrollSurfaceMaterial);
    this.scrollSurface.name = "explicit-scroll-surface";
    this.scrollSurface.position.set(0, (this.viewportTop + this.viewportBottom) / 2, .002);
    this.scrollSurface.scale.set(this.profile.viewportWidth, this.profile.viewportHeight, 1);
    this.scrollSurface.userData = { kind: "scroll-surface", eligible: true };
    this.contentRoot.add(this.scrollSurface);
    this.raycastTargets = [...this.hitRegions, this.scrollSurface];
  }

  renderAssignments({ barrier, forceAtlas = false }) {
    const nextAssignments = this.viewport.assignments();
    const bindingsChanged = nextAssignments.length !== this.activeAssignments.length
      || nextAssignments.some((assignment, index) => assignment.entry.item.id !== this.activeAssignments[index]?.entry.item.id);
    const redrawAtlas = forceAtlas || bindingsChanged;
    this.activeAssignments = nextAssignments;
    const headerTop = this.profile.panelHeight / 2 - .006;
    const headerBottom = this.viewportTop + .004;
    const headerHeight = Math.max(.018, headerTop - headerBottom);
    const headerCenter = (headerTop + headerBottom) / 2;
    const footerTop = this.viewportBottom - .0015;
    const footerBottom = -this.profile.panelHeight / 2 + .002;
    const footerHeight = Math.max(.0035, footerTop - footerBottom);
    const footerCenter = (footerTop + footerBottom) / 2;

    if (redrawAtlas) {
      this.atlas.drawHeader(this.profile, this.viewport.anchor());
      this.atlas.drawFooter(this.profile);
    }
    this.headerBatch.begin();
    this.headerBatch.push({ x: 0, y: headerCenter, width: this.profile.viewportWidth, height: headerHeight, z: .003, uv: this.atlas.headerUv() });
    this.headerBatch.push({ x: 0, y: footerCenter, width: this.profile.viewportWidth, height: footerHeight, z: .003, uv: this.atlas.footerUv() });
    this.headerBatch.finish();

    this.rowBackgroundBatch.begin();
    this.rowTextBatch.begin();
    const viewportStart = this.viewport.scrollOffset;
    const viewportEnd = viewportStart + this.profile.viewportHeight;

    for (const assignment of this.activeAssignments) {
      const { slot, entry } = assignment;
      const item = entry.item;
      const centerY = this.viewportTop - (entry.top - viewportStart) - entry.height / 2;
      const hovered = item.id === this.hoveredItemId;
      if (redrawAtlas) this.atlas.drawRow(slot, item, { hovered });

      if (item.type !== "separator") {
        this.rowBackgroundBatch.push({
          x: 0,
          y: centerY,
          width: this.profile.viewportWidth,
          height: entry.height,
          z: .001,
          color: backgroundColor(item, hovered),
        });
      }

      this.rowTextBatch.push({
        x: 0,
        y: centerY,
        width: this.profile.viewportWidth,
        height: entry.height,
        z: .004,
        uv: this.atlas.rowUv(slot),
      });

      const fullyVisible = entry.top >= viewportStart - 1e-7 && entry.bottom <= viewportEnd + 1e-7;
      this.configureHitRegion(slot, item, centerY, entry.height, fullyVisible && item.type !== "separator");
    }

    if (redrawAtlas) this.atlas.clearUnused(this.activeAssignments.length);
    this.addScrollbar();
    this.rowBackgroundBatch.finish();
    this.rowTextBatch.finish();

    for (let slot = this.activeAssignments.length; slot < POOL_CAPACITY; slot += 1) this.configureHitRegion(slot, null, 0, 0, false);
    if (barrier) this.layoutBarrierFrame = this.frame + 1;
    this.updateTargetLayers();
  }

  addScrollbar() {
    const contentHeight = this.viewport.layout.contentHeight;
    if (contentHeight <= this.profile.viewportHeight) return;
    const trackWidth = .0014;
    const x = this.profile.viewportWidth / 2 - trackWidth;
    this.rowBackgroundBatch.push({
      x,
      y: (this.viewportTop + this.viewportBottom) / 2,
      width: trackWidth,
      height: this.profile.viewportHeight,
      z: .005,
      color: 0x29423d,
    });
    const ratio = this.profile.viewportHeight / contentHeight;
    const thumbHeight = Math.max(.012, this.profile.viewportHeight * ratio);
    const travel = this.profile.viewportHeight - thumbHeight;
    const progress = this.viewport.maxScroll() === 0 ? 0 : this.viewport.scrollOffset / this.viewport.maxScroll();
    this.rowBackgroundBatch.push({
      x,
      y: this.viewportTop - thumbHeight / 2 - travel * progress,
      width: trackWidth,
      height: thumbHeight,
      z: .006,
      color: 0x9bffd7,
    });
  }

  configureHitRegion(slot, item, centerY, height, eligible) {
    const region = this.hitRegions[slot];
    const debug = this.debugRegions[slot];
    region.position.set(0, centerY, .008);
    region.scale.set(this.profile.viewportWidth, height, .008);
    region.userData.itemId = item?.id ?? null;
    region.userData.disabled = item?.disabled === true;
    region.userData.eligible = eligible;
    debug.position.copy(region.position);
    debug.scale.copy(region.scale);
    debug.userData.itemId = item?.id ?? null;
    debug.visible = this.debugVisible && eligible;
  }

  updateTargetLayers() {
    const enabled = this.externallyTargetable && this.frame >= this.layoutBarrierFrame;
    for (const region of this.hitRegions) {
      region.layers.set(enabled && region.userData.eligible ? INTERACTION_LAYER : DISABLED_LAYER);
    }
    this.scrollSurface.layers.set(enabled ? INTERACTION_LAYER : DISABLED_LAYER);
  }

  updateWorldClipping() {
    this.contentRoot.updateMatrixWorld(true);
    this.worldTopPlane.copy(this.localTopPlane).applyMatrix4(this.contentRoot.matrixWorld);
    this.worldBottomPlane.copy(this.localBottomPlane).applyMatrix4(this.contentRoot.matrixWorld);
  }

  update(frame) {
    this.frame = frame;
    this.updateWorldClipping();
    this.updateTargetLayers();
    this.atlas.flush();
  }

  setTargetable(value) {
    this.externallyTargetable = value;
    this.updateTargetLayers();
  }

  setScroll(offset) {
    if (!this.viewport.setScroll(offset)) return false;
    this.renderAssignments({ barrier: true });
    return true;
  }

  setItems(items) {
    this.viewport.updateDefinition(items);
    this.renderAssignments({ barrier: true, forceAtlas: true });
  }

  setHoveredItem(itemId) {
    if (this.hoveredItemId === itemId) return;
    this.hoveredItemId = itemId;
    this.renderAssignments({ barrier: false, forceAtlas: true });
  }

  setDebugVisible(value) {
    this.debugVisible = value;
    for (let slot = 0; slot < POOL_CAPACITY; slot += 1) {
      this.debugRegions[slot].visible = value && this.hitRegions[slot].userData.eligible;
    }
  }

  raycast(raycaster) {
    return raycaster.intersectObjects(this.raycastTargets, false);
  }

  snapshot() {
    const anchor = this.viewport.anchor();
    return {
      profile: this.profile.key,
      scrollOffset: this.viewport.scrollOffset,
      maxScroll: this.viewport.maxScroll(),
      anchor,
      activePoolSlots: this.activeAssignments.length,
      activeHitRegions: this.hitRegions.filter((region) => region.userData.eligible).length,
      targetable: this.externallyTargetable && this.frame >= this.layoutBarrierFrame,
      atlasUploads: this.atlas.uploads,
    };
  }

  resourceEstimate() {
    return {
      atlasTextures: 1,
      atlasBytes: this.atlas.estimateBytes(),
      poolCapacity: POOL_CAPACITY,
      explicitHitRegionCapacity: POOL_CAPACITY,
      presentationBatches: 3,
    };
  }

  dispose() {
    this.root.removeFromParent();
    this.headerBatch.dispose();
    this.rowTextBatch.dispose();
    this.rowBackgroundBatch.dispose();
    this.panelGeometry.dispose();
    this.panelMaterial.dispose();
    this.borderGeometry.dispose();
    this.borderMaterial.dispose();
    this.scrollSurfaceGeometry.dispose();
    this.scrollSurfaceMaterial.dispose();
    this.hitGeometry.dispose();
    this.hitMaterial.dispose();
    this.debugMaterial.dispose();
    this.atlas.dispose();
  }
}
