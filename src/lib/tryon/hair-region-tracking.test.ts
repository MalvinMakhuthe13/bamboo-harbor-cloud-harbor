import test from "node:test";
import assert from "node:assert/strict";
import { analyzeHairMotionProxy, buildRelativeHairTrack, summarizeRelativeHairTrack } from "./hair-region-tracking.ts";
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
    timestampMs, width: 256, height: 256, hairDetected: true,
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

test("propagates a selected hair region through nearby later masks", async () => {
  const { trackSeededHairForward } = await import("./hair-region-tracking.ts");
  const makeMask = (cx: number) => {
    const mask = new Uint8Array(100);
    mask[4 * 10 + cx] = 1;
    mask[4 * 10 + cx + 1] = 1;
    mask[5 * 10 + cx] = 1;
    return mask;
  };
  const track = trackSeededHairForward([
    { timestampMs: 0, categories: makeMask(4), width: 10, height: 10 },
    { timestampMs: 500, categories: makeMask(5), width: 10, height: 10 },
    { timestampMs: 1000, categories: makeMask(6), width: 10, height: 10 },
  ], 0, { x: 0.45, y: 0.45, radius: 0.2 }, 0.3);
  assert.equal(track.length, 3);
  assert.ok(track.every((point) => point.tracked));
  assert.ok(track[2].region.center!.x > track[0].region.center!.x);
});

test("retains last seed when a later frame loses the selected region", async () => {
  const { trackSeededHairForward } = await import("./hair-region-tracking.ts");
  const empty = new Uint8Array(100);
  const track = trackSeededHairForward([
    { timestampMs: 0, categories: regionMask(), width: 10, height: 10 },
    { timestampMs: 500, categories: empty, width: 10, height: 10 },
  ], 0, { x: 0.45, y: 0.45, radius: 0.2 }, 0.2);
  assert.equal(track[0].tracked, true);
  assert.equal(track[1].tracked, false);
});
function regionMask() {
  const mask = new Uint8Array(100);
  mask[4 * 10 + 4] = 1;
  mask[4 * 10 + 5] = 1;
  mask[5 * 10 + 4] = 1;
  return mask;
}


test("tracks both before and after the selected frame in chronological order", async () => {
  const { trackSeededHairBidirectional } = await import("./hair-region-tracking.ts");
  const makeMask = (cx: number) => {
    const mask = new Uint8Array(100);
    mask[4 * 10 + cx] = 1;
    mask[4 * 10 + cx + 1] = 1;
    mask[5 * 10 + cx] = 1;
    return mask;
  };
  const frames = [4, 5, 6, 7].map((cx, index) => ({
    timestampMs: index * 500, categories: makeMask(cx), width: 10, height: 10,
  }));
  const track = trackSeededHairBidirectional(frames, 2, { x: 0.65, y: 0.45, radius: 0.2 }, 0.3);
  assert.deepEqual(track.map((point) => point.timestampMs), [0, 500, 1000, 1500]);
  assert.equal(track.length, 4);
  assert.ok(track.every((point) => point.tracked));
  assert.ok(track[0].region.center!.x < track[3].region.center!.x);
});

test("rejects an invalid bidirectional start index", async () => {
  const { trackSeededHairBidirectional } = await import("./hair-region-tracking.ts");
  assert.throws(() => trackSeededHairBidirectional([], 0, { x: 0.5, y: 0.5, radius: 0.2 }));
});


test("isolates the clicked connected hair component from nearby disconnected hair", async () => {
  const { selectSeededHairRegion } = await import("./hair-region-tracking.ts");
  const mask = new Uint8Array(100);
  // First connected component.
  mask[4 * 10 + 4] = 1;
  mask[4 * 10 + 5] = 1;
  mask[5 * 10 + 4] = 1;
  // A separate component, still inside the search radius.
  mask[4 * 10 + 7] = 1;
  mask[5 * 10 + 7] = 1;
  const selected = selectSeededHairRegion(mask, 10, 10, { x: 0.45, y: 0.45, radius: 0.4 });
  assert.equal(selected.pixels, 3);
  assert.deepEqual(selected.bounds, { left: 0.4, top: 0.4, right: 0.6, bottom: 0.6 });
});

test("selects the nearest connected hair component when click is slightly off-mask", async () => {
  const { selectSeededHairRegion } = await import("./hair-region-tracking.ts");
  const mask = new Uint8Array(100);
  mask[4 * 10 + 4] = 1;
  mask[4 * 10 + 5] = 1;
  const selected = selectSeededHairRegion(mask, 10, 10, { x: 0.35, y: 0.45, radius: 0.2 });
  assert.equal(selected.pixels, 2);
});


test("predicts motion and recovers after a temporarily missing mask", async () => {
  const { trackSeededHairForward } = await import("./hair-region-tracking.ts");
  const makeMask = (cx: number) => {
    const mask = new Uint8Array(100);
    mask[4 * 10 + cx] = 1;
    mask[4 * 10 + cx + 1] = 1;
    mask[5 * 10 + cx] = 1;
    return mask;
  };
  const frames = [
    { timestampMs: 0, categories: makeMask(2), width: 10, height: 10 },
    { timestampMs: 500, categories: makeMask(3), width: 10, height: 10 },
    { timestampMs: 1000, categories: new Uint8Array(100), width: 10, height: 10 },
    { timestampMs: 1500, categories: makeMask(5), width: 10, height: 10 },
  ];
  const track = trackSeededHairForward(frames, 0, { x: 0.35, y: 0.45, radius: 0.15 }, 0.15);
  assert.equal(track[0].tracked, true);
  assert.equal(track[1].tracked, true);
  assert.equal(track[2].tracked, false);
  assert.equal(track[3].tracked, true);
  assert.equal(track[3].recovered, true);
});

test("marks ordinary detections as not recovered", async () => {
  const { trackSeededHairForward } = await import("./hair-region-tracking.ts");
  const track = trackSeededHairForward([
    { timestampMs: 0, categories: regionMask(), width: 10, height: 10 },
  ], 0, { x: 0.45, y: 0.45, radius: 0.2 });
  assert.equal(track[0].recovered, false);
});


test("joins segmentation and wearer samples by timestamp when arrays are offset", () => {
  const track = buildRelativeHairTrack(
    [wearer(0), wearer(500), wearer(1000)],
    [region(500, 0.6), region(1000, 0.7)],
  );
  assert.deepEqual(track.map((item) => item.timestampMs), [500, 1000]);
});

test("summarises hair response against yaw proxy without treating it as radians", () => {
  const yaw = [0, 0.1, 0.3, 0.4, 0.2, 0];
  const offsets = [0, 0.01, 0.04, 0.1, 0.2, 0.25];
  const wearerSamples = yaw.map((value, index) => ({
    ...wearer(index * 500),
    headYawProxy: value,
  }));
  const hairTrack = offsets.map((value, index) => ({
    timestampMs: index * 500, offsetX: value, offsetY: 0,
    width: 1, height: 1, confidence: 0.9,
  }));
  const summary = analyzeHairMotionProxy(wearerSamples, hairTrack);
  assert.equal(summary.sampleCount, 6);
  assert.equal(summary.headYawProxyRange, 0.4);
  assert.equal(summary.peakDisplacementAtMs, 2500);
  assert.equal(summary.responseLagMs, 1000);
  assert.equal(summary.quality, "insufficient");
});

test("requires enough timestamp-paired confident samples for motion diagnostics", () => {
  const summary = analyzeHairMotionProxy([wearer(0)], []);
  assert.equal(summary.quality, "insufficient");
  assert.equal(summary.responseLagMs, null);
});

test("rejects invalid confidence thresholds for hair motion diagnostics", () => {
  assert.throws(() => analyzeHairMotionProxy([], [], 1.5), /Minimum confidence/);
});
