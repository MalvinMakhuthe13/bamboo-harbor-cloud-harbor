/** Stable contracts for Isibuko's generative try-on engines.
 *
 * These types describe the boundary only. They do not imply that a model is
 * installed, commercially cleared, trained, or capable of real-time video.
 */

export type ModelOwner = "isibuko" | "third-party";
export type ModelLicenseStatus =
  | "verified-commercial"
  | "restricted"
  | "research-only"
  | "unknown";
export type ProcessingRoute = "on-device" | "self-hosted" | "third-party";
export type MediaCapability = "still-image" | "video-clip" | "streaming-video";
export type TryOnCategory =
  | "shirt"
  | "jacket"
  | "dress"
  | "trousers"
  | "skirt"
  | "wig"
  | "glasses"
  | "hat"
  | "jewellery"
  | "watch"
  | "ring"
  | "nails";

export type ModelAvailability =
  | "available"
  | "weights-missing"
  | "runtime-missing"
  | "not-approved"
  | "disabled";

export type ModelDescriptor = {
  id: string;
  version: string;
  displayName: string;
  owner: ModelOwner;
  licence: {
    code: string;
    weights: string;
    trainingData: string;
    commercialStatus: ModelLicenseStatus;
    evidence: string[];
    reviewedAt: string | null;
  };
  processing: ProcessingRoute;
  capabilities: MediaCapability[];
  categories: TryOnCategory[];
  availability: ModelAvailability;
  weightsPresent: boolean;
  runtimeVerified: boolean;
  /** Measured values only. Null means not measured on named hardware. */
  benchmark: {
    hardware: string | null;
    inputWidth: number | null;
    inputHeight: number | null;
    medianLatencyMs: number | null;
    p95LatencyMs: number | null;
    sustainedFps: number | null;
    measuredAt: string | null;
  };
};

export type ConsentReceipt = {
  camera: true;
  generativeProcessing: true;
  remoteProcessing: boolean;
  providerDisclosureAccepted: boolean;
  trainingOptIn: false;
  consentedAt: string;
  policyVersion: string;
};

export type PersonCondition = {
  /** Ephemeral session reference; do not put a person's name or account id here. */
  sessionRef: string;
  frameWidth: number;
  frameHeight: number;
  pose?: Record<string, { x: number; y: number; confidence: number }>;
  personMask?: Uint8Array;
  garmentRegionMask?: Uint8Array;
  handOcclusionMask?: Uint8Array;
  protectedRegionMask?: Uint8Array;
};

export type ProductCondition = {
  sku: string;
  category: TryOnCategory;
  /** Immutable merchant asset identifier/version, not a scraped page URL. */
  assetRef: string;
  assetMimeType: "image/jpeg" | "image/png" | "image/webp";
  colourName?: string;
  fabric?: string;
  cut?: string;
  variantId?: string;
  merchantAttributes?: Record<string, string | number | boolean>;
};

export type StillTryOnRequest = {
  kind: "still-image";
  requestId: string;
  personImage: Blob;
  productImage: Blob;
  person: PersonCondition;
  product: ProductCondition;
  consent: ConsentReceipt;
  output: { width: number; height: number };
};

export type VideoTryOnRequest = {
  kind: "video-clip";
  requestId: string;
  /** Ordered frames from one short clip; the product condition is fixed for all frames. */
  frames: Blob[];
  timestampsMs: number[];
  person: PersonCondition;
  product: ProductCondition;
  consent: ConsentReceipt;
  output: { width: number; height: number; fps: number };
};

export type TryOnRequest = StillTryOnRequest | VideoTryOnRequest;

export type ModelProvenance = {
  modelId: string;
  modelVersion: string;
  owner: ModelOwner;
  licenceStatus: ModelLicenseStatus;
  processing: ProcessingRoute;
  generatedAt: string;
  requestId: string;
  productSku: string;
  productAssetRef: string;
};

export type GeneratedStill = {
  kind: "still-image";
  image: Blob;
  width: number;
  height: number;
  provenance: ModelProvenance;
};

export type GeneratedClip = {
  kind: "video-clip";
  frames: Blob[];
  timestampsMs: number[];
  width: number;
  height: number;
  fps: number;
  provenance: ModelProvenance;
};

export type TryOnOutput = GeneratedStill | GeneratedClip;

export type TryOnErrorCode =
  | "MODEL_NOT_REGISTERED"
  | "MODEL_NOT_AVAILABLE"
  | "WEIGHTS_MISSING"
  | "RUNTIME_MISSING"
  | "LICENCE_NOT_CLEARED"
  | "CONSENT_REQUIRED"
  | "REMOTE_CONSENT_REQUIRED"
  | "UNSUPPORTED_CATEGORY"
  | "UNSUPPORTED_MEDIA"
  | "INVALID_PRODUCT_ASSET"
  | "INVALID_PERSON_INPUT"
  | "INVALID_VIDEO_SEQUENCE"
  | "RESOURCE_LIMIT"
  | "INFERENCE_TIMEOUT"
  | "INFERENCE_FAILED";

export class TryOnError extends Error {
  readonly code: TryOnErrorCode;
  readonly retryable: boolean;

  constructor(code: TryOnErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "TryOnError";
    this.code = code;
    this.retryable = retryable;
  }
}

export interface TryOnModelAdapter {
  readonly descriptor: ModelDescriptor;
  generate(request: TryOnRequest): Promise<TryOnOutput>;
}

/** Only explicit user consent permits remote processing. Training is never implied. */
export function validateConsent(consent: ConsentReceipt, processing: ProcessingRoute): void {
  if (!consent.camera || !consent.generativeProcessing) {
    throw new TryOnError("CONSENT_REQUIRED", "The shopper must consent to camera and generative processing.");
  }
  if (processing === "third-party" && (!consent.remoteProcessing || !consent.providerDisclosureAccepted)) {
    throw new TryOnError(
      "REMOTE_CONSENT_REQUIRED",
      "The shopper must separately accept the disclosed third-party processing route.",
    );
  }
  if (consent.trainingOptIn !== false) {
    throw new TryOnError(
      "CONSENT_REQUIRED",
      "Try-on consent cannot be reused as training consent. Training requires a separate flow.",
    );
  }
}

/** Reject unsupported claims before the adapter can be invoked. */
export function assertModelCanRun(
  descriptor: ModelDescriptor,
  request: TryOnRequest,
): void {
  if (descriptor.availability !== "available") {
    throw new TryOnError("MODEL_NOT_AVAILABLE", `${descriptor.id} is ${descriptor.availability}.`);
  }
  if (!descriptor.weightsPresent) {
    throw new TryOnError("WEIGHTS_MISSING", `${descriptor.id} has no verified weights installed.`);
  }
  if (!descriptor.runtimeVerified) {
    throw new TryOnError("RUNTIME_MISSING", `${descriptor.id} runtime has not been verified.`);
  }
  if (descriptor.licence.commercialStatus !== "verified-commercial") {
    throw new TryOnError("LICENCE_NOT_CLEARED", `${descriptor.id} is not cleared for commercial use.`);
  }
  if (!descriptor.categories.includes(request.product.category)) {
    throw new TryOnError("UNSUPPORTED_CATEGORY", `${descriptor.id} does not support ${request.product.category}.`);
  }
  const capability: MediaCapability = request.kind;
  if (!descriptor.capabilities.includes(capability)) {
    throw new TryOnError("UNSUPPORTED_MEDIA", `${descriptor.id} does not support ${request.kind}.`);
  }
  validateConsent(request.consent, descriptor.processing);
  if (request.product.assetRef.trim().length === 0) {
    throw new TryOnError("INVALID_PRODUCT_ASSET", "A stable merchant product asset reference is required.");
  }
  if (request.kind === "video-clip") {
    if (request.frames.length < 2 || request.timestampsMs.length !== request.frames.length) {
      throw new TryOnError("INVALID_VIDEO_SEQUENCE", "Video frames and timestamps must have matching lengths of at least two.");
    }
    for (let i = 1; i < request.timestampsMs.length; i++) {
      if (request.timestampsMs[i]! <= request.timestampsMs[i - 1]!) {
        throw new TryOnError("INVALID_VIDEO_SEQUENCE", "Video timestamps must be strictly increasing.");
      }
    }
  }
}
