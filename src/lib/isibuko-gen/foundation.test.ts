import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SHIRT_ARCHITECTURE, estimateTrainGpu } from "./architecture.ts";
import { COMMERCIAL_PATHS, commercialSummary } from "./commercial.ts";
import { sampleOwnedPair, sampleResearchPair, validatePair } from "./dataset.ts";
import { evaluateShirt, syntheticScoreFixture } from "./evaluate.ts";
import { UNMEASURED_ACCEPTANCE, acceptanceGaps } from "./inference.ts";
import { buildShirtPacket } from "./packet.ts";
import { runShirtExperiment } from "./runner.ts";

describe("Isibuko shirt foundation", () => {
  it("accepts an owned 8-frame shirt contract and rejects a research still", () => {
    const owned = validatePair(sampleOwnedPair());
    assert.equal(owned.ok, true, owned.errors.join("; "));
    const research = validatePair(sampleResearchPair());
    assert.equal(research.ok, false);
    assert.ok(research.errors.some((error) => error.includes("research-only")));
    assert.ok(research.errors.some((error) => error.includes("8 frames") || error.includes("at least 8")));
  });

  it("scores a numeric fixture without claiming a generated shirt", () => {
    const score = evaluateShirt(syntheticScoreFixture());
    assert.ok(score.colorDrift < 1);
    assert.ok(score.identityDrift < 1);
    assert.ok(score.flicker < 10);
    assert.equal(score.pixels, 4);
  });

  it("assembles conditioning and still refuses to generate", () => {
    const built = buildShirtPacket({
      category: "shirt",
      garmentId: "shirt-linen",
      garmentUrl: "/catalog/shirt-linen.png",
      frameWidth: 720,
      frameHeight: 960,
      timestampMs: 10,
      poseTracked: true,
      clothesMask: true,
      source: "camera",
    });
    assert.equal(built.ok, true);
    if (!built.ok) return;
    const result = runShirtExperiment(built.packet);
    assert.equal(result.output, null);
    assert.equal(result.weightsPresent, false);
    assert.equal(result.usedComposite, false);
    assert.equal(result.preflight.generated, false);
    assert.equal(result.preflight.conditioningValid, true);
    assert.ok(result.preflight.steps.includes("generation-refused"));
    assert.equal(result.preflight.plan?.temporalWindow, SHIRT_ARCHITECTURE.frames);
  });

  it("rejects a shirt packet that has no pose", () => {
    const built = buildShirtPacket({
      category: "shirt",
      garmentId: "shirt-linen",
      garmentUrl: "/catalog/shirt-linen.png",
      frameWidth: 720,
      frameHeight: 960,
      timestampMs: 10,
      poseTracked: false,
      clothesMask: false,
      source: "studio",
    });
    assert.equal(built.ok, true);
    if (!built.ok) return;
    const result = runShirtExperiment(built.packet);
    assert.equal(result.preflight.conditioningValid, false);
    assert.equal(result.preflight.plan, null);
    assert.equal(result.output, null);
  });

  it("estimates training memory as arithmetic and does not mark it measured", () => {
    const gpu = estimateTrainGpu();
    assert.equal(gpu.measured, false);
    assert.ok(gpu.checkpointedGb > gpu.weightsGb);
    assert.ok(gpu.naiveGb > gpu.checkpointedGb);
    assert.equal(SHIRT_ARCHITECTURE.weightsPresent, false);
    assert.equal(SHIRT_ARCHITECTURE.status, "designed-not-trained");
  });

  it("does not treat any external model as installed or live", () => {
    const summary = commercialSummary();
    assert.equal(summary.installed, 0);
    assert.equal(summary.live, 0);
    assert.ok(!summary.clearedImage.includes("fashn-vton-1.5"));
    const fashn = COMMERCIAL_PATHS.find((path) => path.id === "fashn-vton-1.5");
    assert.equal(fashn?.commercial, "conditional");
    assert.match(fashn?.whyNotInstalled ?? "", /legal review is required/);
    assert.ok(summary.clearedVideo.includes("wan2.1"));
    const leffa = COMMERCIAL_PATHS.find((path) => path.id === "leffa");
    assert.equal(leffa?.commercial, "not-cleared");
    assert.equal(leffa?.kind, "image");
    for (const path of COMMERCIAL_PATHS) {
      assert.equal(path.live, false);
      assert.equal(path.installed, false);
    }
  });

  it("keeps the shirt acceptance test failed until a real camera measurement exists", () => {
    const gaps = acceptanceGaps(UNMEASURED_ACCEPTANCE);
    assert.ok(gaps.length >= 5);
    assert.ok(gaps.some((gap) => gap.includes("real person")));
  });
});
