import test from "node:test";
import assert from "node:assert/strict";
import { buildRelativeHairTrack, summarizeRelativeHairTrack } from "./hair-region-tracking.ts";
import type { WearerTrackingSample } from "./wearer-tracking.ts";
import type { ProductSegmentationSample } from "./product-segmentation.ts";

function wearer(timestampMs: number, faceDetected = true): WearerTrackingSample {
  return {
    timestampMs, faceDetected, faceConfidence: faceDetected ? 1 : 0,
    headCenterX: faceDetected ? 0.5 : null, headCenterY: faceDetected ? 0.35 : null,
    headWidth: faceDetected ? 0.2 : null, headYawProxy: 0,
    shouldersDetected: false, shoulderCenterX: null, shoulderCenterY: null, shoulderSpan: null,
  };
}
function region(timestampMs: number, centerX: number): ProductSegmentationSample {
  const left = centerX - 0.1;
  const right = centerX + 0.1;
  return {
    width: 256, height: 256, hairDetected: true,
    hair: { pixels: 1000, ratio: 0.02, bounds: { left, right, top: 0.1, bottom: 0.5 }, center: { x: centerX, y: 0.3 } },
    faceSkin: { pixels: 0, ratio: 0, bounds: null, center: null },
    clothes: { pixels: 0, ratio: 0, bounds: null, center: null },
  };
}

test("normalises hair region against face size and smooths frame-to-frame jitter", () => {
  const track = buildRelativeHairTrack(
    [wearer(0), wearer(500), wearer(1000)],
    [region(0, 0.5), region(500, 0.7), region(1000, 0.5)],
  );
  assert.equal(track.length, 3);
  assert.equal(track[0].offsetX, 0);
  assert.ok(track[1].offsetX > 0 && track[1].offsetX < 1);
  assert.ok(track[2].offsetX > 0);
  assert.equal(track[0].width, 1);
  assert.equal(summarizeRelativeHairTrack(track).sampleCount, 3);
});

test("skips missing face and missing hair observations", () => {
  const missingHair = { ...region(500, 0.5), hairDetected: false };
  const track = buildRelativeHairTrack(
    [wearer(0), wearer(500, false), wearer(1000)],
    [region(0, 0.5), region(500, 0.5), missingHair],
  );
  assert.equal(track.length, 1);
});

test("resets smoothing after a long gap and validates options", () => {
  const track = buildRelativeHairTrack(
    [wearer(0), wearer(3000)],
    [region(0, 0.5), region(3000, 0.7)],
  );
  assert.equal(track[1].offsetX, 1);
  assert.throws(() => buildRelativeHairTrack([], [], { smoothing: 0 }));
});

test("refines a hair mask around a merchant seed point", async () => {
  const { selectSeededHairRegion } = await import("./hair-region-tracking.ts");
  const mask = new Uint8Array(100);
  mask[4 * 10 + 4] = 1;
  mask[4 * 10 + 5] = 1;
  mask[5 * 10 + 4] = 1;
  mask[8 * 10 + 8] = 1;
  const selected = selectSeededHairRegion(mask, 10, 10, { x: 0.45, y: 0.45, radius: 0.2 });
  assert.equal(selected.pixels, 3);
  assert.deepEqual(selected.bounds, { left: 0.4, top: 0.4, right: 0.6, bottom: 0.6 });
  assert.equal(selected.center?.x, 0.5);
});

test("rejects invalid merchant seed coordinates", async () => {
  const { selectSeededHairRegion } = await import("./hair-region-tracking.ts");
  assert.throws(() => selectSeededHairRegion(new Uint8Array(4), 2, 2, { x: 2, y: 0.5, radius: 0.2 }));
});
