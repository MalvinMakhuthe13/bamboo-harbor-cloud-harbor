import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { acceptClaim } from "./agents.ts";
import { baselineCanRun, STILL_BASELINE } from "./baseline.ts";
import { BrandDirectory } from "./brands.ts";
import { CATEGORY_CAPABILITIES, generativeAdvertised } from "./categories.ts";
import { acceptExperiment } from "./experiment.ts";
import { interpretInferResponse, routeRender } from "./infer-client.ts";
import { acceptScorecard } from "./scorecard.ts";
import { acceptCameraReport } from "./camera-suite.ts";

describe("category advertising", () => {
  it("does not advertise generative support for any category", () => {
    for (const row of CATEGORY_CAPABILITIES) {
      assert.equal(generativeAdvertised(row.category), false);
      assert.equal(row.generativeStill, false);
      assert.equal(row.generativeVideo, false);
    }
  });
});

describe("brand isolation", () => {
  it("refuses a cross-brand catalogue read", () => {
    const directory = new BrandDirectory();
    directory.create("brand-a");
    directory.create("brand-b");
    directory.addProduct("brand-a", { sku: "linen", assetRef: "asset-1", category: "shirt" });
    assert.throws(() => directory.listProducts("brand-b", "brand-a"), /another brand/);
    assert.equal(directory.listProducts("brand-a", "brand-a")[0]?.sku, "linen");
  });
});

describe("experiments and claims", () => {
  it("rejects a score attached to a run that generated nothing", () => {
    const failed = acceptExperiment({
      id: "exp-1",
      modelId: "fashn-vton-1.5",
      modelVersion: "1.5",
      codeVersion: "e398e60",
      datasetVersion: "none",
      hardware: "cpu",
      generated: false,
      outputPath: null,
      failureCode: "WEIGHTS_MISSING",
      metrics: { identity: 0.9 },
      conclusion: "Weights were not installed.",
    });
    assert.equal(failed.ok, false);
    const honest = acceptExperiment({
      id: "exp-1",
      modelId: "fashn-vton-1.5",
      modelVersion: "1.5",
      codeVersion: "e398e60",
      datasetVersion: "none",
      hardware: "cpu",
      generated: false,
      outputPath: null,
      failureCode: "WEIGHTS_MISSING",
      metrics: null,
      conclusion: "Weights were not installed.",
    });
    assert.equal(honest.ok, true);
  });

  it("rejects a claim that only says success", () => {
    assert.equal(acceptClaim({ agent: "tryon", claim: "The shirt was generated.", evidence: ["success"] }).ok, false);
    assert.equal(acceptClaim({ agent: "tryon", claim: "Weights missing.", evidence: ["services/isibuko-infer/test_server.py"] }).ok, true);
  });
});

describe("inference routing", () => {
  it("does not treat a missing model as a generated image or as the composite", () => {
    assert.equal(baselineCanRun(), false);
    assert.equal(STILL_BASELINE.installed, false);
    const body = {
      ok: false,
      generated: false,
      code: "WEIGHTS_MISSING",
      image: null,
      modelId: "fashn-vton-1.5",
      weightsPresent: false,
    };
    assert.equal(interpretInferResponse(body).useAsGenerated, false);
    const route = routeRender("generative", body);
    assert.equal(route.mode, "refused");
    assert.equal(route.generated, false);
    assert.notEqual(route.code, "COMPOSITE");
  });
});

describe("scorecard and camera report", () => {
  it("refuses a photorealism claim without an output and a human review", () => {
    const missing = acceptScorecard({
      outputPath: null,
      automated: { colorDrift: 1, identityDrift: 1, flicker: null },
      humanReviewer: "a",
      humanNotes: "looks fine",
    });
    assert.equal(missing.ok, false);
    assert.equal(missing.singleScore, null);
  });

  it("does not count a missing camera as a person test", () => {
    const report = acceptCameraReport({
      permission: "not-found",
      humanDetected: false,
      device: "sandbox",
      sessionBefore: 1,
      sessionAfterProductChange: 1,
      framesKeptForTraining: false,
      externalUpload: false,
    });
    assert.equal(report.personTested, false);
  });
});
