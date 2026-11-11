import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateSample, type SampleRecord } from "./validate.ts";
import { acceptManifest } from "./manifest.ts";

const hash = "a".repeat(64);

function sample(overrides: Partial<SampleRecord> = {}): SampleRecord {
  return {
    id: "sample-1",
    datasetId: "ds-owned-1",
    sha256: hash,
    rights: "isibuko-owned",
    consentTraining: true,
    consentEvaluation: true,
    width: 768,
    height: 1024,
    bytes: 120_000,
    category: "shirt",
    ...overrides,
  };
}

describe("dataset validation", () => {
  it("accepts an owned sample with separate training consent", () => {
    const verdict = validateSample(sample(), new Set());
    assert.equal(verdict.trainingEligible, true);
    assert.equal(verdict.ok, true);
  });

  it("rejects research-only, unknown, duplicate, and try-on-only consent", () => {
    assert.equal(validateSample(sample({ rights: "research-only" }), new Set()).trainingEligible, false);
    assert.equal(validateSample(sample({ rights: "unknown" }), new Set()).evaluationEligible, false);
    assert.equal(validateSample(sample(), new Set([hash])).trainingEligible, false);
    const tryOnOnly = validateSample(sample({ consentTraining: false }), new Set());
    assert.equal(tryOnOnly.trainingEligible, false);
    assert.match(tryOnOnly.errors.join(" "), /Training consent/);
  });
});

describe("dataset manifest", () => {
  it("refuses a manifest that has no training opt-in", () => {
    const verdict = acceptManifest({
      id: "ds-1",
      source: "isibuko-capture",
      licence: "isibuko-owned",
      consentStatus: "evaluation-only",
      category: "shirt",
      version: "0",
      annotationStatus: "none",
      sampleCount: 0,
      retentionPolicy: "delete-on-request",
    });
    assert.equal(verdict.trainingEligible, false);
  });
});
