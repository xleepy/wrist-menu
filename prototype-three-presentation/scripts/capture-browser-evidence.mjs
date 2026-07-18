import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import { generateTraceEvidence } from "./trace-scenarios.mjs";

const browserCandidates = [
  process.env.WRIST_MENU_BROWSER,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].filter(Boolean);
const executablePath = browserCandidates.find((candidate) => existsSync(candidate));
if (!executablePath) throw new Error("Set WRIST_MENU_BROWSER to an installed Chromium executable");

const evidenceDirectory = path.resolve(import.meta.dirname, "..", "evidence");
const screenshotDirectory = path.join(evidenceDirectory, "screenshots");
await mkdir(screenshotDirectory, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath,
  args: ["--enable-webgl", "--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const consoleMessages = [];
const pageErrors = [];
page.on("console", (message) => consoleMessages.push({ type: message.type(), text: message.text() }));
page.on("pageerror", (error) => pageErrors.push(error.message));

const profiles = [];
const profileNames = { A: "balanced", B: "reach", C: "compact" };
for (const key of ["A", "B", "C"]) {
  await page.goto(`http://127.0.0.1:4173/prototype/three-presentation?variant=${key}`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.body.dataset.prototypeReady === "true");
  await page.waitForTimeout(450);
  const snapshot = await page.evaluate(() => window.__WRIST_MENU_PROTOTYPE__.snapshot());
  assert.equal(snapshot.presentation.profile, key);
  assert.ok(snapshot.renderer.calls >= 4, `profile ${key} should render the Three.js slab`);
  assert.equal(snapshot.resourceEstimate.atlasTextures, 1);
  assert.equal(snapshot.resourceEstimate.atlasBytes, 8_388_608);
  profiles.push(snapshot);
  await page.screenshot({ path: path.join(screenshotDirectory, `variant-${key.toLowerCase()}-${profileNames[key]}.png`), fullPage: true });
}

await page.goto("http://127.0.0.1:4173/prototype/three-presentation?variant=A", { waitUntil: "networkidle" });
await page.waitForFunction(() => document.body.dataset.prototypeReady === "true");
await page.evaluate(() => { window.__WRIST_MENU_PROTOTYPE__.setScrollMm(0); window.__WRIST_MENU_PROTOTYPE__.clearEvents(); });
const closeupTopLeft = await page.evaluate(() => window.__WRIST_MENU_PROTOTYPE__.clientPointForPanelMm(-100, 82));
const closeupBottomRight = await page.evaluate(() => window.__WRIST_MENU_PROTOTYPE__.clientPointForPanelMm(100, -86));
await page.screenshot({
  path: path.join(screenshotDirectory, "variant-a-balanced-closeup.png"),
  clip: {
    x: Math.max(0, closeupTopLeft.x),
    y: Math.max(0, closeupTopLeft.y),
    width: closeupBottomRight.x - closeupTopLeft.x,
    height: closeupBottomRight.y - closeupTopLeft.y,
  },
});
const tapPoint = await page.evaluate(() => window.__WRIST_MENU_PROTOTYPE__.clientPointForPanelMm(0, 26));
await page.mouse.click(tapPoint.x, tapPoint.y);
await page.waitForTimeout(50);
const tapEvents = await page.evaluate(() => window.__WRIST_MENU_PROTOTYPE__.recentEvents());
assert.ok(tapEvents.some((event) => event.type === "selection-commit"), "an under-threshold controller proxy tap should commit");

await page.evaluate(() => window.__WRIST_MENU_PROTOTYPE__.clearEvents());
const dragStart = await page.evaluate(() => window.__WRIST_MENU_PROTOTYPE__.clientPointForPanelMm(0, 26));
const dragEnd = await page.evaluate(() => window.__WRIST_MENU_PROTOTYPE__.clientPointForPanelMm(0, 46));
await page.mouse.move(dragStart.x, dragStart.y);
await page.mouse.down();
await page.mouse.move(dragEnd.x, dragEnd.y, { steps: 4 });
await page.mouse.up();
await page.waitForFunction(() => window.__WRIST_MENU_PROTOTYPE__.recentEvents().some((event) => event.type === "targets-rearmed"));
const dragEvents = await page.evaluate(() => window.__WRIST_MENU_PROTOTYPE__.recentEvents());
assert.ok(dragEvents.some((event) => event.type === "scroll-ownership-acquired"), "a 20 mm controller proxy drag should acquire Scroll Ownership");
assert.ok(dragEvents.some((event) => event.type === "selection-cancelled" && event.reason === "scroll-threshold"));
assert.ok(!dragEvents.some((event) => event.type === "selection-commit"));
assert.ok(dragEvents.some((event) => event.type === "targets-rearmed"));
const postInteractionSnapshot = await page.evaluate(() => window.__WRIST_MENU_PROTOTYPE__.snapshot());
assert.ok(postInteractionSnapshot.presentation.atlasUploads <= 3, "continuous motion should not upload the full atlas on every pointer step");

const disabledPoint = await page.evaluate(() => {
  window.__WRIST_MENU_PROTOTYPE__.clearEvents();
  return window.__WRIST_MENU_PROTOTYPE__.revealItem("clear-selection");
});
await page.waitForFunction(() => window.__WRIST_MENU_PROTOTYPE__.snapshot().presentation.targetable === true);
await page.mouse.click(disabledPoint.x, disabledPoint.y);
await page.waitForTimeout(50);
const disabledEvents = await page.evaluate(() => window.__WRIST_MENU_PROTOTYPE__.recentEvents());
assert.ok(disabledEvents.some((event) => event.type === "unavailable-feedback"));
assert.ok(!disabledEvents.some((event) => event.type === "selection-commit"));

const browserTrace = await page.evaluate(() => window.__WRIST_MENU_PROTOTYPE__.runDeterministicTrace());
assert.deepEqual(browserTrace, generateTraceEvidence());

await page.click("#debug-toggle");
await page.waitForTimeout(50);
await page.screenshot({ path: path.join(screenshotDirectory, "variant-a-hit-regions.png"), fullPage: true });

const resources = await page.evaluate(() => performance.getEntriesByType("resource").map((entry) => entry.name));
const unexpectedOrigins = resources.filter((url) => url.startsWith("http") && !url.startsWith("http://127.0.0.1:4173/"));
const fontRequests = resources.filter((url) => /\.woff2?(?:\?|$)/i.test(url));
assert.deepEqual(unexpectedOrigins, [], "the self-contained prototype should make no external network requests");
assert.deepEqual(fontRequests, [], "the bundled WOFF2 data URLs should make no font requests");
assert.deepEqual(pageErrors, []);
assert.deepEqual(consoleMessages.filter((message) => message.type === "error"), []);

await page.goto("http://127.0.0.1:4173/prototype/three-presentation?variant=A&iwer=1", { waitUntil: "networkidle" });
await page.waitForFunction(() => document.body.dataset.prototypeReady === "true");
const iwerProbe = await page.evaluate(async () => ({
  immersiveVr: await navigator.xr.isSessionSupported("immersive-vr"),
  userAgent: navigator.userAgent,
}));
assert.equal(iwerProbe.immersiveVr, true);
assert.match(iwerProbe.userAgent, /Quest 2/);
await page.click("#enter-xr");
await page.waitForFunction(() => window.__WRIST_MENU_PROTOTYPE__.snapshot().xr.presenting === true);
await page.waitForFunction(() => window.__WRIST_MENU_PROTOTYPE__.recentEvents().some((event) => event.type === "xr-review-slab-staged"));
const iwerSessionSnapshot = await page.evaluate(() => window.__WRIST_MENU_PROTOTYPE__.snapshot());
assert.equal(iwerSessionSnapshot.xr.presenting, true);
await page.evaluate(() => document.querySelector("#enter-xr").click());
await page.waitForFunction(() => window.__WRIST_MENU_PROTOTYPE__.snapshot().xr.presenting === false);
assert.deepEqual(pageErrors, []);
assert.deepEqual(consoleMessages.filter((message) => message.type === "error"), []);

const finalSnapshot = await page.evaluate(() => window.__WRIST_MENU_PROTOTYPE__.snapshot());
const evidence = {
  schema: "wrist-menu-three-presentation-browser-evidence/v1",
  browserExecutable: executablePath,
  profiles,
  actualDesktopInteraction: { tapEvents, dragEvents, disabledEvents, postInteractionSnapshot },
  deterministicTrace: browserTrace,
  iwerProbe,
  iwerSessionSnapshot,
  finalSnapshot,
  resourceUrls: resources,
  consoleMessages,
  pageErrors,
};
await writeFile(path.join(evidenceDirectory, "browser-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
await browser.close();
process.stdout.write(`${JSON.stringify({ screenshots: 5, profiles: profiles.map((item) => item.presentation.profile), finalRenderer: finalSnapshot.renderer, pageErrors }, null, 2)}\n`);
