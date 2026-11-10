import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SHIRT_CANDIDATES } from "./candidates.ts";
import { buildShirtPacket } from "./packet.ts";
import { runShirtExperiment } from "./runner.ts";

describe("shirt generative experiment", () => {
  it("refuses anything that is not a shirt", () => {
    const built = buildShirtPacket({
      category: "wig",
      garmentId: "wig-bob",
      garmentUrl: "/catalog/wig-bob.png",
      frameWidth: 720,
      frameHeight: 960,
      timestampMs: 1,
      poseTracked: true,
      clothesMask: true,
      source: "studio",
    });
    assert.equal(built.ok, false);
  });

  it("does not generate a frame or call the composite when weights are absent", () => {
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
    assert.equal(result.state, "not-installed");
    assert.equal(result.running, false);
    assert.equal(result.live, false);
    assert.equal(result.usedComposite, false);
    assert.equal(result.output, null);
    assert.equal(result.weightsPresent, false);
  });

  it("does not list any external model as live or commercially cleared", () => {
    assert.ok(SHIRT_CANDIDATES.length >= 4);
    for (const candidate of SHIRT_CANDIDATES) {
      assert.equal(candidate.live, false);
      assert.equal(candidate.commercial, false);
    }
    assert.ok(SHIRT_CANDIDATES.some((candidate) => candidate.kind === "video"));
  });
});
