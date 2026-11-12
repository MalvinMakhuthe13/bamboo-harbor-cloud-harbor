import type { ProductFittingAnchors } from "@/lib/isibuko-ai/types";

export type WigFittingParameters = { opening: number; holeFrac: number };
export type AlphaBounds = { left: number; top: number; right: number; bottom: number };
export type AlphaGeometry = {
  version: "isibuko.anchors/1";
  bounds: AlphaBounds | null;
  alphaCoverage: number;
  confidence: number;
  centralOpeningCandidate: { top: number; bottom: number; width: number } | null;
};

const DEFAULT_WIG: WigFittingParameters = { opening: 0.12, holeFrac: 0.42 };

export function validateProductFittingAnchors(value: unknown): value is ProductFittingAnchors {
  if (!value || typeof value !== "object") return false;
  const candidate = value as ProductFittingAnchors;
  if (candidate.version !== "isibuko.anchors/1") return false;
  if (candidate.parameters) {
    const { wigOpening, wigHoleFraction } = candidate.parameters;
    if (wigOpening !== undefined && (!Number.isFinite(wigOpening) || wigOpening < 0 || wigOpening > 1)) return false;
    if (wigHoleFraction !== undefined && (!Number.isFinite(wigHoleFraction) || wigHoleFraction < 0.08 || wigHoleFraction > 1)) return false;
  }
  if (candidate.points) {
    for (const [name, point] of Object.entries(candidate.points)) {
      if (!name || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
      if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) return false;
      if (point.confidence !== undefined && (!Number.isFinite(point.confidence) || point.confidence < 0 || point.confidence > 1)) return false;
    }
  }
  return true;
}

export function getWigFittingParameters(anchors?: ProductFittingAnchors | null): WigFittingParameters {
  if (!anchors || !validateProductFittingAnchors(anchors)) return { ...DEFAULT_WIG };
  return {
    opening: anchors.parameters?.wigOpening ?? DEFAULT_WIG.opening,
    holeFrac: anchors.parameters?.wigHoleFraction ?? DEFAULT_WIG.holeFrac,
  };
}

/**
 * Summarises a transparent PNG/cutout without guessing garment semantics.
 * Pixel data is RGBA, row-major. Returned coordinates are normalized to 0..1.
 */
export function analyzeProductAlpha(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  alphaThreshold = 16,
): AlphaGeometry | null {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 ||
      pixels.length !== width * height * 4 || !Number.isFinite(alphaThreshold) ||
      alphaThreshold < 0 || alphaThreshold > 255) return null;

  let minX = width, minY = height, maxX = -1, maxY = -1, opaque = 0;
  const isOpaque = (x: number, y: number) => pixels[(y * width + x) * 4 + 3]! > alphaThreshold;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isOpaque(x, y)) continue;
      opaque++;
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
  }
  if (opaque === 0) return {
    version: "isibuko.anchors/1", bounds: null, alphaCoverage: 0, confidence: 0,
    centralOpeningCandidate: null,
  };

  const bounds = { left: minX / width, top: minY / height, right: (maxX + 1) / width, bottom: (maxY + 1) / height };
  const alphaCoverage = opaque / (width * height);
  const row = Math.floor((minY + maxY) / 2);
  const center = Math.floor((minX + maxX) / 2);
  let leftEdge = center, rightEdge = center;
  while (leftEdge > minX && !isOpaque(leftEdge, row)) leftEdge--;
  while (rightEdge < maxX && !isOpaque(rightEdge, row)) rightEdge++;
  let gapStart = -1, gapEnd = -1;
  for (let x = minX; x <= maxX; x++) {
    if (!isOpaque(x, row)) {
      if (gapStart < 0) gapStart = x;
      gapEnd = x;
    } else if (gapStart >= 0) break;
  }
  const gapWidth = gapStart >= 0 ? gapEnd - gapStart + 1 : 0;
  const candidate = gapWidth >= Math.max(2, Math.round(width * 0.04))
    ? { top: row / height, bottom: (row + 1) / height, width: gapWidth / width }
    : null;
  return {
    version: "isibuko.anchors/1",
    bounds,
    alphaCoverage,
    confidence: Math.min(1, Math.max(0, (alphaCoverage > 0.02 && alphaCoverage < 0.98) ? 0.65 : 0.35)),
    centralOpeningCandidate: candidate,
  };
}
