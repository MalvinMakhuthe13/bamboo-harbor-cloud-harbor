import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LiveTrack } from "./live-track.ts";
import { nextLiveAction } from "./live-schedule.ts";

const note = {
  pose: true,
  fps: 8,
  compositeMs: 1,
  receipt: null,
};

describe("live camera track", () => {
  it("keeps one session across a product change and does not call a still a generated frame", () => {
    const track = new LiveTrack();
    const session = track.openCamera();
    track.changeProduct("shirt-a");
    track.changeProduct("shirt-b", "colour");
    const first = track.observe({
      ...note,
      atMs: 0,
      cameraSession: session,
      productId: "shirt-a",
    });
    const second = track.observe({
      ...note,
      atMs: 40,
      cameraSession: session,
      productId: "shirt-b",
      pose: false,
      receipt: { generated: true, weightsPresent: false, outputPath: null },
    });
    assert.equal(first.record.kind, "photographic-fallback");
    assert.equal(first.modelCalled, false);
    assert.equal(second.record.kind, "photographic-fallback");
    assert.equal(second.record.unstable, true);
    assert.equal(second.cache.valid, false);
    const summary = track.summary();
    assert.equal(summary.generative, false);
    assert.equal(summary.generatedFrames, 0);
    assert.equal(summary.modelAttached, false);
    assert.deepEqual(summary.sessions, [session]);
    assert.equal(summary.lastFps, 8);
    assert.equal(summary.maxCompositeMs, 1);
  });

  it("counts a camera gap as dropped frames and still does not call a model", () => {
    const track = new LiveTrack();
    const session = track.openCamera();
    track.observe({ ...note, atMs: 0, cameraSession: session, productId: "shirt-a" });
    track.observe({ ...note, atMs: 132, cameraSession: session, productId: "shirt-a", compositeMs: 4 });
    const summary = track.summary();
    assert.equal(summary.droppedFrames, 3);
    assert.equal(summary.meanCompositeMs, 2.5);
    assert.equal(summary.generative, false);
  });

  it("keeps the product cache invalid and can label only a receipt that names a real file", () => {
    const track = new LiveTrack();
    const session = track.openCamera();
    let seenKeyframe = false;
    for (let i = 0; i < 8; i += 1) {
      const observed = track.observe({
        ...note,
        atMs: i * 33,
        cameraSession: session,
        productId: "sku-1",
        compositeMs: 2,
      });
      assert.equal(observed.schedule.action, "photographic-fallback");
      assert.equal(observed.modelCalled, false);
      assert.equal(observed.cache.valid, false);
      if (observed.ifModelAttached === "request-keyframe") seenKeyframe = true;
    }
    assert.equal(seenKeyframe, true);
    const labeled = track.observe({
      ...note,
      atMs: 300,
      cameraSession: session,
      productId: "sku-1",
      receipt: { generated: true, weightsPresent: true, outputPath: "outputs/frame.png" },
    });
    assert.equal(labeled.record.kind, "model-generated");
    assert.equal(track.summary().generative, true);
    assert.equal(track.summary().modelAttached, false);
  });
});

describe("live schedule", () => {
  it("does not request a keyframe while no video model is attached", () => {
    const action = nextLiveAction({ modelAttached: false, framesSinceKeyframe: 30, keyframeEvery: 8 });
    assert.equal(action.action, "photographic-fallback");
    assert.equal(action.modelAttached, false);
  });

  it("rejects a diffusion call on every camera frame", () => {
    const action = nextLiveAction({ modelAttached: true, framesSinceKeyframe: 0, keyframeEvery: 1 });
    assert.equal(action.action, "photographic-fallback");
  });
});
