import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addPoint,
  closePolygon,
  emptySession,
  importSample,
  markAbsent,
  missingParts,
  movePoint,
  removePartGeometry,
  sessionFromJson,
  sessionJson,
  setBox,
  setCategory,
  setGarmentPolygon,
  setPartConfidence,
} from "./annotate.ts";

describe("annotation studio edits", () => {
  it("draws, edits, persists, and keeps future categories out of training", () => {
    const session = emptySession();
    const sample = importSample(session, {
      sampleId: "shirt-1",
      sku: "sku-1",
      imageName: "shirt.png",
      assetHash: "a".repeat(64),
      width: 32,
      height: 32,
    });
    setCategory(sample, "shirt");
    addPoint(sample, "collar", [2, 2]);
    addPoint(sample, "collar", [8, 2]);
    addPoint(sample, "collar", [8, 8]);
    closePolygon(sample, "collar");
    movePoint(sample, "collar", 0, [3, 3]);
    assert.deepEqual(sample.parts.collar.polygon?.[0], [3, 3]);
    setBox(sample, "sleeve", [4, 4, 10, 8]);
    sample.parts.sleeve.side = "left";
    markAbsent(sample, "straps");
    setPartConfidence(sample, "hem", 0.9);
    assert.equal(sample.parts.straps.kind, "absent");
    assert.ok(missingParts(sample).includes("hem"));
    removePartGeometry(sample, "collar");
    assert.equal(sample.parts.collar.present, null);
    setGarmentPolygon(sample, [
      [1, 1],
      [20, 1],
      [20, 20],
    ]);
    assert.throws(() => addPoint(sample, "hem", [40, 1]), /outside/);
    assert.throws(() => setBox(sample, "hem", [0, 0, 40, 2]), /outside/);
    const restored = sessionFromJson(sessionJson(session));
    assert.equal(restored.samples[0].sku, "sku-1");
    assert.equal(restored.samples[0].assetHash, "a".repeat(64));
    assert.equal(restored.samples[0].merchant.visuallyDetected, false);
    setCategory(restored.samples[0], "skirt");
    assert.equal(restored.samples[0].trainingLabel, false);
    assert.equal(restored.samples[0].futureCategory, "skirt");
  });
});
