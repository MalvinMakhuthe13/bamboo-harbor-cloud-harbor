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

  // Find the nearest hair-class pixel to the click, then isolate only its
  // 8-connected component. Nearby disconnected hair is deliberately excluded.
  let startIndex = -1;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x + 0.5 - seedX;
      const dy = y + 0.5 - seedY;
      const distance = dx * dx + dy * dy;
      const index = y * width + x;
      if (distance <= radiusSquared && categories[index] === 1 && distance < nearestDistance) {
        startIndex = index;
        nearestDistance = distance;
      }
    }
  }

  let pixels = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  if (startIndex >= 0) {
    const visited = new Uint8Array(categories.length);
    const queue = [startIndex];
    visited[startIndex] = 1;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const index = queue[cursor];
      const x = index % width;
      const y = Math.floor(index / width);
      const dx = x + 0.5 - seedX;
      const dy = y + 0.5 - seedY;
      if (dx * dx + dy * dy > radiusSquared) continue;
      pixels++;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          if (ox === 0 && oy === 0) continue;
          const nx = x + ox;
          const ny = y + oy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const next = ny * width + nx;
          if (visited[next] || categories[next] !== 1) continue;
          visited[next] = 1;
          queue.push(next);
        }
      }
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

export type SeededHairFrame = { timestampMs: number; categories: Uint8Array; width: number; height: number };
export type SeededHairTrackPoint = {
  timestampMs: number;
  seed: { x: number; y: number };
  region: SeededHairRegion;
  tracked: boolean;
  recovered: boolean;
};

/**
 * Propagates a merchant seed through later sampled frames by searching near
 * the previous selected-region centre. This is a lightweight local mask
 * tracker; it does not establish identity through occlusion or large motion.
 */
export function trackSeededHairForward(
  frames: SeededHairFrame[],
  startIndex: number,
  seed: HairSeed,
  searchRadius = 0.18,
): SeededHairTrackPoint[] {
  if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex >= frames.length) {
    throw new RangeError("Start index must refer to an available frame.");
  }
  if (!Number.isFinite(searchRadius) || searchRadius <= 0 || searchRadius > 1) {
    throw new RangeError("Search radius must be in (0, 1].");
  }
  const track: SeededHairTrackPoint[] = [];
  let currentSeed = { x: seed.x, y: seed.y };
  let previousCenter: { x: number; y: number; timestampMs: number } | null = null;
  let lastCenter: { x: number; y: number; timestampMs: number } | null = null;
  let missedFrames = 0;

  for (let index = startIndex; index < frames.length; index++) {
    const frame = frames[index];
    let predicted = currentSeed;
    if (lastCenter && previousCenter) {
      const elapsed = lastCenter.timestampMs - previousCenter.timestampMs;
      const nextElapsed = frame.timestampMs - lastCenter.timestampMs;
      if (elapsed > 0 && nextElapsed >= 0) {
        const steps = Math.min(2, nextElapsed / elapsed);
        predicted = {
          x: Math.max(0, Math.min(1, lastCenter.x + (lastCenter.x - previousCenter.x) * steps)),
          y: Math.max(0, Math.min(1, lastCenter.y + (lastCenter.y - previousCenter.y) * steps)),
        };
      }
    }
    const recoveryRadius = Math.min(0.45, searchRadius * (1 + Math.min(missedFrames, 3) * 0.65));
    const region = selectSeededHairRegion(frame.categories, frame.width, frame.height, {
      ...predicted,
      radius: recoveryRadius,
    });
    const tracked = region.pixels > 0 && region.center !== null;
    const recovered = tracked && missedFrames > 0;
    track.push({ timestampMs: frame.timestampMs, seed: { ...predicted }, region, tracked, recovered });
    if (tracked) {
      previousCenter = lastCenter;
      lastCenter = { ...region.center!, timestampMs: frame.timestampMs };
      currentSeed = region.center!;
      missedFrames = 0;
    } else {
      currentSeed = predicted;
      missedFrames++;
    }
  }
  return track;
}


/**
 * Tracks from the selected frame in both temporal directions and returns
 * points in chronological order. This is still local semantic-mask matching:
 * it cannot guarantee identity through occlusion or similar adjacent hair.
 */
export function trackSeededHairBidirectional(
  frames: SeededHairFrame[],
  startIndex: number,
  seed: HairSeed,
  searchRadius = 0.18,
): SeededHairTrackPoint[] {
  if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex >= frames.length) {
    throw new RangeError("Start index must refer to an available frame.");
  }
  const backwardReversed = trackSeededHairForward(
    frames.slice(0, startIndex + 1).reverse(),
    0,
    seed,
    searchRadius,
  );
  const backward = backwardReversed.reverse().slice(0, -1);
  const forward = trackSeededHairForward(frames, startIndex, seed, searchRadius);
  return [...backward, ...forward];
}
