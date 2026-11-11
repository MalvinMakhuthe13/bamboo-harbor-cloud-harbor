import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FRAME_POLICY } from "./privacy.ts";
import {
  AI_CAPABILITIES,
  defaultProvider,
  disabledProvider,
  localFitProvider,
  requestCapability,
  requestFit,
  selectProvider,
  type FitRequest,
} from "./advisor.ts";

const sizes = [
  { label: "Petite", head: [51, 54] as [number, number] },
  { label: "Average", head: [54, 57] as [number, number] },
];

function request(extra: Partial<FitRequest> = {}): FitRequest {
  return {
    productId: "wig-bob",
    sizes,
    measurements: { headCircCm: 55 },
    ...extra,
  };
}

describe("Isibuko AI advisor", () => {
  it("keeps camera frames on the device", () => {
    assert.equal(FRAME_POLICY.externalInference, false);
    assert.equal(FRAME_POLICY.leavesDevice, false);
    assert.deepEqual(AI_CAPABILITIES, ["attributes", "fit", "recommend", "generate"]);
  });

  it("defaults to the disabled provider and can switch to local fit", () => {
    assert.equal(defaultProvider, disabledProvider);
    assert.equal(selectProvider(null).id, disabledProvider.id);
    assert.equal(selectProvider("gemini").id, disabledProvider.id);
    assert.equal(selectProvider(localFitProvider.id), localFitProvider);
    assert.equal(localFitProvider.runsOnDevice, true);
    assert.deepEqual(localFitProvider.capabilities, ["fit"]);
  });

  it("refuses fit help while disabled and does not invent a size", async () => {
    const result = await requestFit(disabledProvider, request());
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "DISABLED");
    assert.equal(result.source, "disabled");
    assert.equal(result.providerId, disabledProvider.id);
  });

  it("explains a local size from measurements already on the device", async () => {
    const result = await requestFit(localFitProvider, request());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.size, "Average");
    assert.equal(result.source, "local-measurements");
    assert.equal(result.providerId, localFitProvider.id);
    assert.match(result.explanation, /No image left the device/);
    assert.match(result.detail, /head 55 cm/);
  });

  it("refuses when no measurement can be compared", async () => {
    const result = await requestFit(localFitProvider, request({ measurements: {} }));
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "MISSING_MEASUREMENTS");
    assert.equal(result.source, "refused");
  });

  it("refuses a camera frame or landmarks without reading them as a fit", async () => {
    const framed = request() as FitRequest & { frame: Uint8Array };
    framed.frame = new Uint8Array([1, 2, 3]);
    const result = await requestFit(localFitProvider, framed);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "FRAMES_REFUSED");
  });

  it("cancels an already aborted request", async () => {
    const signal = AbortSignal.abort();
    const result = await requestFit(localFitProvider, request({ signal }));
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "ABORTED");
  });

  it("times out a provider that never answers", async () => {
    const hanging = {
      id: "isibuko.hang",
      runsOnDevice: true,
      capabilities: ["fit"] as const,
      adviseFit: () => new Promise<never>(() => {}),
    };
    const result = await requestFit(hanging, request({ timeoutMs: 20 }));
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "TIMEOUT");
    assert.match(result.reason, /Nothing was sent/);
  });

  it("refuses attributes, recommendations and generation", async () => {
    for (const capability of ["attributes", "recommend", "generate"] as const) {
      const result = await requestCapability(localFitProvider, capability, request());
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.code, "NOT_AVAILABLE");
      assert.equal(result.capability, capability);
    }
  });
});
