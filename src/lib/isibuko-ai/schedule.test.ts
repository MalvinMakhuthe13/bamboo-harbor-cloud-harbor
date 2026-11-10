import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FULL_FRAME,
  cadenceMs,
  due,
  inferenceEdge,
  isFullFrame,
  maskIsFresh,
  pixelCrop,
  remapPoint,
  roiFromPoints,
  shouldRefreshFull,
} from "./schedule.ts";

describe("tracker schedule", () => {
  it("runs pose more often than hands for a shirt, and slows segmentation after a slow pass", () => {
    const fast = cadenceMs("shirt", 200);
    const slow = cadenceMs("shirt", 800);
    assert.ok(fast.pose < fast.hands);
    assert.ok(fast.face > 0);
    assert.ok(slow.segment > fast.segment);
    assert.equal(inferenceEdge("pose", 900, false), 192);
    assert.equal(inferenceEdge("segment", 800, false), 128);
    assert.equal(inferenceEdge("segment", 100, false), 160);
  });

  it("holds one in-flight job and reuses a fresh mask", () => {
    assert.equal(due(1000, 900, 160, true), false);
    assert.equal(due(1000, 900, 160, false), false);
    assert.equal(due(1100, 900, 160, false), true);
    assert.equal(maskIsFresh(500, 400, 320), true);
    assert.equal(maskIsFresh(800, 400, 320), false);
    assert.equal(shouldRefreshFull(4, 4), true);
    assert.equal(shouldRefreshFull(3, 4), false);
  });

  it("maps a cropped landmark back into the full frame", () => {
    const roi = roiFromPoints(
      [
        { x: 0.4, y: 0.2 },
        { x: 0.6, y: 0.5 },
      ],
      0,
    );
    assert.ok(roi);
    if (!roi) return;
    assert.equal(isFullFrame(roi), false);
    const origin = remapPoint({ x: 0, y: 0, z: 1 }, roi);
    const far = remapPoint({ x: 1, y: 1 }, roi);
    assert.ok(Math.abs(origin.x - roi.x) < 1e-6);
    assert.ok(Math.abs(origin.y - roi.y) < 1e-6);
    assert.equal(origin.z, 1);
    assert.ok(Math.abs(far.x - (roi.x + roi.w)) < 1e-6);
    const full = remapPoint({ x: 0.25, y: 0.5 }, FULL_FRAME);
    assert.equal(full.x, 0.25);
    const crop = pixelCrop(roi, 1000, 800);
    assert.ok(crop.sw >= 2 && crop.sh >= 2);
    assert.ok(crop.sx >= 0 && crop.sy >= 0);
  });

  it("does not crop a person who already fills the frame", () => {
    assert.equal(
      roiFromPoints(
        [
          { x: 0.02, y: 0.02 },
          { x: 0.97, y: 0.96 },
        ],
        0.1,
      ),
      null,
    );
  });
});
