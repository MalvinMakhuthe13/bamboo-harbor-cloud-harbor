/**
 * Isibuko Live AI provider contracts.
 *
 * Photo try-on and live video are intentionally separate capabilities.
 * A photo-only provider must never be presented as a live experience.
 */

export type TryOnCategory =
  | "wig" | "hair" | "nails" | "hat" | "glasses"
  | "clothing" | "jewellery" | "footwear" | "accessories";

export type ProductAsset = {
  id: string;
  category: TryOnCategory;
  asset: string;
  productReference: string;
  rightsConfirmed: boolean;
};

export type PreservationPolicy = {
  preserveIdentity: true;
  preserveUnmaskedRegions: true;
  preserveBackground: boolean;
  preservePose: true;
};

export type PhotoTryOnRequest = {
  mode: "photo";
  image: Blob;
  product: ProductAsset;
  preservation: PreservationPolicy;
  consent: {
    granted: true;
    purpose: "virtual-try-on";
    grantedAt: number;
  };
  signal?: AbortSignal;
};

export type LiveTryOnRequest = {
  mode: "live";
  product: ProductAsset;
  transport: "on-device" | "encrypted-stream";
  consent: {
    granted: true;
    purpose: "live-virtual-try-on";
    grantedAt: number;
  };
};

export type TryOnResult = {
  image: Blob;
  mimeType: string;
  modelId: string;
  modelVersion: string;
  latencyMs: number;
  preservation: {
    identityPreserved: boolean;
    backgroundPreserved: boolean;
  };
};

export type LiveSession = {
  attach(source: MediaStream | HTMLVideoElement): Promise<void>;
  setProduct(product: ProductAsset): Promise<void>;
  close(): Promise<void> | void;
};

export type LiveAiCapabilities = {
  photoTryOn: boolean;
  liveTryOn: boolean;
  supportedCategories: TryOnCategory[];
  runsOnDevice: boolean;
  streamsVideo: boolean;
  modelId: string;
  modelVersion: string;
};

export interface LiveAiProvider {
  readonly capabilities: LiveAiCapabilities;
  transformPhoto(request: PhotoTryOnRequest): Promise<TryOnResult>;
  openLiveSession?(request: LiveTryOnRequest): Promise<LiveSession>;
}

export class LiveAiError extends Error {
  constructor(
    message: string,
    readonly code:
      | "CONSENT_REQUIRED"
      | "ASSET_RIGHTS_REQUIRED"
      | "UNSUPPORTED_CATEGORY"
      | "UNSUPPORTED_MODE"
      | "INVALID_IMAGE",
  ) {
    super(message);
    this.name = "LiveAiError";
  }
}

export function validatePhotoRequest(request: PhotoTryOnRequest): void {
  if (request.consent.granted !== true || !Number.isFinite(request.consent.grantedAt)) {
    throw new LiveAiError("Explicit photo try-on consent is required.", "CONSENT_REQUIRED");
  }
  if (!request.product.rightsConfirmed) {
    throw new LiveAiError("Product image rights must be confirmed.", "ASSET_RIGHTS_REQUIRED");
  }
  if (request.image.size === 0 || !request.image.type.startsWith("image/")) {
    throw new LiveAiError("A valid image is required.", "INVALID_IMAGE");
  }
}

export function assertLiveSupported(
  provider: LiveAiProvider,
): asserts provider is LiveAiProvider & {
  openLiveSession: NonNullable<LiveAiProvider["openLiveSession"]>;
} {
  if (!provider.capabilities.liveTryOn || !provider.openLiveSession) {
    throw new LiveAiError(
      "This provider does not support genuine live video try-on.",
      "UNSUPPORTED_MODE",
    );
  }
}
