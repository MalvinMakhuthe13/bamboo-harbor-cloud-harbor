import test from "node:test";
import assert from "node:assert/strict";
import { analyzeMotionSamples } from "./motion-analysis.ts";
import type { MotionSample } from "./motion-analysis.ts";

function sample(timestampMs: number, yaw: number, x: number, confidence = 0.9): MotionSample {
  return { timestampMs, headYawRad: yaw, productOffsetX: x, productOffsetY: 0, confidence };
}

test("rejects too few or low-confidence tracking samples", () => {
  const result = analyzeMotionSamples([
    sample(0, 0, 0),
    sample(100, 0.1, 0.02, 0.2),
    sample(200, 0.2, 0.04),
  ]);
  assert.equal(result.quality, "insufficient");
  assert.equal(result.sampleCount, 2);
  assert.equal(result.responsePerRadian, null);
});

test("measures relative product movement against wearer yaw", () => {
  const result = analyzeMotionSamples([
    sample(0, 0, 0),
    sample(100, 0.02, 0),
    sample(200, 0.04, 0),
    sample(300, 0.2, 0.04),
    sample(400, 0.4, 0.08),
    sample(500, 0.6, 0.1),
    sample(600, 0.7, 0.1),
  ]);
  assert.equal(result.sampleCount, 7);
  assert.equal(result.durationMs, 600);
  assert.ok(result.headTurnRangeRad > 0.6);
  assert.ok(result.peakRelativeDisplacement >= 0.09);
  assert.ok(result.responsePerRadian !== null && result.responsePerRadian > 0);
  assert.ok(["usable", "strong"].includes(result.quality));
});

test("ignores non-finite samples and sorts timestamps", () => {
  const result = analyzeMotionSamples([
    sample(300, 0.3, 0.03),
    sample(0, 0, 0),
    sample(100, 0.1, 0.01),
    sample(200, Number.NaN, 0.02),
    sample(400, 0.4, 0.04),
    sample(500, 0.5, 0.05),
  ]);
  assert.equal(result.sampleCount, 5);
  assert.equal(result.durationMs, 500);
});

test("reports observed settling only when final motion returns near baseline", () => {
  const result = analyzeMotionSamples([
    sample(0, 0, 0),
    sample(100, 0.1, 0),
    sample(200, 0.2, 0.1),
    sample(300, 0.2, 0.07),
    sample(400, 0.1, 0.01),
    sample(500, 0, 0),
  ]);
  assert.equal(result.settleTimeMs, 400);
});
