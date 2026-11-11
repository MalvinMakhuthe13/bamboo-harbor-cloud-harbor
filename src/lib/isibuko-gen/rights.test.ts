import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyRights, rightsProblems, sampleStatus } from "./rights.ts";

describe("rights contract", () => {
  it("rejects missing rights and never treats a complete form as admitted", () => {
    const blank = emptyRights();
    assert.ok(rightsProblems(blank).some((reason) => reason.includes("rights holder")));
    assert.ok(rightsProblems({ ...blank, agreementScope: "product-use" }).some((reason) => reason.includes("product-use")));
    const complete = {
      ...blank,
      recordKind: "real" as const,
      rightsBasis: "isibuko-owned" as const,
      rightsHolder: "Example holder",
      agreementReference: "agreement-1",
      agreementScope: "ai-training" as const,
      commercialTraining: true,
      consentId: "consent-1",
      allowsTraining: true,
      allowsPersonImagery: false,
      source: "merchant file",
      acquired: "2026-11-11",
      method: "upload",
      merchant: "Example merchant",
    };
    assert.deepEqual(rightsProblems(complete), []);
    const waiting = sampleStatus({ sku: "sku", category: "shirt", annotator: "ada", reviewer: "lin", geometryOpen: false, rights: complete });
    assert.equal(waiting.label, "Awaiting independent review");
    assert.notEqual(waiting.label, "Admitted");
    const fixture = sampleStatus({ sku: "sku", category: "shirt", annotator: "ada", reviewer: "lin", geometryOpen: false, rights: { ...complete, recordKind: "synthetic-fixture" } });
    assert.equal(fixture.label, "Rejected");
    assert.match(fixture.reasons[0], /Synthetic fixture/);
  });
});
