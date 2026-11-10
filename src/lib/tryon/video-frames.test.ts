import test from "node:test";
import assert from "node:assert/strict";
import { buildFrameTimestamps, validateMotionVideoFile } from "./video-frames.ts";

test("samples a clip at a stable interval without exceeding its duration", () => {
  assert.deepEqual(buildFrameTimestamps(1_000, 200), [0, 200, 400, 600, 800]);
});

test("caps extraction duration for long seller videos", () => {
  assert.deepEqual(buildFrameTimestamps(120_000, 500, 2_000), [0, 500, 1_000, 1_500]);
});

test("returns no timestamps for invalid or empty duration", () => {
  assert.deepEqual(buildFrameTimestamps(0), []);
  assert.deepEqual(buildFrameTimestamps(Number.NaN), []);
});

test("rejects invalid sampling intervals and duration caps", () => {
  assert.throws(() => buildFrameTimestamps(1_000, 0), RangeError);
  assert.throws(() => buildFrameTimestamps(1_000, 100, 0), RangeError);
});

test("video file validation accepts common video MIME types and extensions", () => {
  assert.equal(validateMotionVideoFile({ name: "demo.mp4", type: "", size: 100 } as File), null);
  assert.equal(validateMotionVideoFile({ name: "demo.webm", type: "video/webm", size: 100 } as File), null);
});

test("video file validation rejects empty, unsupported and oversized files", () => {
  assert.match(validateMotionVideoFile({ name: "empty.mp4", type: "video/mp4", size: 0 } as File) ?? "", /empty/);
  assert.match(validateMotionVideoFile({ name: "notes.txt", type: "text/plain", size: 100 } as File) ?? "", /Choose an MP4/);
  assert.match(validateMotionVideoFile({ name: "large.mp4", type: "video/mp4", size: 251 * 1024 * 1024 } as File) ?? "", /250 MB/);
});
