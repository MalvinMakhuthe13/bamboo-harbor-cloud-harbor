import assert from "node:assert/strict";
import test from "node:test";
import {
  assertModelCanRun,
  TryOnError,
  validateConsent,
  type ModelDescriptor,
  type TryOnModelAdapter,
  type StillTryOnRequest,
} from "./contracts.ts";
import { TryOnModelRegistry } from "./registry.ts";

const descriptor = (overrides: Partial<ModelDescriptor> = {}): ModelDescriptor => ({
  id: "fixture-model",
  version: "0.0.1",
  displayName: "Fixture model",
  owner: "isibuko",
  licence: {
    code: "MIT",
    weights: "MIT",
    trainingData: "owned",
    commercialStatus: "verified-commercial",
    evidence: ["fixture-only"],
    reviewedAt: "2026-11-11",
  },
  processing: "on-device",
  capabilities: ["still-image"],
  categories: ["shirt"],
  availability: "available",
  weightsPresent: true,
  runtimeVerified: true,
  benchmark: {
    hardware: null,
    inputWidth: null,
    inputHeight: null,
    medianLatencyMs: null,
    p95LatencyMs: null,
    sustainedFps: null,
    measuredAt: null,
  },
  ...overrides,
});

const consent = {
  camera: true as const,
  generativeProcessing: true as const,
  remoteProcessing: false,
  providerDisclosureAccepted: false,
  trainingOptIn: false as const,
  consentedAt: "2026-11-11T00:00:00.000Z",
  policyVersion: "test",
};

const request = (): StillTryOnRequest => ({
  kind: "still-image",
  requestId: "test-request",
  personImage: new Blob(["person"]),
  productImage: new Blob(["garment"]),
  person: { sessionRef: "ephemeral-test", frameWidth: 512, frameHeight: 768 },
  product: {
    sku: "shirt-test",
    category: "shirt",
    assetRef: "merchant-asset-v1",
    assetMimeType: "image/jpeg",
  },
  consent,
  output: { width: 512, height: 768 },
});

test("remote inference requires separate provider disclosure and consent", () => {
  assert.throws(
    () => validateConsent({ ...consent, remoteProcessing: false }, "third-party"),
    (error: unknown) => error instanceof TryOnError && error.code === "REMOTE_CONSENT_REQUIRED",
  );
});

test("model execution rejects non-commercially-cleared weights", () => {
  const model = descriptor({
    licence: {
      ...descriptor().licence,
      commercialStatus: "research-only",
    },
  });
  assert.throws(
    () => assertModelCanRun(model, request()),
    (error: unknown) => error instanceof TryOnError && error.code === "LICENCE_NOT_CLEARED",
  );
});

test("model execution rejects a category the model does not support", () => {
  const model = descriptor({ categories: ["wig"] });
  assert.throws(
    () => assertModelCanRun(model, request()),
    (error: unknown) => error instanceof TryOnError && error.code === "UNSUPPORTED_CATEGORY",
  );
});

test("registry refuses a model without installed weights", () => {
  const registry = new TryOnModelRegistry();
  const adapter: TryOnModelAdapter = {
    descriptor: descriptor({ weightsPresent: false, availability: "weights-missing" }),
    async generate() {
      throw new Error("Must never be called");
    },
  };
  assert.throws(
    () => registry.register(adapter),
    (error: unknown) => error instanceof TryOnError && error.code === "MODEL_NOT_AVAILABLE",
  );
});

test("registry starts empty; a candidate card is not a running model", () => {
  assert.equal(new TryOnModelRegistry().list().length, 0);
});
