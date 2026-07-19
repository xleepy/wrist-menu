import * as THREE from "three";
import "./styles.css";
import { PROFILES, millimetres, profileFromLocation } from "./config.js";
import { createMenuDefinition, applySelectionIntent } from "./fixtures/menu-definition.js";
import { DragSession, DRAG_STATES } from "./model/drag-session.js";
import { PerformanceSampler } from "./performance-sampler.js";
import { installBundledFont } from "./presentation/bundled-font.js";
import { CommandSlabPresentation } from "./presentation/command-slab.js";
import { captureBrowserErrors, createVrTestLogger } from "./vr-test-logger.js";
import { generateTraceEvidence } from "../scripts/trace-scenarios.mjs";

const searchParams = new URLSearchParams(window.location.search);
const vrTestLogger = import.meta.env.DEV
  ? createVrTestLogger({
      issue: 13,
      branch: "prototype/issue-13-three-presentation",
      profile: searchParams.get("variant")?.toUpperCase() || "A",
      userAgent: navigator.userAgent,
      secureContext: window.isSecureContext,
    })
  : null;
if (vrTestLogger) {
  captureBrowserErrors(vrTestLogger);
}

if (searchParams.get("iwer") === "1") {
  const { installQuest2IwerRuntime } = await import("./iwer-runtime.js");
  await installQuest2IwerRuntime();
}

await installBundledFont();

const profile = profileFromLocation();
let items = createMenuDefinition();
let selectionSource = "controller";
let debugVisible = searchParams.get("debug") === "1";
let frame = 0;
let activePointerId = null;
let activeTargetDisabled = false;
let activeXrController = null;
let activeHandSource = null;
let currentSession = null;
let xrPlacementPending = false;
let lastHudUpdate = 0;
let lastVrTelemetryAt = -Infinity;
let lastLoggedScrollAt = -Infinity;
const eventTrace = [];

const canvas = document.querySelector("#scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.localClippingEnabled = true;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType("local-floor");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x03090a);
scene.fog = new THREE.FogExp2(0x03090a, .5);

const camera = new THREE.PerspectiveCamera(44, 1, .01, 20);
camera.position.set(0, 1.39, .04);
camera.lookAt(0, 1.37, -.55);

const attachmentHost = new THREE.Group();
attachmentHost.name = "host-application-attachment-parent";
attachmentHost.position.set(0, 1.37, -.55);
scene.add(attachmentHost);

const presentation = new CommandSlabPresentation({ renderer, profile, items });
attachmentHost.add(presentation.root);
presentation.setDebugVisible(debugVisible);

const drag = new DragSession(profile);
const performanceSampler = new PerformanceSampler();
const raycaster = new THREE.Raycaster();
raycaster.layers.set(0);
const pointerNdc = new THREE.Vector2();
const panelPlane = new THREE.Plane();
const planeNormal = new THREE.Vector3();
const planePoint = new THREE.Vector3();
const worldPoint = new THREE.Vector3();
const localPoint = new THREE.Vector3();
const worldQuaternion = new THREE.Quaternion();
const controllerRotation = new THREE.Matrix4();
const inversePresentationMatrix = new THREE.Matrix4();
const controllerOrigin = new THREE.Vector3();
const controllerDirection = new THREE.Vector3();
const controllerRay = new THREE.Raycaster();
controllerRay.layers.set(0);
const viewerPosition = new THREE.Vector3();
const viewerQuaternion = new THREE.Quaternion();
const viewerForward = new THREE.Vector3();
const viewerDown = new THREE.Vector3();

function decorativeMaterial(color, opacity) {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
}

function addWorkshopReference() {
  const grid = new THREE.GridHelper(2.5, 24, 0x274f46, 0x132723);
  grid.position.y = .78;
  grid.position.z = -.7;
  grid.material.transparent = true;
  grid.material.opacity = .3;
  grid.raycast = () => {};
  scene.add(grid);

  const wrist = new THREE.Group();
  wrist.position.set(0, -.105, -.022);
  wrist.rotation.z = -.08;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(.038, .044, .12, 20), decorativeMaterial(0x244a43, .55));
  band.rotation.z = Math.PI / 2;
  band.raycast = () => {};
  const palm = new THREE.Mesh(new THREE.SphereGeometry(.052, 18, 12), decorativeMaterial(0x335f56, .32));
  palm.scale.set(1.15, .75, .35);
  palm.position.set(.065, .012, -.008);
  palm.raycast = () => {};
  wrist.add(band, palm);
  attachmentHost.add(wrist);
}

addWorkshopReference();

function updatePanelPlane() {
  presentation.root.updateMatrixWorld(true);
  presentation.root.getWorldQuaternion(worldQuaternion);
  planeNormal.set(0, 0, 1).applyQuaternion(worldQuaternion).normalize();
  planePoint.set(0, 0, .008).applyMatrix4(presentation.root.matrixWorld);
  panelPlane.setFromNormalAndCoplanarPoint(planeNormal, planePoint);
}

function localPointFromRay(ray) {
  updatePanelPlane();
  if (!ray.intersectPlane(panelPlane, worldPoint)) return null;
  inversePresentationMatrix.copy(presentation.root.matrixWorld).invert();
  return localPoint.copy(worldPoint).applyMatrix4(inversePresentationMatrix);
}

function setPointerRay(event) {
  const bounds = canvas.getBoundingClientRect();
  pointerNdc.set(
    ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
    -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
  );
  raycaster.setFromCamera(pointerNdc, camera);
  return raycaster.ray;
}

function hitFromRay(raySource) {
  raycaster.ray.copy(raySource);
  return presentation.raycast(raycaster)[0] ?? null;
}

function pushEvents(events) {
  for (const event of events) {
    if (event.type === "scroll-changed") presentation.setScroll(event.scrollOffset);
    if (event.type === "selection-commit") {
      if (activeTargetDisabled) {
        recordEvent({ type: "unavailable-feedback", targetId: event.targetId });
        continue;
      }
      const nextItems = applySelectionIntent(items, event.targetId);
      if (nextItems !== items) {
        items = nextItems;
        presentation.setItems(items);
      }
    }
    recordEvent(event);
  }
  presentation.setTargetable(drag.isTargetable());
}

function recordEvent(event) {
  const record = { frame, ...event };
  eventTrace.push(record);
  if (eventTrace.length > 50) eventTrace.shift();
  const shouldPersist = event.type !== "scroll-changed" || performance.now() - lastLoggedScrollAt >= 500;
  if (shouldPersist) {
    if (event.type === "scroll-changed") lastLoggedScrollAt = performance.now();
    vrTestLogger?.record(`prototype.${event.type}`, record);
  }
}

function describeInputSource(inputSource) {
  return {
    handedness: inputSource.handedness,
    targetRayMode: inputSource.targetRayMode,
    profiles: [...inputSource.profiles],
    hasHand: Boolean(inputSource.hand),
    hasGripSpace: Boolean(inputSource.gripSpace),
    gamepadMapping: inputSource.gamepad?.mapping ?? null,
  };
}

function beginFromRay(raySource, source) {
  const point = localPointFromRay(raySource);
  const hit = hitFromRay(raySource);
  if (!point || !hit) return false;
  const itemId = hit.object.userData.kind === "hit-region" ? hit.object.userData.itemId : null;
  activeTargetDisabled = hit.object.userData.disabled === true;
  pushEvents(drag.begin({ source, pointY: point.y, targetId: itemId, scrollOffset: presentation.viewport.scrollOffset, frame }));
  return true;
}

function moveFromRay(raySource) {
  const point = localPointFromRay(raySource);
  if (!point) return;
  pushEvents(drag.move({ pointY: point.y }));
}

function endActiveDrag() {
  pushEvents(drag.end({ frame }));
  activeTargetDisabled = false;
}

canvas.addEventListener("pointerdown", (event) => {
  if (renderer.xr.isPresenting || activePointerId != null) return;
  if (!beginFromRay(setPointerRay(event), selectionSource)) return;
  activePointerId = event.pointerId;
  canvas.setPointerCapture(event.pointerId);
  canvas.classList.add("is-dragging");
});

canvas.addEventListener("pointermove", (event) => {
  if (renderer.xr.isPresenting) return;
  const ray = setPointerRay(event);
  if (event.pointerId === activePointerId) {
    moveFromRay(ray);
    return;
  }
  const hit = hitFromRay(ray);
  presentation.setHoveredItem(hit?.object.userData.kind === "hit-region" ? hit.object.userData.itemId : null);
});

function releasePointer(event) {
  if (event.pointerId !== activePointerId) return;
  endActiveDrag();
  activePointerId = null;
  canvas.classList.remove("is-dragging");
}

canvas.addEventListener("pointerup", releasePointer);
canvas.addEventListener("pointercancel", (event) => {
  if (event.pointerId !== activePointerId) return;
  pushEvents(drag.cancel("pointer-cancel"));
  activePointerId = null;
  activeTargetDisabled = false;
  canvas.classList.remove("is-dragging");
});

canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  presentation.setScroll(presentation.viewport.scrollOffset + event.deltaY * .00012);
  recordEvent({ type: "desktop-wheel-scroll", scrollOffset: presentation.viewport.scrollOffset });
}, { passive: false });

function controllerRayFrom(group) {
  group.updateMatrixWorld(true);
  controllerRotation.identity().extractRotation(group.matrixWorld);
  controllerOrigin.setFromMatrixPosition(group.matrixWorld);
  controllerDirection.set(0, 0, -1).applyMatrix4(controllerRotation).normalize();
  controllerRay.set(controllerOrigin, controllerDirection);
  return controllerRay.ray;
}

function setupControllers() {
  for (let index = 0; index < 2; index += 1) {
    const controller = renderer.xr.getController(index);
    controller.userData.connected = false;
    const rayGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]);
    const rayLine = new THREE.Line(rayGeometry, new THREE.LineBasicMaterial({ color: 0x9bffd7, transparent: true, opacity: .55 }));
    rayLine.name = "prototype-controller-target-ray";
    rayLine.scale.z = .8;
    rayLine.visible = false;
    rayLine.raycast = () => {};
    controller.add(rayLine);
    controller.addEventListener("connected", (event) => {
      controller.userData.connected = true;
      rayLine.visible = true;
      recordEvent({ type: "xr-controller-connected", index, source: describeInputSource(event.data) });
    });
    controller.addEventListener("disconnected", () => {
      controller.userData.connected = false;
      rayLine.visible = false;
      recordEvent({ type: "xr-controller-disconnected", index });
      if (activeXrController === controller) {
        pushEvents(drag.cancel("controller-disconnected"));
        activeXrController = null;
      }
    });
    controller.addEventListener("selectstart", () => {
      if (!renderer.xr.isPresenting || activeXrController || activeHandSource) return;
      if (beginFromRay(controllerRayFrom(controller), "controller")) activeXrController = controller;
    });
    controller.addEventListener("selectend", () => {
      if (activeXrController !== controller) return;
      endActiveDrag();
      activeXrController = null;
    });
    scene.add(controller);
  }
}

setupControllers();

function localHandPoint(frameObject, inputSource) {
  const referenceSpace = renderer.xr.getReferenceSpace();
  const tipSpace = inputSource.hand?.get("index-finger-tip");
  if (!referenceSpace || !tipSpace) return null;
  const pose = frameObject.getJointPose(tipSpace, referenceSpace);
  if (!pose) return null;
  worldPoint.set(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z);
  presentation.root.updateMatrixWorld(true);
  inversePresentationMatrix.copy(presentation.root.matrixWorld).invert();
  localPoint.copy(worldPoint).applyMatrix4(inversePresentationMatrix);
  return { point: localPoint.clone(), radius: pose.radius ?? .008 };
}

function directContact(local, radius) {
  const insideX = Math.abs(local.x) <= profile.viewportWidth / 2 + radius;
  const insideY = local.y >= presentation.viewportBottom - radius && local.y <= presentation.viewportTop + radius;
  const touchesDepth = local.z - radius <= .012 && local.z + radius >= 0;
  return insideX && insideY && touchesDepth;
}

function directHit(local, radius) {
  for (const region of presentation.hitRegions) {
    if (!region.userData.eligible) continue;
    if (Math.abs(local.x - region.position.x) <= region.scale.x / 2 + radius && Math.abs(local.y - region.position.y) <= region.scale.y / 2 + radius) {
      return region;
    }
  }
  return presentation.scrollSurface;
}

function updateHands(xrFrame) {
  if (!xrFrame || !currentSession) return;
  const handSources = [...currentSession.inputSources].filter((inputSource) => inputSource.hand);
  let observedActiveHand = false;

  for (const inputSource of handSources) {
    const sample = localHandPoint(xrFrame, inputSource);
    if (!sample) {
      if (activeHandSource === inputSource) {
        pushEvents(drag.cancel("hand-tracking-lost"));
        activeHandSource = null;
      }
      continue;
    }

    const touching = directContact(sample.point, sample.radius);
    if (activeHandSource === inputSource) {
      observedActiveHand = true;
      if (touching) pushEvents(drag.move({ pointY: sample.point.y }));
      else {
        endActiveDrag();
        activeHandSource = null;
      }
      continue;
    }

    if (!activeHandSource && !activeXrController && drag.state === DRAG_STATES.NEUTRAL && touching) {
      const hit = directHit(sample.point, sample.radius);
      const itemId = hit.userData.kind === "hit-region" ? hit.userData.itemId : null;
      activeTargetDisabled = hit.userData.disabled === true;
      pushEvents(drag.begin({ source: "hand", pointY: sample.point.y, targetId: itemId, scrollOffset: presentation.viewport.scrollOffset, frame }));
      activeHandSource = inputSource;
      observedActiveHand = true;
    }
  }

  if (activeHandSource && !observedActiveHand) {
    pushEvents(drag.cancel("hand-source-removed"));
    activeHandSource = null;
  }
}

function stagePanelForXr(xrFrame) {
  if (!xrPlacementPending || !xrFrame) return;
  const referenceSpace = renderer.xr.getReferenceSpace();
  const viewerPose = referenceSpace ? xrFrame.getViewerPose(referenceSpace) : null;
  if (!viewerPose) return;
  const transform = viewerPose.transform;
  viewerPosition.set(transform.position.x, transform.position.y, transform.position.z);
  viewerQuaternion.set(transform.orientation.x, transform.orientation.y, transform.orientation.z, transform.orientation.w);
  viewerForward.set(0, 0, -1).applyQuaternion(viewerQuaternion);
  viewerDown.set(0, -1, 0).applyQuaternion(viewerQuaternion);
  attachmentHost.position.copy(viewerPosition).addScaledVector(viewerForward, .5).addScaledVector(viewerDown, .15);
  attachmentHost.quaternion.copy(viewerQuaternion);
  xrPlacementPending = false;
  recordEvent({ type: "xr-review-slab-staged", distance: .5, verticalOffset: -.15 });
}

function resize() {
  if (renderer.xr.isPresenting) return;
  const bounds = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(bounds.width));
  const height = Math.max(1, Math.round(bounds.height));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

window.addEventListener("resize", resize);
resize();

const geometryReadout = document.querySelector("#geometry-readout");
const resourceReadout = document.querySelector("#resource-readout");
const ownershipState = document.querySelector("#ownership-state");
const eventLog = document.querySelector("#event-log");
document.querySelector("#profile-name").textContent = `${profile.key} — ${profile.name}`;
document.querySelector("#switcher-label").textContent = `${profile.key} — ${profile.name}`;
document.querySelector("#switcher-dots").innerHTML = PROFILES.map((candidate) => `<i class="${candidate.key === profile.key ? "is-active" : ""}"></i>`).join("");
geometryReadout.innerHTML = `
  <div><dt>Panel</dt><dd>${millimetres(profile.panelWidth)} × ${millimetres(profile.panelHeight)} mm</dd></div>
  <div><dt>Viewport</dt><dd>${millimetres(profile.viewportWidth)} × ${millimetres(profile.viewportHeight)} mm</dd></div>
  <div><dt>Row / gap</dt><dd>${millimetres(profile.rowHeight)} / ${Math.round(profile.rowGap * 1000)} mm</dd></div>
  <div><dt>Hand drag</dt><dd>${millimetres(profile.handThreshold)} mm</dd></div>
  <div><dt>Controller drag</dt><dd>${millimetres(profile.controllerThreshold)} mm</dd></div>
`;

function telemetrySnapshot() {
  const rendererInfo = renderer.info;
  const timing = performanceSampler.snapshot();
  return {
    capturedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    xr: {
      presenting: renderer.xr.isPresenting,
      frameRate: currentSession?.frameRate ?? null,
      visibilityState: currentSession?.visibilityState ?? null,
      inputSources: currentSession ? [...currentSession.inputSources].map(describeInputSource) : [],
    },
    geometry: {
      panelMm: [millimetres(profile.panelWidth), millimetres(profile.panelHeight)],
      viewportMm: [millimetres(profile.viewportWidth), millimetres(profile.viewportHeight)],
      rowMm: millimetres(profile.rowHeight),
      handThresholdMm: millimetres(profile.handThreshold),
      controllerThresholdMm: millimetres(profile.controllerThreshold),
    },
    presentation: presentation.snapshot(),
    resourceEstimate: presentation.resourceEstimate(),
    renderer: {
      calls: rendererInfo.render.calls,
      triangles: rendererInfo.render.triangles,
      lines: rendererInfo.render.lines,
      geometries: rendererInfo.memory.geometries,
      textures: rendererInfo.memory.textures,
      programs: rendererInfo.programs?.length ?? 0,
    },
    updateMs: timing,
    recentEvents: eventTrace.slice(-12),
  };
}

function updateHud(time) {
  if (time - lastHudUpdate < 180) return;
  lastHudUpdate = time;
  const snapshot = telemetrySnapshot();
  const stateLabels = {
    [DRAG_STATES.NEUTRAL]: "Neutral Selection State",
    [DRAG_STATES.PENDING]: "Pending Selection Ownership",
    [DRAG_STATES.SCROLLING]: "Scroll Ownership",
    [DRAG_STATES.SETTLING]: "Settling · targets disabled",
  };
  ownershipState.textContent = stateLabels[drag.state];
  resourceReadout.innerHTML = `
    <div><dt>Pool / targets</dt><dd>${snapshot.presentation.activePoolSlots} / ${snapshot.presentation.activeHitRegions}</dd></div>
    <div><dt>Calls / triangles</dt><dd>${snapshot.renderer.calls} / ${snapshot.renderer.triangles}</dd></div>
    <div><dt>Geometries / textures</dt><dd>${snapshot.renderer.geometries} / ${snapshot.renderer.textures}</dd></div>
    <div><dt>Programs</dt><dd>${snapshot.renderer.programs}</dd></div>
    <div><dt>Atlas GPU estimate</dt><dd>${(snapshot.resourceEstimate.atlasBytes / 1048576).toFixed(1)} MiB</dd></div>
    <div><dt>Update p95</dt><dd>${snapshot.updateMs.p95.toFixed(3)} ms</dd></div>
    <div><dt>Atlas uploads</dt><dd>${snapshot.presentation.atlasUploads}</dd></div>
  `;
  eventLog.innerHTML = snapshot.recentEvents.slice(-5).reverse().map((event) => `<li>${event.type.replaceAll("-", " ")}</li>`).join("");
}

function animate(time, xrFrame) {
  frame += 1;
  pushEvents(drag.advance(frame));
  stagePanelForXr(xrFrame);
  if (activeXrController) moveFromRay(controllerRayFrom(activeXrController));
  updateHands(xrFrame);
  const updateStart = performance.now();
  presentation.update(frame);
  performanceSampler.record(performance.now() - updateStart);
  renderer.render(scene, camera);
  updateHud(time);
  if (currentSession && time - lastVrTelemetryAt >= 5000) {
    lastVrTelemetryAt = time;
    vrTestLogger?.record("prototype.telemetry", telemetrySnapshot());
  }
}

renderer.setAnimationLoop(animate);

function cycleProfile(direction) {
  const current = PROFILES.findIndex((candidate) => candidate.key === profile.key);
  const next = PROFILES[(current + direction + PROFILES.length) % PROFILES.length];
  recordEvent({ type: "profile-switch-requested", from: profile.key, to: next.key });
  const url = new URL(window.location.href);
  url.searchParams.set("variant", next.key);
  window.location.assign(url);
}

document.querySelector("#prototype-switcher").addEventListener("click", (event) => {
  const button = event.target.closest("[data-cycle]");
  if (button) cycleProfile(Number(button.dataset.cycle));
});

window.addEventListener("keydown", (event) => {
  if (["INPUT", "TEXTAREA"].includes(event.target.tagName) || event.target.isContentEditable) return;
  if (event.key === "ArrowLeft") cycleProfile(-1);
  if (event.key === "ArrowRight") cycleProfile(1);
});

for (const button of document.querySelectorAll("[data-source]")) {
  button.addEventListener("click", () => {
    selectionSource = button.dataset.source;
    for (const candidate of document.querySelectorAll("[data-source]")) candidate.setAttribute("aria-pressed", String(candidate === button));
    recordEvent({ type: "desktop-source-changed", source: selectionSource });
  });
}

const debugButton = document.querySelector("#debug-toggle");
debugButton.setAttribute("aria-pressed", String(debugVisible));
debugButton.addEventListener("click", () => {
  debugVisible = !debugVisible;
  debugButton.setAttribute("aria-pressed", String(debugVisible));
  presentation.setDebugVisible(debugVisible);
});

document.querySelector("#evidence-copy").addEventListener("click", async () => {
  await navigator.clipboard.writeText(JSON.stringify(telemetrySnapshot(), null, 2));
  recordEvent({ type: "telemetry-copied" });
});

const enterXrButton = document.querySelector("#enter-xr");
const xrSupported = navigator.xr ? await navigator.xr.isSessionSupported("immersive-vr") : false;
enterXrButton.disabled = !xrSupported;
enterXrButton.textContent = xrSupported ? "Enter XR" : "XR unavailable";
enterXrButton.addEventListener("click", async () => {
  if (currentSession) {
    await currentSession.end();
    return;
  }
  const session = await navigator.xr.requestSession("immersive-vr", {
    requiredFeatures: ["local-floor"],
    optionalFeatures: ["hand-tracking"],
  });
  currentSession = session;
  xrPlacementPending = true;
  recordEvent({
    type: "xr-session-started",
    frameRate: session.frameRate ?? null,
    visibilityState: session.visibilityState ?? null,
    inputSources: [...session.inputSources].map(describeInputSource),
  });
  session.addEventListener("inputsourceschange", (event) => {
    recordEvent({
      type: "xr-input-sources-changed",
      added: [...event.added].map(describeInputSource),
      removed: [...event.removed].map(describeInputSource),
    });
  });
  session.addEventListener("end", () => {
    recordEvent({ type: "xr-session-ended", telemetry: telemetrySnapshot() });
    currentSession = null;
    xrPlacementPending = false;
    attachmentHost.position.set(0, 1.37, -.55);
    attachmentHost.quaternion.identity();
    enterXrButton.textContent = "Enter XR";
    pushEvents(drag.cancel("session-ended"));
    activeXrController = null;
    activeHandSource = null;
    window.requestAnimationFrame(resize);
  }, { once: true });
  enterXrButton.textContent = "End XR";
  await renderer.xr.setSession(session);
});

function clientPointForPanelMm(xMm, yMm) {
  presentation.root.updateMatrixWorld(true);
  const point = new THREE.Vector3(Number(xMm) / 1000, Number(yMm) / 1000, .012)
    .applyMatrix4(presentation.root.matrixWorld)
    .project(camera);
  const bounds = canvas.getBoundingClientRect();
  return {
    x: bounds.left + (point.x + 1) * bounds.width / 2,
    y: bounds.top + (1 - point.y) * bounds.height / 2,
  };
}

window.__WRIST_MENU_PROTOTYPE__ = Object.freeze({
  testSessionId: vrTestLogger?.sessionId ?? null,
  snapshot: telemetrySnapshot,
  runDeterministicTrace: generateTraceEvidence,
  recentEvents() { return eventTrace.slice(); },
  clearEvents() { eventTrace.length = 0; },
  clientPointForPanelMm,
  revealItem(itemId) {
    const entry = presentation.viewport.layout.entries.find((candidate) => candidate.item.id === itemId);
    if (!entry) throw new Error(`unknown item: ${itemId}`);
    presentation.setScroll(entry.top);
    const y = presentation.viewportTop - (entry.top - presentation.viewport.scrollOffset) - entry.height / 2;
    return clientPointForPanelMm(0, y * 1000);
  },
  setScrollMm(value) { presentation.setScroll(Number(value) / 1000); return presentation.snapshot(); },
  setSource(value) {
    if (!["controller", "hand"].includes(value)) throw new Error("source must be controller or hand");
    selectionSource = value;
    return selectionSource;
  },
});

document.body.dataset.prototypeReady = "true";
vrTestLogger?.record("prototype.ready", telemetrySnapshot());
window.dispatchEvent(new CustomEvent("wrist-menu-prototype-ready"));
