import { FilesetResolver, ImageSegmenter } from "@mediapipe/tasks-vision";

const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.2/wasm";
const MULTICLASS_MODEL = "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass/float16/1/selfie_multiclass_256x256.tflite";

/** Class indices for the published MediaPipe selfie-multiclass model. */
export const SELFIE_CLASS = {
  background: 0,
  hair: 1,
  bodySkin: 2,
  faceSkin: 3,
  clothes: 4,
  others: 5,
} as const;

export type SemanticRegion = {
  pixels: number;
  ratio: number;
  bounds: { left: number; top: number; right: number; bottom: number } | null;
  center: { x: number; y: number } | null;
};

export type ProductSegmentationSample = {
  width: number;
  height: number;
  hair: SemanticRegion;
  faceSkin: SemanticRegion;
  clothes: SemanticRegion;
  /** True only when enough pixels were classified as hair to report a region. */
  hairDetected: boolean;
};

export type ProductSegmenter = {
  detect: (bitmap: ImageBitmap, timestampMs: number) => ProductSegmentationSample;
  close: () => void;
};

/** Convert a categorical mask to normalised semantic regions. */
export function summarizeSemanticMask(
  categories: Uint8Array,
  width: number,
  height: number,
): ProductSegmentationSample {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError("Mask dimensions must be positive integers.");
  }
  if (categories.length !== width * height) {
    throw new RangeError("Mask data length must match its dimensions.");
  }

  const summarize = (classIndex: number): SemanticRegion => {
    let pixels = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let index = 0; index < categories.length; index++) {
      if (categories[index] !== classIndex) continue;
      const x = index % width;
      const y = Math.floor(index / width);
      pixels++;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    const bounds = pixels
      ? {
          left: minX / width,
          top: minY / height,
          right: (maxX + 1) / width,
          bottom: (maxY + 1) / height,
        }
      : null;
    return {
      pixels,
      ratio: pixels / categories.length,
      bounds,
      center: bounds
        ? { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 }
        : null,
    };
  };

  const hair = summarize(SELFIE_CLASS.hair);
  return {
    width,
    height,
    hair,
    faceSkin: summarize(SELFIE_CLASS.faceSkin),
    clothes: summarize(SELFIE_CLASS.clothes),
    hairDetected: hair.pixels >= Math.max(8, Math.ceil(categories.length * 0.0005)),
  };
}

export async function createProductSegmenter(): Promise<ProductSegmenter> {
  const fileset = await FilesetResolver.forVisionTasks(WASM);
  const segmenter = await ImageSegmenter.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MULTICLASS_MODEL, delegate: "CPU" },
    runningMode: "VIDEO",
    outputCategoryMask: true,
    outputConfidenceMasks: false,
  });
  let previousTimestamp = -1;
  return {
    detect(bitmap, timestampMs) {
      const safeTimestamp = Math.max(previousTimestamp + 1, Math.round(timestampMs));
      previousTimestamp = safeTimestamp;
      const result = segmenter.segmentForVideo(bitmap, safeTimestamp);
      const mask = result.categoryMask;
      if (!mask) {
        throw new Error("The segmentation model did not return a category mask.");
      }
      try {
        return summarizeSemanticMask(mask.getAsUint8Array(), mask.width, mask.height);
      } finally {
        mask.close();
      }
    },
    close() {
      segmenter.close();
    },
  };
}
