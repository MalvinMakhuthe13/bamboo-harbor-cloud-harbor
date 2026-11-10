import type { ProductSegmentationSample } from "./product-segmentation.ts";
import type { WearerTrackingSample } from "./wearer-tracking.ts";

export type RelativeHairObservation = {
  timestampMs: number;
  /** Hair centre relative to face centre, measured in face-width units. */
  offsetX: number;
  /** Hair centre relative to face centre, measured in face-width units. */
  offsetY: number;
  /** Hair bounding-box width measured in face-width units. */
  width: number;
  /** Hair bounding-box height measured in face-width units. */
  height: number;
  confidence: number;
};

export type RelativeHairTrackOptions = {
  smoothing?: number;
  minimumConfidence?: number;
  maximumGapMs?: number;
};

/**
 * Converts generic semantic hair regions into a face-relative, temporally
 * smoothed track. This is a hair-region proxy, not a product/wig boundary.
 */
export function buildRelativeHairTrack(
  wearer: WearerTrackingSample[],
  regions: ProductSegmentationSample[],
  options: RelativeHairTrackOptions = {},
): RelativeHairObservation[] {
  const smoothing = options.smoothing ?? 0.35;
  const minimumConfidence = options.minimumConfidence ?? 0.2;
  const maximumGapMs = options.maximumGapMs ?? 1500;
  if (!(smoothing > 0 && smoothing <= 1)) throw new RangeError("Smoothing must be in (0, 1].");
  if (!(minimumConfidence >= 0 && minimumConfidence <= 1)) throw new RangeError("Minimum confidence must be in [0, 1].");

  const regionByTime = new Map(regions.map((region, index) => [wearer[index]?.timestampMs, region]));
  const observations: RelativeHairObservation[] = [];
  let previous: RelativeHairObservation | null = null;

  for (const sample of [...wearer].sort((a, b) => a.timestampMs - b.timestampMs)) {
    const region = regionByTime.get(sample.timestampMs);
    const bounds = region?.hair.bounds;
    if (!region?.hairDetected || !bounds || !sample.faceDetected ||
        sample.headCenterX === null || sample.headCenterY === null ||
        sample.headWidth === null || sample.headWidth <= 0) continue;

    const confidence = Math.min(1, region.hair.ratio * 8) * sample.faceConfidence;
    if (!Number.isFinite(confidence) || confidence < minimumConfidence) continue;
    const raw: RelativeHairObservation = {
      timestampMs: sample.timestampMs,
      offsetX: ((bounds.left + bounds.right) / 2 - sample.headCenterX) / sample.headWidth,
      offsetY: ((bounds.top + bounds.bottom) / 2 - sample.headCenterY) / sample.headWidth,
      width: (bounds.right - bounds.left) / sample.headWidth,
      height: (bounds.bottom - bounds.top) / sample.headWidth,
      confidence,
    };
    const canSmooth = previous && raw.timestampMs > previous.timestampMs &&
      raw.timestampMs - previous.timestampMs <= maximumGapMs;
    const next = canSmooth ? {
      ...raw,
      offsetX: previous.offsetX + smoothing * (raw.offsetX - previous.offsetX),
      offsetY: previous.offsetY + smoothing * (raw.offsetY - previous.offsetY),
      width: previous.width + smoothing * (raw.width - previous.width),
      height: previous.height + smoothing * (raw.height - previous.height),
    } : raw;
    observations.push(next);
    previous = next;
  }
  return observations;
}

export function summarizeRelativeHairTrack(track: RelativeHairObservation[]) {
  if (!track.length) return { sampleCount: 0, meanConfidence: 0, horizontalJitter: null as number | null, verticalJitter: null as number | null };
  const mean = (key: "offsetX" | "offsetY") => track.reduce((sum, item) => sum + item[key], 0) / track.length;
  const mx = mean("offsetX");
  const my = mean("offsetY");
  return {
    sampleCount: track.length,
    meanConfidence: track.reduce((sum, item) => sum + item.confidence, 0) / track.length,
    horizontalJitter: Math.sqrt(track.reduce((sum, item) => sum + (item.offsetX - mx) ** 2, 0) / track.length),
    verticalJitter: Math.sqrt(track.reduce((sum, item) => sum + (item.offsetY - my) ** 2, 0) / track.length),
  };
}

export type HairSeed = { x: number; y: number; radius: number };
export type SeededHairRegion = {
  pixels: number;
  ratio: number;
  bounds: { left: number; top: number; right: number; bottom: number } | null;
  center: { x: number; y: number } | null;
};

/**
 * Refines a semantic hair mask around a merchant-selected seed point.
 * The radius is normalised to the shorter mask dimension. This is a spatial
 * selection aid, not instance segmentation or temporal identity tracking.
 */
export function selectSeededHairRegion(
  categories: Uint8Array,
  width: number,
  height: number,
  seed: HairSeed,
): SeededHairRegion {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 ||
      categories.length !== width * height) {
    throw new RangeError("Mask dimensions and data length are invalid.");
  }
  if (![seed.x, seed.y, seed.radius].every(Number.isFinite) ||
      seed.x < 0 || seed.x > 1 || seed.y < 0 || seed.y > 1 ||
      seed.radius <= 0 || seed.radius > 1) {
    throw new RangeError("Seed coordinates must be in [0, 1] and radius in (0, 1].");
  }
  const seedX = seed.x * width;
  const seedY = seed.y * height;
  const radius = seed.radius * Math.min(width, height);
  const radiusSquared = radius * radius;
  let pixels = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x + 0.5 - seedX;
      const dy = y + 0.5 - seedY;
      if (dx * dx + dy * dy > radiusSquared || categories[y * width + x] !== 1) continue;
      pixels++;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  const bounds = pixels ? {
    left: minX / width,
    top: minY / height,
    right: (maxX + 1) / width,
    bottom: (maxY + 1) / height,
  } : null;
  return {
    pixels,
    ratio: pixels / categories.length,
    bounds,
    center: bounds ? { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 } : null,
  };
}
