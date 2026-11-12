import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  fuseHeadPose,
  HeadPoseSmoother,
  landmarkPose,
  matrixToEuler,
  NeutralPoseCalibration,
  OneEuroAngleFilter,
} from "./head-pose.ts";

function identity(): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function rotationY(degrees: number): number[] {
  const angle = (degrees * Math.PI) / 180;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  // Column-major 4x4 rotation about Y.
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}

function points(): { x: number; y: number }[] {
  const result = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  result[33] = { x: 0.4, y: 0.4 };
  result[263] = { x: 0.6, y: 0.4 };
  result[234] = { x: 0.3, y: 0.5 };
  result[454] = { x: 0.7, y: 0.5 };
  result[1] = { x: 0.52, y: 0.5 };
  return result;
}

describe("head pose matrix and landmark estimation", () => {
  it("returns neutral angles for an identity matrix", () => {
    assert.deepEqual(matrixToEuler(identity()), { yaw: 0, pitch: 0, roll: 0 });
  });

  it("extracts yaw from a column-major MediaPipe transform", () => {
    const pose = matrixToEuler(rotationY(30));
    assert.ok(pose);
    assert.ok(Math.abs(pose.yaw - 30) < 0.01);
    assert.ok(Math.abs(pose.pitch) < 0.01);
    assert.ok(Math.abs(pose.roll) < 0.01);
  });

  it("rejects missing, malformed and non-finite matrices", () => {
    assert.equal(matrixToEuler(null), null);
    assert.equal(matrixToEuler([1, 2, 3]), null);
    const invalid = identity();
    invalid[0] = Number.NaN;
    assert.equal(matrixToEuler(invalid), null);
  });

  it("estimates low-confidence yaw and roll from face landmarks", () => {
    const landmarks = points();
    landmarks[1] = { x: 0.58, y: 0.5 };
    landmarks[263] = { x: 0.6, y: 0.42 };
    const pose = landmarkPose(landmarks);
    assert.ok(pose);
    assert.equal(pose.source, "landmarks");
    assert.equal(pose.confidence, 0.3);
    assert.ok(pose.yaw > 0);
    assert.ok(pose.roll > 0);
    assert.equal(pose.pitch, 0);
  });

  it("prefers a valid matrix over the landmark fallback", () => {
    const pose = fuseHeadPose(identity(), points());
    assert.ok(pose);
    assert.equal(pose.source, "matrix");
    assert.equal(pose.confidence, 0.95);
  });

  it("uses landmarks when the matrix is unavailable", () => {
    const pose = fuseHeadPose(null, points());
    assert.ok(pose);
    assert.equal(pose.source, "landmarks");
  });
});

describe("head pose filtering and neutral calibration", () => {
  it("filters angle wrap using the shortest angular path", () => {
    const filter = new OneEuroAngleFilter(0.5, 0, 1);
    filter.filter(179, 0);
    const next = filter.filter(-179, 33);
    assert.ok(next > 170 || next < -170);
  });

  it("does not move backwards in time when timestamps are invalid", () => {
    const filter = new OneEuroAngleFilter();
    filter.filter(10, 100);
    assert.equal(filter.filter(40, 90), 10);
  });

  it("applies neutral calibration with wrap-safe angle differences", () => {
    const calibration = new NeutralPoseCalibration();
    calibration.setNeutral({ yaw: 179, pitch: 10, roll: -179 });
    const relative = calibration.apply({ yaw: -179, pitch: 15, roll: 179 });
    assert.ok(Math.abs(relative.yaw - 2) < 1e-6);
    assert.equal(relative.pitch, 5);
    assert.ok(Math.abs(relative.roll + 2) < 1e-6);
  });

  it("resets filters when the neutral pose is recalibrated", () => {
    const smoother = new HeadPoseSmoother();
    const first = { yaw: 20, pitch: 4, roll: -3, confidence: 0.95, source: "matrix" as const };
    smoother.update(first, 100);
    smoother.calibrateNeutral(first);
    assert.equal(smoother.calibrated, true);
    const calibrated = smoother.update({ ...first, yaw: 25 }, 133);
    assert.ok(calibrated.yaw > 0);
    assert.ok(calibrated.yaw < 5);
    smoother.reset();
    assert.equal(smoother.calibrated, false);
  });
});
