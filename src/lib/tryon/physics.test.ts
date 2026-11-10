import test from "node:test";
import assert from "node:assert/strict";
import { frameDeltaSeconds, stepPendulum, trackingBlend } from "./physics.ts";

test("uses a 60 FPS initial timestep", () => {
  assert.equal(frameDeltaSeconds(100, null), 1 / 60);
});

test("converts elapsed milliseconds into seconds", () => {
  assert.equal(frameDeltaSeconds(1016.6667, 1000), (1016.6667 - 1000) / 1000);
});

test("clamps long stalls to one 30 FPS step", () => {
  assert.equal(frameDeltaSeconds(5000, 1000), 1 / 30);
});

test("clamps very short frame deltas to a stable minimum", () => {
  assert.equal(frameDeltaSeconds(1001, 1000), 1 / 240);
});

test("handles invalid and backwards timestamps safely", () => {
  assert.equal(frameDeltaSeconds(1000, 1000), 1 / 60);
  assert.equal(frameDeltaSeconds(Number.NaN, 1000), 1 / 60);
});

test("pendulum remains finite at common frame rates", () => {
  for (const dt of [1 / 30, 1 / 60, 1 / 120]) {
    const result = stepPendulum(0.2, 0.1, 0.03, dt);
    assert.ok(Number.isFinite(result.swing));
    assert.ok(Number.isFinite(result.vel));
  }
});


test("tracking blend is stable and increases with response rate", () => {
  const slow = trackingBlend(1 / 60, 6);
  const fast = trackingBlend(1 / 60, 18);
  assert.ok(slow > 0 && slow < 1);
  assert.ok(fast > slow && fast < 1);
});

test("tracking blend is frame-rate consistent over equal elapsed time", () => {
  const at30 = 1 - Math.pow(1 - trackingBlend(1 / 30, 12), 1);
  const at60 = 1 - Math.pow(1 - trackingBlend(1 / 60, 12), 2);
  assert.ok(Math.abs(at30 - at60) < 1e-10);
});
