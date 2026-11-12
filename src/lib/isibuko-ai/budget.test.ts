import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FrameBudgetMonitor } from "./budget.ts";

describe("frame budget telemetry", () => {
  it("records frame interval, work time and rolling statistics without changing quality", () => {
    const budget = new FrameBudgetMonitor({ windowSize: 4 });
    budget.observe(16.7, 4.2);
    const snapshot = budget.observe(20, 5);

    assert.equal(snapshot.frameIntervalMs, 20);
    assert.equal(snapshot.frameWorkMs, 5);
    assert.equal(snapshot.meanFrameIntervalMs, 18.4);
    assert.equal(snapshot.meanFrameWorkMs, 4.6);
    assert.equal(snapshot.rung, 0);
    assert.equal(snapshot.reason, "measurement-only");
    assert.equal(snapshot.jankFrames, 0);
  });

  it("counts intervals over the diagnostic jank threshold and tracks the longest gap", () => {
    const budget = new FrameBudgetMonitor({ jankThresholdMs: 50 });
    budget.observe(16, 3);
    budget.observe(51, 4);
    const snapshot = budget.observe(83.3, 6);

    assert.equal(snapshot.jankFrames, 2);
    assert.equal(snapshot.longestFrameMs, 83.3);
    assert.equal(snapshot.p95FrameIntervalMs, 83.3);
  });

  it("keeps rolling statistics bounded to the configured window", () => {
    const budget = new FrameBudgetMonitor({ windowSize: 4 });
    [10, 20, 30, 40, 100].forEach((interval) => budget.observe(interval, 2));

    const snapshot = budget.snapshot();
    assert.equal(snapshot.sampleCount, 5);
    assert.equal(snapshot.meanFrameIntervalMs, 47.5);
    assert.equal(snapshot.p95FrameIntervalMs, 100);
    assert.equal(snapshot.longestFrameMs, 100);
  });

  it("sanitises invalid measurements and resets session statistics", () => {
    const budget = new FrameBudgetMonitor();
    const invalid = budget.observe(Number.NaN, Number.POSITIVE_INFINITY);
    assert.equal(invalid.frameIntervalMs, 0);
    assert.equal(invalid.frameWorkMs, 0);
    assert.equal(invalid.sampleCount, 0);

    budget.observe(60, 8);
    budget.reset();
    const reset = budget.snapshot();
    assert.equal(reset.sampleCount, 0);
    assert.equal(reset.jankFrames, 0);
    assert.equal(reset.longestFrameMs, 0);
    assert.equal(reset.meanFrameIntervalMs, 0);
  });
});
