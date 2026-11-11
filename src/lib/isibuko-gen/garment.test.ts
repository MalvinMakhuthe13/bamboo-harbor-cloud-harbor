import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { ENCODER_CANDIDATES, neuralEncoderReady } from "./encoders.ts";
import { placeGarment } from "./garment-body.ts";
import { bindGarment, knownShirt } from "./garment-encoder.ts";
import { TemporalEngine } from "./temporal.ts";
import { classifyProbe } from "./webcam-report.ts";
import type { PerceptionState } from "./perception.ts";

const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function perception(occlusion: PerceptionState["occlusion"]): PerceptionState {
  return {
    atMs: 0,
    face: true,
    head: true,
    shoulders: occlusion === "lost" ? 0 : 2,
    torso: occlusion !== "lost",
    arms: occlusion === "lost" ? 0 : 2,
    hands: 1,
    silhouette: occlusion !== "lost",
    occlusion,
    motion: "still",
    reused: { face: false, pose: false, hands: false, silhouette: false },
  };
}

describe("garment measurement", () => {
  it("reads sleeves, collar, hem, stripe, and logo from a drawn shirt and binds the sku hash", () => {
    const raster = knownShirt();
    const hash = digest(raster.rgba);
    const wrong = bindGarment(raster, { lockId: "b:sku:nope", sku: "sku", contentHash: "ab".repeat(32), material: "linen", colours: ["sand"] }, digest);
    assert.equal(wrong.ok, false);
    const bound = bindGarment(
      raster,
      { lockId: `brand-lab:linen-shirt:${hash}`, sku: "linen-shirt", contentHash: hash, material: "linen", colours: ["sand"] },
      digest,
    );
    assert.equal(bound.ok, true);
    if (!bound.ok) return;
    const reading = bound.reading;
    assert.equal(reading.learnedEncoder, false);
    assert.equal(reading.generative, false);
    assert.equal(reading.executed, true);
    assert.equal(reading.assetHash, hash);
    assert.equal(reading.lockId.endsWith(hash), true);
    assert.equal(reading.bounds.x0, 6);
    assert.equal(reading.bounds.y0, 20);
    assert.equal(reading.bounds.x1, 73);
    assert.equal(reading.bounds.y1, 84);
    assert.equal(reading.sleeveLengthPx, 16);
    assert.equal(reading.collarOpening, true);
    assert.equal(reading.hemY, 84);
    assert.deepEqual(reading.logo, { x0: 46, y0: 40, x1: 51, y1: 46 });
    assert.equal(reading.patternRuns, 8);
    assert.equal(reading.textureStd, 0);
    assert.equal(reading.materialFromLock, "linen");
    assert.equal(reading.shoulderWidthPx, 68);
    assert.equal(reading.torsoLengthPx, 65);
  });
});

describe("body-conditioned placement", () => {
  it("scales with the shoulders, keeps the face out, and does not generate pixels", () => {
    const raster = knownShirt();
    const hash = digest(raster.rgba);
    const bound = bindGarment(
      raster,
      { lockId: `brand-lab:linen-shirt:${hash}`, sku: "linen-shirt", contentHash: hash, material: "linen", colours: ["sand"] },
      digest,
    );
    assert.equal(bound.ok, true);
    if (!bound.ok) return;
    const narrow = placeGarment({
      reading: bound.reading,
      frameWidth: 80,
      shoulderL: { x: 0.4, y: 0.34 },
      shoulderR: { x: 0.6, y: 0.34 },
      elbowL: { x: 0.32, y: 0.5 },
      elbowR: { x: 0.68, y: 0.5 },
      hipL: { x: 0.42, y: 0.72 },
      hipR: { x: 0.58, y: 0.72 },
      hand: { x: 0.5, y: 0.5 },
      face: { x: 0.42, y: 0.05, w: 0.16, h: 0.12 },
    });
    const wide = placeGarment({
      ...{
        reading: bound.reading,
        frameWidth: 80,
        shoulderL: { x: 0.3, y: 0.34 },
        shoulderR: { x: 0.7, y: 0.34 },
        elbowL: { x: 0.22, y: 0.5 },
        elbowR: { x: 0.78, y: 0.5 },
        hipL: { x: 0.36, y: 0.72 },
        hipR: { x: 0.64, y: 0.72 },
        hand: null,
        face: { x: 0.42, y: 0.05, w: 0.16, h: 0.12 },
      },
    });
    assert.equal(narrow.generative, false);
    assert.equal(narrow.replacesPixels, false);
    assert.equal(narrow.learnedDeformation, false);
    assert.equal(narrow.inpainting, false);
    assert.equal(narrow.identityPreserved, true);
    assert.equal(narrow.handOccludesTorso, true);
    assert.equal(narrow.blocked, null);
    assert.equal(wide.handOccludesTorso, false);
    assert.ok(Math.abs(wide.scale / narrow.scale - 2) < 0.001);
    const covered = placeGarment({
      reading: bound.reading,
      frameWidth: 80,
      shoulderL: { x: 0.4, y: 0.34 },
      shoulderR: { x: 0.6, y: 0.34 },
      elbowL: { x: 0.32, y: 0.5 },
      elbowR: { x: 0.68, y: 0.5 },
      hipL: { x: 0.42, y: 0.72 },
      hipR: { x: 0.58, y: 0.72 },
      hand: null,
      face: { x: 0.45, y: 0.4, w: 0.1, h: 0.1 },
    });
    assert.equal(covered.identityPreserved, false);
    assert.equal(covered.blocked !== null, true);
    assert.equal(covered.generative, false);
  });
});

describe("encoders and webcam separation", () => {
  it("does not execute a downloaded encoder and refuses the NVIDIA parser", () => {
    assert.equal(neuralEncoderReady(), false);
    assert.equal(ENCODER_CANDIDATES.every((item) => item.executed === false && item.downloaded === false && item.emitsPartGeometry === false), true);
    const parser = ENCODER_CANDIDATES.find((item) => item.id === "fashn-human-parser");
    assert.equal(parser?.commercial, "not-cleared");
    assert.equal(ENCODER_CANDIDATES.some((item) => item.garmentSpecific), false);
  });

  it("discards rates when no real camera opened", () => {
    const missing = classifyProbe({
      fakeDevice: false,
      videoInputs: 0,
      opened: false,
      errorName: "NotFoundError",
      pageError: "No camera was found on this device.",
      fps: 30,
      faceHz: 5,
      poseHz: 5,
      handHz: 2,
      segmentHz: 2,
      compositeMs: 1,
      cameraSession: 1,
      productSwitchKeptSession: true,
    });
    assert.equal(missing.kind, "no-camera");
    assert.equal(missing.personTested, false);
    assert.equal(missing.measurements, null);
    assert.equal(missing.discardedRates, true);
    const fake = classifyProbe({
      fakeDevice: true,
      videoInputs: 1,
      opened: true,
      errorName: null,
      pageError: null,
      fps: 30,
      faceHz: 5,
      poseHz: 5,
      handHz: 2,
      segmentHz: 2,
      compositeMs: 1,
      cameraSession: 1,
      productSwitchKeptSession: true,
    });
    assert.equal(fake.kind, "synthetic-device");
    assert.equal(fake.measurements, null);
  });
});

describe("temporal feature slots", () => {
  it("records occlusion history and leaves every generated feature empty", () => {
    const engine = new TemporalEngine();
    engine.step({ atMs: 0, perception: perception("clear"), productLockId: "lock-a" });
    engine.step({ atMs: 33, perception: perception("lost"), productLockId: "lock-a" });
    const features = engine.featureState();
    assert.deepEqual(features.occlusionHistory, ["clear", "lost"]);
    assert.equal(features.previousGeneratedFeature, null);
    assert.equal(features.latent, null);
    assert.equal(features.garmentAppearance, null);
    assert.equal(features.temporalAttention, "not-attached");
    assert.equal(features.motionRefinement, "not-attached");
  });
});
