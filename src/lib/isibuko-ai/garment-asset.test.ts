import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AlphaGeometry } from "./anchors.ts";
import { prepareGarmentAsset } from "./garment-asset.ts";

function alphaFixture(overrides: Partial<AlphaGeometry> = {}): AlphaGeometry {
  return {
    version: "isibuko.anchors/1",
    bounds: { left: 0.1, top: 0.08, right: 0.9, bottom: 0.94 },
    alphaCoverage: 0.42,
    confidence: 0.65,
    silhouette: Array.from({ length: 16 }, (_, index) => ({
      y: (index + 0.5) / 16,
      left: 0.2,
      right: 0.8,
      center: 0.5,
      width: 0.6,
    })),
    centralOpeningCandidate: null,
    ...overrides,
  };
}

describe("garment asset preparation plan", () => {
  it("creates a padded crop and reviewable shirt UV regions", () => {
    const plan = prepareGarmentAsset("shirt", alphaFixture());
    assert.equal(plan.version, "isibuko.asset-plan/1");
    assert.equal(plan.state, "ready-for-review");
    assert.deepEqual(plan.crop, { left: 0.075, top: 0.055, right: 0.925, bottom: 0.965 });
    assert.deepEqual(plan.uvRegions.map((region) => region.part), ["torso", "sleeve-left", "sleeve-right"]);
    assert.ok(plan.review.some((item) => item.anchor === "shoulderL" && item.required));
    assert.ok(plan.review.some((item) => item.anchor === "wristL" && !item.required));
  });

  it("uses a single full-image UV region for dresses", () => {
    const plan = prepareGarmentAsset("dress", alphaFixture());
    assert.deepEqual(plan.uvRegions, [{
      part: "full",
      rect: { left: 0, top: 0, right: 1, bottom: 1 },
    }]);
    assert.ok(plan.review.some((item) => item.anchor === "hipL" && item.required));
    assert.ok(plan.review.some((item) => item.anchor === "kneeL" && !item.required));
  });

  it("blocks preparation when no valid alpha bounds exist", () => {
    const plan = prepareGarmentAsset("shirt", alphaFixture({ bounds: null, silhouette: [] }));
    assert.equal(plan.state, "blocked");
    assert.equal(plan.crop, null);
    assert.equal(plan.uvRegions.length, 0);
    assert.ok(plan.warnings.some((warning) => warning.includes("transparent product cut-out")));
  });

  it("requires extra review for low-quality or nearly opaque cut-outs", () => {
    const sparse = prepareGarmentAsset("pants", alphaFixture({ silhouette: Array(3).fill({
      y: 0.5, left: 0.2, right: 0.8, center: 0.5, width: 0.6,
    }) }));
    assert.equal(sparse.state, "review-required");
    assert.ok(sparse.warnings.some((warning) => warning.includes("Too few silhouette rows")));
    const opaque = prepareGarmentAsset("jacket", alphaFixture({ alphaCoverage: 0.995 }));
    assert.equal(opaque.state, "review-required");
    assert.ok(opaque.warnings.some((warning) => warning.includes("almost fully opaque")));
  });

  it("never labels semantic landmarks as automatically detected", () => {
    const plan = prepareGarmentAsset("dress", alphaFixture());
    assert.ok(plan.review.length > 0);
    assert.ok(plan.review.every((item) => item.status === "needs-review"));
    assert.ok(plan.review.filter((item) => item.required).every((item) => item.reason.includes("cannot identify")));
  });

  it("adds a warning for a transparent opening candidate", () => {
    const plan = prepareGarmentAsset("wig", alphaFixture({
      centralOpeningCandidate: { top: 0.4, bottom: 0.42, width: 0.18 },
    }));
    assert.ok(plan.warnings.some((warning) => warning.includes("confirm whether it is a real product opening")));
  });
});
