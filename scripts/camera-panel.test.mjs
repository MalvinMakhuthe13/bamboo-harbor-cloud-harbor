import assert from "node:assert/strict";
import test from "node:test";
import { parseCameraPanel } from "./camera-panel.mjs";

test("reads a live panel and ignores a studio panel", () => {
  const live = parseCameraPanel(`Camera
Live. Frames stay on this device.
Session
7
Picture
18 fps
Face
found · 12 Hz · 9 ms
Elbows
2 of 2 · pose 8 Hz · 14 ms
Hands
2 · 6 Hz · 11 ms
Segment
mask · 4 Hz · 20 ms · age 30 ms
Motion
moving
Composite
3 ms`);
  assert.equal(live.live, true);
  assert.equal(live.fps, 18);
  assert.equal(live.faceHz, 12);
  assert.equal(live.poseHz, 8);
  assert.equal(live.handHz, 6);
  assert.equal(live.segmentHz, 4);
  assert.equal(live.compositeMs, 3);
  assert.equal(live.cameraSession, 7);
  assert.equal(live.motion, "moving");
  assert.equal(live.faceFound, true);

  const studio = parseCameraPanel("Camera\nStudio photograph. Not your camera.\nPicture\n30 fps");
  assert.equal(studio.live, false);
  assert.equal(studio.fps, null);
});
