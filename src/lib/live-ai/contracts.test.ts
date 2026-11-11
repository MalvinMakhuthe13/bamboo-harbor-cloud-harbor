import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertLiveSupported,
  LiveAiError,
  validatePhotoRequest,
  type LiveAiProvider,
  type PhotoTryOnRequest,
} from "./contracts.ts";

const validRequest: PhotoTryOnRequest = {
  mode: "photo",
  image: new Blob(["photo"], { type: "image/jpeg" }),
  product: {
    id: "sample-wig-001",
    category: "wig",
    asset: "/products/sample-wig-001.jpg",
    productReference: "merchant-sku-001",
    rightsConfirmed: true,
  },
  preservation: {
    preserveIdentity: true,
    preserveUnmaskedRegions: true,
    preserveBackground: true,
    preservePose: true,
  },
  consent: {
    granted: true,
    purpose: "virtual-try-on",
    grantedAt: 1,
  },
};

describe("Isibuko Live AI contracts", () => {
  it("accepts an explicitly consented, rights-cleared photo request", () => {
    assert.doesNotThrow(() => validatePhotoRequest(validRequest));
  });

  it("rejects requests without explicit consent", () => {
    const request = {
      ...validRequest,
      consent: { ...validRequest.consent, granted: false as true },
    };
    assert.throws(
      () => validatePhotoRequest(request),
      (error: unknown) => error instanceof LiveAiError && error.code === "CONSENT_REQUIRED",
    );
  });

  it("rejects product assets without confirmed usage rights", () => {
    const request = {
      ...validRequest,
      product: { ...validRequest.product, rightsConfirmed: false },
    };
    assert.throws(
      () => validatePhotoRequest(request),
      (error: unknown) => error instanceof LiveAiError && error.code === "ASSET_RIGHTS_REQUIRED",
    );
  });

  it("rejects non-image uploads", () => {
    const request = {
      ...validRequest,
      image: new Blob(["not an image"], { type: "text/plain" }),
    };
    assert.throws(
      () => validatePhotoRequest(request),
      (error: unknown) => error instanceof LiveAiError && error.code === "INVALID_IMAGE",
    );
  });

  it("never advertises a photo-only provider as live video", () => {
    const provider = {
      capabilities: {
        photoTryOn: true,
        liveTryOn: false,
        supportedCategories: ["wig"],
        runsOnDevice: false,
        streamsVideo: false,
        modelId: "isibuko-photo-baseline",
        modelVersion: "0.1.0",
      },
      transformPhoto: async () => {
        throw new Error("Not called by this test");
      },
    } satisfies LiveAiProvider;

    assert.throws(
      () => assertLiveSupported(provider),
      (error: unknown) => error instanceof LiveAiError && error.code === "UNSUPPORTED_MODE",
    );
  });
});

