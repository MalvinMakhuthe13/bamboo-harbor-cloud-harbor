import test from "node:test";
import assert from "node:assert/strict";
import { SELFIE_CLASS, summarizeSemanticMask } from "./product-segmentation.ts";

test("summarises hair, face and clothing regions in a categorical mask", () => {
  const mask = new Uint8Array([
    SELFIE_CLASS.hair, SELFIE_CLASS.hair, SELFIE_CLASS.background, SELFIE_CLASS.background,
    SELFIE_CLASS.hair, SELFIE_CLASS.faceSkin, SELFIE_CLASS.faceSkin, SELFIE_CLASS.background,
    SELFIE_CLASS.clothes, SELFIE_CLASS.clothes, SELFIE_CLASS.clothes, SELFIE_CLASS.background,
  ]);
  const result = summarizeSemanticMask(mask, 4, 3);
  assert.equal(result.hair.pixels, 3);
  assert.equal(result.faceSkin.pixels, 2);
  assert.equal(result.clothes.pixels, 3);
  assert.equal(result.hair.bounds?.left, 0);
  assert.equal(result.hair.bounds?.right, 0.5);
  assert.equal(result.hairDetected, true);
});

test("returns null bounds for semantic classes absent from a frame", () => {
  const result = summarizeSemanticMask(new Uint8Array(16).fill(SELFIE_CLASS.background), 4, 4);
  assert.equal(result.hair.bounds, null);
  assert.equal(result.hair.center, null);
  assert.equal(result.hairDetected, false);
});

test("rejects mismatched mask dimensions", () => {
  assert.throws(() => summarizeSemanticMask(new Uint8Array(3), 2, 2), /length/);
  assert.throws(() => summarizeSemanticMask(new Uint8Array(4), 0, 2), /dimensions/);
});
