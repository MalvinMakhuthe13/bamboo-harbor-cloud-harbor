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

  const regionByTime = new Map<number, ProductSegmentationSample>();
  regions.forEach((region, index) => {
    const timestamp = region.timestampMs ?? wearer[index]?.timestampMs;
    if (timestamp !== undefined) regionByTime.set(timestamp, region);
  });
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
  /** Binary mask containing only the selected connected component. */
  componentMask?: Uint8Array;
  maskWidth?: number;
  maskHeight?: number;
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
  const componentMask = new Uint8Array(categories.length);
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
      componentMask[index] = 1;
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
    componentMask,
    maskWidth: width,
    maskHeight: height,
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
      const elapsed = Math.abs(lastCenter.timestampMs - previousCenter.timestampMs);
      const nextElapsed = frame.timestampMs - lastCenter.timestampMs;
      if (elapsed > 0 && Number.isFinite(nextElapsed)) {
        const steps = Math.max(-2, Math.min(2, nextElapsed / elapsed));
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


export type HairMotionProxySummary = {
  sampleCount: number;
  meanConfidence: number;
  headYawProxyRange: number;
  peakRelativeDisplacement: number;
  peakDisplacementAtMs: number | null;
  /** Difference between the largest yaw-proxy deviation and hair-displacement peak. */
  responseLagMs: number | null;
  quality: "insufficient" | "usable";
};

/**
 * Compares face-relative semantic hair movement with the uncalibrated face yaw
 * proxy. Diagnostic only: it does not estimate degrees, physical inertia, or
 * a product-specific wig response.
 */
export function analyzeHairMotionProxy(
  wearer: WearerTrackingSample[],
  hairTrack: RelativeHairObservation[],
  minimumConfidence = 0.25,
): HairMotionProxySummary {
  if (!(minimumConfidence >= 0 && minimumConfidence <= 1)) {
    throw new RangeError("Minimum confidence must be in [0, 1].");
  }
  const hairByTime = new Map(hairTrack.map((item) => [item.timestampMs, item]));
  const paired = wearer
    .filter((sample) => sample.headYawProxy !== null && Number.isFinite(sample.headYawProxy))
    .map((sample) => ({ wearer: sample, hair: hairByTime.get(sample.timestampMs) }))
    .filter((item): item is { wearer: WearerTrackingSample; hair: RelativeHairObservation } =>
      Boolean(item.hair && item.hair.confidence >= minimumConfidence),
    )
    .sort((a, b) => a.wearer.timestampMs - b.wearer.timestampMs);

  const meanConfidence = paired.length
    ? paired.reduce((sum, item) => sum + item.hair.confidence, 0) / paired.length
    : 0;
  const insufficient = {
    sampleCount: paired.length,
    meanConfidence,
    headYawProxyRange: 0,
    peakRelativeDisplacement: 0,
    peakDisplacementAtMs: null,
    responseLagMs: null,
    quality: "insufficient" as const,
  };
  if (paired.length < 5) return insufficient;

  const baseline = paired.slice(0, Math.min(3, paired.length));
  const baseX = baseline.reduce((sum, item) => sum + item.hair.offsetX, 0) / baseline.length;
  const baseY = baseline.reduce((sum, item) => sum + item.hair.offsetY, 0) / baseline.length;
  const yawValues = paired.map((item) => item.wearer.headYawProxy!);
  const yawMin = Math.min(...yawValues);
  const yawMax = Math.max(...yawValues);
  const peakYawIndex = yawValues.reduce((best, value, index) =>
    Math.abs(value - yawValues[0]) > Math.abs(yawValues[best] - yawValues[0]) ? index : best, 0);
  const displacements = paired.map((item) =>
    Math.hypot(item.hair.offsetX - baseX, item.hair.offsetY - baseY),
  );
  const peakDisplacement = Math.max(...displacements);
  const peakIndex = displacements.indexOf(peakDisplacement);
  return {
    sampleCount: paired.length,
    meanConfidence,
    headYawProxyRange: yawMax - yawMin,
    peakRelativeDisplacement: peakDisplacement,
    peakDisplacementAtMs: paired[peakIndex].wearer.timestampMs,
    responseLagMs: paired[peakIndex].wearer.timestampMs - paired[peakYawIndex].wearer.timestampMs,
    quality: paired.length >= 8 && meanConfidence >= 0.5 ? "usable" : "insufficient",
  };
}


export type SeededHairMotionSummary = {
  pairedSamples: number;
  trackedFrames: number;
  recoveredFrames: number;
  trackingCoverage: number;
  peakFaceRelativeDisplacement: number;
  peakDisplacementAtMs: number | null;
  responseLagMs: number | null;
  quality: "insufficient" | "usable";
};

/**
 * Measures a merchant-selected connected semantic hair component relative to
 * the face. It is a component-motion proxy, not verified wig identity or
 * physical hair dynamics. Yaw remains an uncalibrated proxy.
 */
export function analyzeSeededHairMotion(
  track: SeededHairTrackPoint[],
  wearer: WearerTrackingSample[],
): SeededHairMotionSummary {
  const wearerByTime = new Map(wearer.map((sample) => [sample.timestampMs, sample]));
  const paired = track
    .filter((point) => point.tracked && point.region.center !== null)
    .map((point) => ({ point, wearer: wearerByTime.get(point.timestampMs) }))
    .filter((item): item is { point: SeededHairTrackPoint; wearer: WearerTrackingSample } =>
      Boolean(item.wearer?.faceDetected && item.wearer.headCenterX !== null &&
        item.wearer.headCenterY !== null && item.wearer.headWidth !== null &&
        item.wearer.headWidth > 0 && item.wearer.headYawProxy !== null),
    )
    .sort((a, b) => a.point.timestampMs - b.point.timestampMs);

  const trackedFrames = track.filter((point) => point.tracked).length;
  const recoveredFrames = track.filter((point) => point.recovered).length;
  const trackingCoverage = track.length ? trackedFrames / track.length : 0;
  const empty = {
    pairedSamples: paired.length,
    trackedFrames,
    recoveredFrames,
    trackingCoverage,
    peakFaceRelativeDisplacement: 0,
    peakDisplacementAtMs: null,
    responseLagMs: null,
    quality: "insufficient" as const,
  };
  if (paired.length < 5) return empty;

  const offsets = paired.map(({ point, wearer: sample }) => ({
    timestampMs: point.timestampMs,
    x: (point.region.center!.x - sample.headCenterX!) / sample.headWidth!,
    y: (point.region.center!.y - sample.headCenterY!) / sample.headWidth!,
    yaw: sample.headYawProxy!,
  }));
  const baseline = offsets.slice(0, Math.min(3, offsets.length));
  const baseX = baseline.reduce((sum, item) => sum + item.x, 0) / baseline.length;
  const baseY = baseline.reduce((sum, item) => sum + item.y, 0) / baseline.length;
  const yawBase = baseline.reduce((sum, item) => sum + item.yaw, 0) / baseline.length;
  const yawIndex = offsets.reduce((best, item, index) =>
    Math.abs(item.yaw - yawBase) > Math.abs(offsets[best].yaw - yawBase) ? index : best, 0);
  const displacement = offsets.map((item) => Math.hypot(item.x - baseX, item.y - baseY));
  const peak = Math.max(...displacement);
  const peakIndex = displacement.indexOf(peak);
  return {
    ...empty,
    peakFaceRelativeDisplacement: peak,
    peakDisplacementAtMs: offsets[peakIndex].timestampMs,
    responseLagMs: offsets[peakIndex].timestampMs - offsets[yawIndex].timestampMs,
    quality: paired.length >= 8 && trackingCoverage >= 0.7 ? "usable" : "insufficient",
  };
}


export type HairSectionName = "top" | "left" | "centre" | "right" | "lower";
export type HairSectionObservation = {
  timestampMs: number;
  section: HairSectionName;
  offsetX: number;
  offsetY: number;
};
export type HairSectionMotionProfile = {
  section: HairSectionName;
  sampleCount: number;
  peakDisplacement: number;
  peakAtMs: number | null;
};

/**
 * Creates five geometric anchor tracks inside the selected component bounds.
 * These are region anchors, not independently segmented strands or physical
 * hair sections. Coordinates are normalised by face width.
 */
export function buildHairSectionTrack(
  track: SeededHairTrackPoint[],
  wearer: WearerTrackingSample[],
): HairSectionObservation[] {
  const wearerByTime = new Map(wearer.map((sample) => [sample.timestampMs, sample]));
  const observations: HairSectionObservation[] = [];
  for (const point of track) {
    const sample = wearerByTime.get(point.timestampMs);
    const mask = point.region.componentMask;
    const width = point.region.maskWidth;
    const height = point.region.maskHeight;
    const bounds = point.region.bounds;
    if (!point.tracked || !mask || !width || !height || !bounds ||
        !sample?.faceDetected || sample.headCenterX === null ||
        sample.headCenterY === null || sample.headWidth === null || sample.headWidth <= 0) continue;

    const boxWidth = bounds.right - bounds.left;
    const boxHeight = bounds.bottom - bounds.top;
    if (boxWidth <= 0 || boxHeight <= 0) continue;
    const sections: HairSectionName[] = ["top", "left", "centre", "right", "lower"];
    const accumulators = new Map(sections.map((section) => [section, { sumX: 0, sumY: 0, count: 0 }]));
    // One pass; every selected component pixel belongs to at most one zone.
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        if (!mask[py * width + px]) continue;
        const nx = (px + 0.5) / width;
        const ny = (py + 0.5) / height;
        const localX = (nx - bounds.left) / boxWidth;
        const localY = (ny - bounds.top) / boxHeight;
        if (localX < 0 || localX > 1 || localY < 0 || localY > 1) continue;
        let section: HairSectionName;
        if (localY < 0.25) section = "top";
        else if (localY >= 0.75) section = "lower";
        else if (localX < 0.36) section = "left";
        else if (localX > 0.64) section = "right";
        else section = "centre";
        const accumulator = accumulators.get(section)!;
        accumulator.sumX += nx;
        accumulator.sumY += ny;
        accumulator.count++;
      }
    }
    for (const section of sections) {
      const accumulator = accumulators.get(section)!;
      if (!accumulator.count) continue;
      observations.push({
        timestampMs: point.timestampMs,
        section,
        offsetX: (accumulator.sumX / accumulator.count - sample.headCenterX) / sample.headWidth,
        offsetY: (accumulator.sumY / accumulator.count - sample.headCenterY) / sample.headWidth,
      });
    }
  }
  return observations;
}

/** Summarises the movement of each geometric anchor independently. */
export function summarizeHairSectionMotion(
  observations: HairSectionObservation[],
): HairSectionMotionProfile[] {
  const sections: HairSectionName[] = ["top", "left", "centre", "right", "lower"];
  return sections.map((section) => {
    const samples = observations
      .filter((item) => item.section === section)
      .sort((a, b) => a.timestampMs - b.timestampMs);
    if (samples.length < 2) return { section, sampleCount: samples.length, peakDisplacement: 0, peakAtMs: null };
    const baseline = samples.slice(0, Math.min(3, samples.length));
    const baseX = baseline.reduce((sum, item) => sum + item.offsetX, 0) / baseline.length;
    const baseY = baseline.reduce((sum, item) => sum + item.offsetY, 0) / baseline.length;
    const displacement = samples.map((item) => Math.hypot(item.offsetX - baseX, item.offsetY - baseY));
    const peak = Math.max(...displacement);
    return {
      section,
      sampleCount: samples.length,
      peakDisplacement: peak,
      peakAtMs: samples[displacement.indexOf(peak)].timestampMs,
    };
  });
}
