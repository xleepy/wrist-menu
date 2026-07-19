import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_PROFILE_KEY, getProfile, PROFILES } from "../src/config.js";
import { aspectMatchedAtlasRegion, atlasFontPixels, TYPOGRAPHY_MM } from "../src/presentation/atlas.js";

test("Reach is the fallback while explicit comparison profiles remain addressable", () => {
  assert.equal(DEFAULT_PROFILE_KEY, "B");
  assert.equal(getProfile().key, "B");
  assert.equal(getProfile("unknown").key, "B");
  assert.equal(getProfile("A").key, "A");
  assert.equal(getProfile("C").key, "C");
});

test("atlas regions preserve the physical quad aspect ratio", () => {
  const profile = getProfile("B");
  const separator = aspectMatchedAtlasRegion(192, 128, profile.viewportWidth, profile.separatorHeight);
  const footer = aspectMatchedAtlasRegion(1728, 64, profile.viewportWidth, .0065);

  assert.ok(separator.top > 192);
  assert.ok(separator.top + separator.height < 192 + 128);
  assert.ok(footer.top > 1728);
  assert.ok(footer.top + footer.height < 1728 + 64);
  assert.ok(Math.abs(separator.height / 1024 - profile.separatorHeight / profile.viewportWidth) < 1e-12);
  assert.ok(Math.abs(footer.height / 1024 - .0065 / profile.viewportWidth) < 1e-12);
});

test("small structural and secondary type stays near its physical typography token", () => {
  for (const profile of PROFILES) {
    const pixels = atlasFontPixels(profile, TYPOGRAPHY_MM.meta);
    const physicalMillimetres = pixels * profile.viewportWidth / 1024 * 1000;
    assert.ok(physicalMillimetres >= 4.5 && physicalMillimetres <= 5, `${profile.key}: ${physicalMillimetres} mm`);
  }
});
