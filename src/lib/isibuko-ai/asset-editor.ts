import { validateProductFittingAnchors, type AlphaGeometry } from "./anchors.ts";
import { sizeScaleFor } from "./fit.ts";
import type { GarmentAssetPlan } from "./garment-asset.ts";
import { ASSET_DRAFT_IMAGE_KEY, isQuotaError, type LocalImageStore } from "./local-image-db.ts";
import { buildCustomProduct } from "./merchant.ts";
import { bytesToProductDataUrl, parseProductDataUrl, type ProductImageMime } from "./privacy.ts";
import type {
  Category,
  FrameRequest,
  Product,
  ProductAnchorPoint,
  ProductFittingAnchors,
} from "./types.ts";
import type { StorageLike } from "./wardrobe-storage.ts";

export type GarmentImageAnchorGuide = {
  label: string;
  imageHint: string;
  bodyTarget: string;
};

export const GARMENT_IMAGE_ANCHOR_GUIDE: Record<string, GarmentImageAnchorGuide> = {
  shoulderL: {
    label: "Garment left shoulder",
    imageHint: "Left shoulder seam on the product photo",
    bodyTarget: "Maps to wearer left shoulder",
  },
  shoulderR: {
    label: "Garment right shoulder",
    imageHint: "Right shoulder seam on the product photo",
    bodyTarget: "Maps to wearer right shoulder",
  },
  hipL: {
    label: "Garment left waist / hip",
    imageHint: "Left waist or hip edge on the product photo",
    bodyTarget: "Maps to wearer left hip",
  },
  hipR: {
    label: "Garment right waist / hip",
    imageHint: "Right waist or hip edge on the product photo",
    bodyTarget: "Maps to wearer right hip",
  },
  elbowL: {
    label: "Left sleeve elbow",
    imageHint: "Mid-point of left sleeve on the product photo",
    bodyTarget: "Maps to wearer left elbow",
  },
  elbowR: {
    label: "Right sleeve elbow",
    imageHint: "Mid-point of right sleeve on the product photo",
    bodyTarget: "Maps to wearer right elbow",
  },
  wristL: {
    label: "Left sleeve cuff",
    imageHint: "Cuff end of left sleeve on the product photo",
    bodyTarget: "Maps to wearer left wrist",
  },
  wristR: {
    label: "Right sleeve cuff",
    imageHint: "Cuff end of right sleeve on the product photo",
    bodyTarget: "Maps to wearer right wrist",
  },
  kneeL: {
    label: "Left hem / knee point",
    imageHint: "Left knee or lower hem edge on the product photo",
    bodyTarget: "Maps to wearer left knee",
  },
  kneeR: {
    label: "Right hem / knee point",
    imageHint: "Right knee or lower hem edge on the product photo",
    bodyTarget: "Maps to wearer right knee",
  },
  ankleL: {
    label: "Left trouser / hem end",
    imageHint: "Left ankle cuff or lowest hem edge on the product photo",
    bodyTarget: "Maps to wearer left ankle",
  },
  ankleR: {
    label: "Right trouser / hem end",
    imageHint: "Right ankle cuff or lowest hem edge on the product photo",
    bodyTarget: "Maps to wearer right ankle",
  },
  forehead: {
    label: "Crown / hairline edge",
    imageHint: "Front hairline or brim top on the product photo",
    bodyTarget: "Maps to wearer forehead",
  },
  chin: {
    label: "Lower framing edge",
    imageHint: "Bottom framing line on the product photo",
    bodyTarget: "Maps to wearer chin",
  },
  cheekL: {
    label: "Left temple / side edge",
    imageHint: "Left outer side of headwear on the product photo",
    bodyTarget: "Maps to wearer left cheek",
  },
  cheekR: {
    label: "Right temple / side edge",
    imageHint: "Right outer side of headwear on the product photo",
    bodyTarget: "Maps to wearer right cheek",
  },
  eyeL: {
    label: "Left lens centre",
    imageHint: "Centre of left lens on the eyewear photo",
    bodyTarget: "Maps to wearer left eye",
  },
  eyeR: {
    label: "Right lens centre",
    imageHint: "Centre of right lens on the eyewear photo",
    bodyTarget: "Maps to wearer right eye",
  },
  noseBridge: {
    label: "Bridge centre",
    imageHint: "Nose bridge on the eyewear photo",
    bodyTarget: "Maps to wearer nose bridge",
  },
  temples: {
    label: "Frame temple span",
    imageHint: "Outer frame hinge on the product photo",
    bodyTarget: "Maps to wearer temples",
  },
  earL: {
    label: "Left earring drop",
    imageHint: "Left hook/post on the jewellery photo",
    bodyTarget: "Maps to wearer left ear",
  },
  earR: {
    label: "Right earring drop",
    imageHint: "Right hook/post on the jewellery photo",
    bodyTarget: "Maps to wearer right ear",
  },
  neckBase: {
    label: "Collar / pendant top",
    imageHint: "Top clasp or collar centre on the photo",
    bodyTarget: "Maps to wearer neck base",
  },
  wrist: {
    label: "Strap / cuff centre",
    imageHint: "Centre of watch or bracelet band on the photo",
    bodyTarget: "Maps to wearer wrist",
  },
  elbow: {
    label: "Forearm axis reference",
    imageHint: "Upper strap orientation reference on the photo",
    bodyTarget: "Aligns with wearer forearm",
  },
  fingerBase: {
    label: "Band / cuticle base",
    imageHint: "Base of ring or nail plate on the photo",
    bodyTarget: "Maps to wearer finger base",
  },
  fingerTip: {
    label: "Nail / ring tip",
    imageHint: "Outer tip edge on the product photo",
    bodyTarget: "Maps to wearer finger tip",
  },
};

export function describeGarmentImageAnchor(key: string): GarmentImageAnchorGuide & { key: string } {
  const known = GARMENT_IMAGE_ANCHOR_GUIDE[key];
  if (known) return { key, ...known };
  return {
    key,
    label: `Product anchor (${key})`,
    imageHint: "Click the matching position on the product photograph",
    bodyTarget: `Maps to wearer ${key}`,
  };
}

export function validateAssetImageBytes(
  bytes: Uint8Array,
):
  | { ok: true; mime: ProductImageMime; size: number; dataUrl: string }
  | { ok: false; reason: string } {
  return bytesToProductDataUrl(bytes);
}

export function validateAssetDataUrl(
  dataUrl: string,
):
  | { ok: true; mime: ProductImageMime; size: number; bytes: Uint8Array }
  | { ok: false; reason: string } {
  return parseProductDataUrl(dataUrl);
}

export type AssetEditorProductInput = {
  name: string;
  category: Category;
  imageDataUrl: string | null;
  anchors: Record<string, ProductAnchorPoint>;
  id?: string;
};

export function buildAssetEditorProduct(
  input: AssetEditorProductInput,
): { ok: true; product: Product } | { ok: false; errors: string[] } {
  if (!input.imageDataUrl) {
    return {
      ok: false,
      errors: [
        "Choose a local PNG, JPEG, or WebP product photograph before adding to the wardrobe.",
      ],
    };
  }
  const parsed = parseProductDataUrl(input.imageDataUrl);
  if (!parsed.ok) {
    return { ok: false, errors: [parsed.reason] };
  }
  const fittingAnchors: ProductFittingAnchors = {
    version: "isibuko.anchors/1",
    points: input.anchors,
  };
  if (!validateProductFittingAnchors(fittingAnchors)) {
    return {
      ok: false,
      errors: ["Garment-image fitting anchors must stay within normalized 0..1 image coordinates."],
    };
  }
  const id = input.id ?? `custom-asset-${Date.now()}`;
  return buildCustomProduct(
    {
      name: input.name,
      category: input.category,
      priceZar: undefined,
      fabric: "",
      colourName: "",
      colourHex: "",
      merchantUrl: "",
      image: input.imageDataUrl,
      imageType: parsed.mime,
      imageBytes: parsed.size,
      fittingAnchors,
    },
    id,
  );
}

export function createMirrorFrameRequest(
  product: Product,
  options: { swatchId?: string; sizeLabel?: string | null; heightCm?: number } = {},
): FrameRequest {
  const swatch =
    product.swatches.find((item) => item.id === options.swatchId) ?? product.swatches[0];
  const sizeLabel = options.sizeLabel ?? product.sizes[0]?.label ?? null;
  return {
    productId: product.id,
    category: product.category,
    image: product.image,
    tint: swatch?.tint ?? null,
    sizeScale: sizeScaleFor(sizeLabel),
    nail: product.nail,
    heightCm: options.heightCm ?? 170,
    fittingAnchors: product.fittingAnchors,
  };
}

export const ASSET_DRAFT_VERSION = "isibuko.asset-draft/1" as const;

const VALID_CATEGORIES = new Set<Category>([
  "shirt",
  "jacket",
  "dress",
  "pants",
  "skirt",
  "wig",
  "hat",
  "glasses",
  "earrings",
  "necklace",
  "watch",
  "bracelet",
  "ring",
  "nails",
]);

const VALID_MIMES = new Set<ProductImageMime>(["image/png", "image/jpeg", "image/webp"]);

export type StoredAssetDraft = {
  version: typeof ASSET_DRAFT_VERSION;
  name: string;
  category: Category;
  sourceImage: string;
  imageIncluded?: boolean;
  imageRef?: "indexeddb";
  imageSize: { width: number; height: number };
  imageType?: ProductImageMime | null;
  imageBytes?: number;
  imageDataUrl?: string | null;
  alphaGeometry: AlphaGeometry | null;
  preparation: GarmentAssetPlan | null;
  fittingAnchors: ProductFittingAnchors;
  savedAt?: string;
};

export type AssetSidecarExpectation = {
  sourceImage: string;
  imageType: ProductImageMime | null;
  imageBytes: number;
  imageSize: { width: number; height: number };
};

export function buildAssetExportPayload(input: {
  name: string;
  category: Category;
  sourceImage: string;
  imageSize: { width: number; height: number };
  imageType: ProductImageMime;
  imageBytes: number;
  alphaGeometry: AlphaGeometry;
  preparation: GarmentAssetPlan | null;
  anchors: Record<string, ProductAnchorPoint>;
}): StoredAssetDraft {
  const clonedPoints: Record<string, ProductAnchorPoint> = {};
  for (const [key, point] of Object.entries(input.anchors)) {
    clonedPoints[key] = {
      x: point.x,
      y: point.y,
      ...(point.confidence !== undefined ? { confidence: point.confidence } : {}),
    };
  }
  return {
    version: ASSET_DRAFT_VERSION,
    name: input.name.trim(),
    category: input.category,
    sourceImage: input.sourceImage,
    imageIncluded: false,
    imageSize: { width: input.imageSize.width, height: input.imageSize.height },
    imageType: input.imageType,
    imageBytes: input.imageBytes,
    alphaGeometry: input.alphaGeometry,
    preparation: input.preparation,
    fittingAnchors: {
      version: "isibuko.anchors/1",
      points: clonedPoints,
    },
  };
}

function isValidAlphaGeometry(value: unknown): value is AlphaGeometry {
  if (!value || typeof value !== "object") return false;
  const g = value as AlphaGeometry;
  if (g.version !== "isibuko.anchors/1") return false;
  if (!Number.isFinite(g.alphaCoverage) || g.alphaCoverage < 0 || g.alphaCoverage > 1) return false;
  if (!Number.isFinite(g.confidence) || g.confidence < 0 || g.confidence > 1) return false;
  if (!Array.isArray(g.silhouette)) return false;
  if (g.bounds !== null) {
    if (!g.bounds || typeof g.bounds !== "object") return false;
    const { left, top, right, bottom } = g.bounds;
    if (
      ![left, top, right, bottom].every(
        (n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1,
      ) ||
      left > right ||
      top > bottom
    ) {
      return false;
    }
  }
  return true;
}

export function parseAssetDraftJson(
  rawText: string,
):
  { ok: true; draft: StoredAssetDraft; hasEmbeddedImage: boolean } | { ok: false; reason: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(rawText);
  } catch {
    return { ok: false, reason: "The JSON file is malformed and could not be parsed." };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "Asset metadata must be a JSON object." };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.version !== ASSET_DRAFT_VERSION) {
    return {
      ok: false,
      reason: `Unsupported asset metadata version. Expected "${ASSET_DRAFT_VERSION}".`,
    };
  }
  if (typeof obj.name !== "string") {
    return { ok: false, reason: "Asset metadata must include a string product name." };
  }
  if (typeof obj.category !== "string" || !VALID_CATEGORIES.has(obj.category as Category)) {
    return { ok: false, reason: "Asset metadata contains an unknown or missing garment category." };
  }
  if (typeof obj.sourceImage !== "string") {
    return { ok: false, reason: "Asset metadata is missing sourceImage metadata." };
  }

  const size = obj.imageSize as { width?: unknown; height?: unknown } | null | undefined;
  if (
    !size ||
    typeof size !== "object" ||
    typeof size.width !== "number" ||
    typeof size.height !== "number" ||
    !Number.isInteger(size.width) ||
    !Number.isInteger(size.height) ||
    size.width < 1 ||
    size.height < 1
  ) {
    return { ok: false, reason: "Asset metadata has invalid imageSize dimensions." };
  }

  let imageType: ProductImageMime | null = null;
  if (obj.imageType !== undefined && obj.imageType !== null) {
    if (typeof obj.imageType !== "string" || !VALID_MIMES.has(obj.imageType as ProductImageMime)) {
      return {
        ok: false,
        reason:
          "Unsupported imageType in metadata. Only image/png, image/jpeg, and image/webp are accepted.",
      };
    }
    imageType = obj.imageType as ProductImageMime;
  }

  let imageBytes = 0;
  if (obj.imageBytes !== undefined && obj.imageBytes !== null) {
    if (
      typeof obj.imageBytes !== "number" ||
      !Number.isInteger(obj.imageBytes) ||
      obj.imageBytes < 0 ||
      obj.imageBytes > 1_500_000
    ) {
      return { ok: false, reason: "Asset metadata has an invalid imageBytes value." };
    }
    imageBytes = obj.imageBytes;
  }

  if (!validateProductFittingAnchors(obj.fittingAnchors)) {
    return {
      ok: false,
      reason:
        "Asset metadata fittingAnchors are invalid or outside normalized 0..1 image coordinates.",
    };
  }

  if (
    obj.alphaGeometry !== null &&
    obj.alphaGeometry !== undefined &&
    !isValidAlphaGeometry(obj.alphaGeometry)
  ) {
    return { ok: false, reason: "Asset metadata contains invalid alphaGeometry data." };
  }

  let imageDataUrl: string | null = null;
  if (obj.imageDataUrl !== undefined && obj.imageDataUrl !== null) {
    if (typeof obj.imageDataUrl !== "string") {
      return { ok: false, reason: "Embedded imageDataUrl must be a string." };
    }
    const parsedImage = parseProductDataUrl(obj.imageDataUrl);
    if (!parsedImage.ok) {
      return { ok: false, reason: `Embedded imageDataUrl is invalid: ${parsedImage.reason}` };
    }
    if (imageType && imageType !== parsedImage.mime) {
      return {
        ok: false,
        reason: `Embedded image bytes (${parsedImage.mime}) do not match declared imageType (${imageType}).`,
      };
    }
    if (imageBytes > 0 && imageBytes !== parsedImage.size) {
      return {
        ok: false,
        reason: `Embedded image byte size (${parsedImage.size}) does not match declared imageBytes (${imageBytes}).`,
      };
    }
    imageDataUrl = obj.imageDataUrl;
    imageType = parsedImage.mime;
    imageBytes = parsedImage.size;
  } else if (obj.imageIncluded === true) {
    return {
      ok: false,
      reason: "Metadata declares an embedded image, but imageDataUrl is missing.",
    };
  } else if (obj.imageIncluded === false && !imageType) {
    return {
      ok: false,
      reason:
        "Sidecar metadata must declare imageType (image/png, image/jpeg, or image/webp) when the image is excluded.",
    };
  }

  const normalizedDraft: StoredAssetDraft = {
    version: ASSET_DRAFT_VERSION,
    name: obj.name,
    category: obj.category as Category,
    sourceImage: obj.sourceImage,
    imageIncluded: Boolean(imageDataUrl),
    ...(obj.imageRef === "indexeddb" ? { imageRef: "indexeddb" as const } : {}),
    imageSize: { width: size.width, height: size.height },
    imageType,
    imageBytes,
    imageDataUrl,
    alphaGeometry: (obj.alphaGeometry as AlphaGeometry | null | undefined) ?? null,
    preparation: (obj.preparation as GarmentAssetPlan | null | undefined) ?? null,
    fittingAnchors: obj.fittingAnchors,
    ...(typeof obj.savedAt === "string" ? { savedAt: obj.savedAt } : {}),
  };

  return {
    ok: true,
    draft: normalizedDraft,
    hasEmbeddedImage: Boolean(imageDataUrl),
  };
}

export function checkReattachedImageCompatibility(
  expected: AssetSidecarExpectation,
  actual: { mime: ProductImageMime; size: number; width: number; height: number },
): { ok: true; warning: string | null } | { ok: false; reason: string } {
  if (expected.imageType && actual.mime !== expected.imageType) {
    return {
      ok: false,
      reason: `The imported sidecar expects a ${expected.imageType} photograph, but the selected file is ${actual.mime}. Your imported anchors were preserved so you can pick the matching file.`,
    };
  }
  if (
    expected.imageSize.width > 0 &&
    expected.imageSize.height > 0 &&
    (actual.width !== expected.imageSize.width || actual.height !== expected.imageSize.height)
  ) {
    return {
      ok: true,
      warning: `Reattached ${actual.mime} is ${actual.width}×${actual.height} px, while the sidecar recorded ${expected.imageSize.width}×${expected.imageSize.height} px. Imported anchors were preserved — confirm the dots align with the garment seams.`,
    };
  }
  if (expected.imageBytes > 0 && actual.size !== expected.imageBytes) {
    return {
      ok: true,
      warning: `Reattached ${actual.mime} matches the ${actual.width}×${actual.height} px dimensions, though byte size differs (${actual.size.toLocaleString()} vs ${expected.imageBytes.toLocaleString()} bytes). Imported anchors were preserved.`,
    };
  }
  return { ok: true, warning: null };
}

export const ASSET_DRAFT_STORAGE_KEY = "isibuko-garment-asset-draft-v1";

export type PersistAssetDraftResult =
  | {
      ok: true;
      draft: StoredAssetDraft;
      imageLocation: "indexeddb" | "localstorage";
      warning: string | null;
      message: string;
    }
  | {
      ok: false;
      reason: "quota" | "storage-unavailable" | "memory-only" | "write-failed";
      message: string;
    };

export async function persistAssetDraft(
  input: {
    name: string;
    category: Category;
    sourceImage: string;
    imageSize: { width: number; height: number };
    imageType: ProductImageMime;
    imageBytes: number;
    imageDataUrl: string;
    alphaGeometry: AlphaGeometry | null;
    preparation: GarmentAssetPlan | null;
    anchors: Record<string, ProductAnchorPoint>;
  },
  deps: {
    storage: StorageLike | null;
    imageStore: LocalImageStore;
    storageKey?: string;
    imageKey?: string;
  },
): Promise<PersistAssetDraftResult> {
  const storageKey = deps.storageKey ?? ASSET_DRAFT_STORAGE_KEY;
  const imageKey = deps.imageKey ?? ASSET_DRAFT_IMAGE_KEY;
  const { storage, imageStore } = deps;

  let storedInDb = false;
  let prevIdbDraftUrl: string | null = null;
  let hadPrevLookup = false;
  let idbFallbackReason: string | null = null;

  if (imageStore.kind === "indexeddb") {
    const prevRead = await imageStore.readImage(imageKey);
    if (prevRead.ok) {
      prevIdbDraftUrl = prevRead.dataUrl;
      hadPrevLookup = true;
    }
    const writeRes = await imageStore.writeImage(imageKey, input.imageDataUrl);
    if (writeRes.ok) {
      storedInDb = true;
    } else {
      idbFallbackReason = writeRes.message;
    }
  } else if (imageStore.kind === "memory") {
    await imageStore.writeImage(imageKey, input.imageDataUrl);
    idbFallbackReason = "In-memory image fallback does not persist across page reloads.";
  } else {
    idbFallbackReason = "IndexedDB is unavailable in this browser.";
  }

  async function rollbackDraftIdb() {
    if (!storedInDb) return;
    if (hadPrevLookup && prevIdbDraftUrl !== null) {
      await imageStore.writeImage(imageKey, prevIdbDraftUrl);
    } else {
      await imageStore.removeImage(imageKey);
    }
  }

  if (!storage) {
    await rollbackDraftIdb();
    if (imageStore.kind === "memory") {
      return {
        ok: false,
        reason: "memory-only",
        message:
          "Browser storage is unavailable; the draft photograph only exists in memory and could not be saved across reloads. Export a .asset.json file to keep your anchors.",
      };
    }
    return {
      ok: false,
      reason: "storage-unavailable",
      message: "Browser localStorage is unavailable; the draft could not be saved.",
    };
  }

  const draft: StoredAssetDraft = {
    version: ASSET_DRAFT_VERSION,
    name: input.name.trim(),
    category: input.category,
    sourceImage: input.sourceImage,
    imageIncluded: !storedInDb,
    ...(storedInDb ? { imageRef: "indexeddb" as const } : {}),
    imageSize: input.imageSize,
    imageType: input.imageType,
    imageBytes: input.imageBytes,
    imageDataUrl: storedInDb ? null : input.imageDataUrl,
    alphaGeometry: input.alphaGeometry,
    preparation: input.preparation,
    fittingAnchors: {
      version: "isibuko.anchors/1",
      points: input.anchors,
    },
    savedAt: new Date().toISOString(),
  };

  try {
    storage.setItem(storageKey, JSON.stringify(draft));
  } catch (error) {
    await rollbackDraftIdb();
    if (isQuotaError(error)) {
      return {
        ok: false,
        reason: "quota",
        message: idbFallbackReason
          ? `Could not save draft: ${idbFallbackReason} and browser localStorage quota was exceeded. Remove older wardrobe pieces or export a .asset.json sidecar instead.`
          : "Browser storage quota was exceeded; the draft and photograph were not saved. Remove older wardrobe pieces or export a .asset.json sidecar instead.",
      };
    }
    return {
      ok: false,
      reason: "write-failed",
      message:
        error instanceof Error
          ? `Could not save the draft in this browser: ${error.message}`
          : "Could not save the draft in this browser.",
    };
  }

  if (storedInDb) {
    return {
      ok: true,
      draft,
      imageLocation: "indexeddb",
      warning: null,
      message: "Draft metadata saved in localStorage and photograph saved in IndexedDB.",
    };
  }

  const warning =
    imageStore.kind === "memory"
      ? "In-memory image store is not durable; photograph and draft were saved in localStorage instead."
      : `${idbFallbackReason ?? "IndexedDB is unavailable."} Photograph and draft were saved in localStorage instead.`;

  return {
    ok: true,
    draft,
    imageLocation: "localstorage",
    warning,
    message: "Draft and photograph saved in browser localStorage (IndexedDB fallback).",
  };
}

export type LoadSavedAssetDraftResult =
  | { ok: false; empty: true }
  | { ok: false; empty: false; reason: string }
  | {
      ok: true;
      draft: StoredAssetDraft;
      storedImage: string | null;
      missingIdbImage: boolean;
      warning: string | null;
    };

export async function loadSavedAssetDraft(deps: {
  storage: StorageLike | null;
  imageStore: LocalImageStore;
  storageKey?: string;
  imageKey?: string;
}): Promise<LoadSavedAssetDraftResult> {
  const storageKey = deps.storageKey ?? ASSET_DRAFT_STORAGE_KEY;
  const imageKey = deps.imageKey ?? ASSET_DRAFT_IMAGE_KEY;
  if (!deps.storage) return { ok: false, empty: true };
  let raw: string | null = null;
  try {
    raw = deps.storage.getItem(storageKey);
  } catch {
    return { ok: false, empty: false, reason: "Could not read saved draft from localStorage." };
  }
  if (!raw) return { ok: false, empty: true };
  const parsed = parseAssetDraftJson(raw);
  if (!parsed.ok) return { ok: false, empty: false, reason: parsed.reason };

  const draft = parsed.draft;
  if (draft.imageDataUrl) {
    return {
      ok: true,
      draft,
      storedImage: draft.imageDataUrl,
      missingIdbImage: false,
      warning: null,
    };
  }
  if (draft.imageRef === "indexeddb") {
    const readRes = await deps.imageStore.readImage(imageKey);
    if (!readRes.ok) {
      return {
        ok: true,
        draft,
        storedImage: null,
        missingIdbImage: true,
        warning: `${readRes.message} Draft metadata and anchors were restored; reattach the original photograph to continue.`,
      };
    }
    if (!readRes.dataUrl) {
      return {
        ok: true,
        draft,
        storedImage: null,
        missingIdbImage: true,
        warning:
          "The saved draft points to an IndexedDB photograph that is no longer present in this browser. Metadata and anchors were restored; reattach the original photograph.",
      };
    }
    return { ok: true, draft, storedImage: readRes.dataUrl, missingIdbImage: false, warning: null };
  }
  return { ok: true, draft, storedImage: null, missingIdbImage: false, warning: null };
}
