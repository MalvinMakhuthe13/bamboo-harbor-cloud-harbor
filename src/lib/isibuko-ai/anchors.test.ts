import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeProductAlpha, getWigFittingParameters, validateProductFittingAnchors } from "./anchors.ts";

describe("versioned product fitting anchors", () => {
  it("accepts normalized points and bounded wig parameters", () => {
    assert.equal(validateProductFittingAnchors({
      version: "isibuko.anchors/1",
      points: { hairline: { x: 0.5, y: 0.2, confidence: 0.9 } },
      parameters: { wigOpening: 0.3, wigHoleFraction: 0.4 },
    }), true);
  });

  it("rejects unsupported versions and out-of-range values", () => {
    assert.equal(validateProductFittingAnchors({ version: "isibuko.anchors/2" }), false);
    assert.equal(validateProductFittingAnchors({ version: "isibuko.anchors/1", points: { collar: { x: 1.2, y: 0.4 } } }), false);
    assert.equal(validateProductFittingAnchors({ version: "isibuko.anchors/1", parameters: { wigOpening: 1.2 } }), false);
    assert.equal(validateProductFittingAnchors({ version: "isibuko.anchors/1", points: { top: { x: 0.5, y: 0.5, confidence: -1 } } }), false);
  });

  it("uses reviewed per-product values and safe defaults", () => {
    assert.deepEqual(getWigFittingParameters({
      version: "isibuko.anchors/1",
      parameters: { wigOpening: 0.37, wigHoleFraction: 0.42 },
    }), { opening: 0.37, holeFrac: 0.42 });
    assert.deepEqual(getWigFittingParameters(undefined), { opening: 0.12, holeFrac: 0.42 });
    assert.deepEqual(getWigFittingParameters({ version: "isibuko.anchors/1" }), { opening: 0.12, holeFrac: 0.42 });
  });
});

describe("product alpha geometry analysis", () => {
  it("returns normalized bounds and a candidate central transparent opening", () => {
    const width = 9, height = 9;
    const pixels = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) pixels[i * 4 + 3] = 255;
    for (let x = 3; x <= 5; x++) pixels[(4 * width + x) * 4 + 3] = 0;
    const result = analyzeProductAlpha(pixels, width, height);
    assert.ok(result);
    assert.deepEqual(result.bounds, { left: 0, top: 0, right: 1, bottom: 1 });
    assert.ok(result.centralOpeningCandidate);
    assert.equal(result.centralOpeningCandidate.width, 3 / 9);
    assert.equal(result.silhouette.length, 16);
    assert.ok(result.silhouette.every((sample) => sample.left >= 0 && sample.right <= 1 && sample.width > 0));
    assert.ok(result.confidence >= 0 && result.confidence <= 1);
  });

  it("handles a fully transparent image without inventing bounds", () => {
    const result = analyzeProductAlpha(new Uint8Array(4 * 4 * 4), 4, 4);
    assert.deepEqual(result, {
      version: "isibuko.anchors/1", bounds: null, alphaCoverage: 0, confidence: 0,
      silhouette: [], centralOpeningCandidate: null,
    });
  });


  it("does not mistake a side cut-out for a central opening", () => {
    const width = 12, height = 8;
    const pixels = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) pixels[i * 4 + 3] = 255;
    for (let x = 1; x <= 3; x++) pixels[(4 * width + x) * 4 + 3] = 0;
    const result = analyzeProductAlpha(pixels, width, height);
    assert.ok(result);
    assert.equal(result.centralOpeningCandidate, null);
    assert.ok(result.silhouette.length > 0);
  });

  it("rejects malformed image buffers and dimensions", () => {
    assert.equal(analyzeProductAlpha(new Uint8Array(8), 2, 2), null);
    assert.equal(analyzeProductAlpha(new Uint8Array(4 * 4 * 4), 0, 4), null);
    assert.equal(analyzeProductAlpha(new Uint8Array(4 * 4 * 4), 4, 4, 300), null);
  });
});
