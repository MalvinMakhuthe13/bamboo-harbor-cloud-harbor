import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { acceptSample, emptyCaptureConsent, reviewConsent } from "./capture.ts";
import { FRAME_POLICY } from "../isibuko-ai/privacy.ts";
import { resolveRenderer, TRAINED_ARTIFACTS } from "./feature-flag.ts";
import { replayMae, validateManifest, type TrainManifest } from "./manifest.ts";

function granted(pixels = false) {
  const consent = emptyCaptureConsent("consent-1", "hair-motion");
  consent.atIso = "2026-11-14T00:00:00Z";
  consent.segmentation = true;
  consent.pixels = pixels;
  consent.rights = {
    ...consent.rights,
    recordKind: "real",
    rightsBasis: "isibuko-owned",
    rightsHolder: "Example holder",
    agreementReference: "agreement-1",
    agreementScope: "ai-training",
    commercialTraining: true,
    consentId: "consent-1",
    allowsTraining: true,
    allowsPersonImagery: pixels,
    source: "on-device opt-in",
    acquired: "2026-11-14",
    method: "landmark-log",
    merchant: "none",
  };
  return consent;
}

describe("on-device capture", () => {
  it("keeps the live frame policy and stores landmarks without pixels", () => {
    assert.equal(FRAME_POLICY.leavesDevice, false);
    assert.equal(FRAME_POLICY.externalInference, false);
    const stored = acceptSample(granted(false), {
      tMs: 10,
      category: "wig",
      landmarks: [{ name: "forehead", x: 0.5, y: 0.3 }, { name: "cheekL", x: 0.4, y: 0.4 }, { name: "cheekR", x: 0.6, y: 0.4 }],
      segmentation: { counts: { hair: 12 }, coarse: [1, 0], coarseWidth: 2, coarseHeight: 1 },
      pixels: new Uint8Array([1, 2, 3]),
    });
    assert.equal(stored.ok, false);
    const clean = acceptSample(granted(false), {
      tMs: 10,
      category: "wig",
      landmarks: [
        { name: "forehead", x: 0.5, y: 0.3 },
        { name: "cheekL", x: 0.4, y: 0.4 },
        { name: "cheekR", x: 0.6, y: 0.4 },
      ],
      segmentation: { counts: { hair: 12 } },
    });
    assert.equal(clean.ok, true);
    if (clean.ok) assert.equal("pixels" in clean.stored, false);
  });

  it("refuses pixel consent without person-imagery permission", () => {
    const consent = granted(true);
    consent.rights.allowsPersonImagery = false;
    const review = reviewConsent(consent);
    assert.equal(review.ok, false);
  });
});

describe("training manifest and fallback", () => {
  it("rejects a trainable synthetic row and leaves the renderer geometric", () => {
    const consent = granted(false);
    consent.rights.recordKind = "synthetic-fixture";
    const manifest: TrainManifest = {
      version: "isibuko.train/1",
      trainable: true,
      rows: [{
        id: "row-1",
        task: "hair-motion",
        category: "wig",
        consent,
        pixelBlob: false,
        samples: [{
          tMs: 1,
          category: "wig",
          landmarks: [
            { name: "forehead", x: 0.5, y: 0.2 },
            { name: "cheekL", x: 0.4, y: 0.4 },
            { name: "cheekR", x: 0.6, y: 0.4 },
          ],
        }],
      }],
    };
    const result = validateManifest(manifest);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => /synthetic/i.test(error)));
    assert.equal(TRAINED_ARTIFACTS.enabled, false);
    assert.equal(resolveRenderer(), "geometric-composite");
    assert.equal(resolveRenderer({ allowTrained: true, checkpointId: "later" }), "geometric-composite");
    assert.equal(replayMae([0, 1], [0, 0.5]), 0.25);
  });
});
