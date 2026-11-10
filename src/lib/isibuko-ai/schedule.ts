/** Pure scheduling for the live mirror. No weights, no canvas. */

export type TrackJob = "face" | "pose" | "hands" | "segment";

export type NormRect = { x: number; y: number; w: number; h: number };

export const FULL_FRAME: NormRect = { x: 0, y: 0, w: 1, h: 1 };

/** A GPU pass slower than this is treated as a stall and the tracker returns to CPU. */
export const GPU_STALL_MS = 1800;

export function cadenceMs(category: string | null, lastSegmentMs: number): Record<TrackJob, number> {
  const clothing = category === "shirt" || category === "jacket" || category === "dress" || category === "pants" || category === "skirt";
  const hands = category === "nails" || category === "ring" ? 160 : category === "watch" || category === "bracelet" ? 240 : 1100;
  const segment = lastSegmentMs > 650 ? Math.min(1100, Math.round(lastSegmentMs * 1.2)) : 320;
  return {
    face: clothing ? 200 : 140,
    pose: clothing || category === "watch" || category === "bracelet" ? 160 : 320,
    hands,
    segment,
  };
}

/**
 * Long-edge of the inference bitmap. Pose stays at 192 so shoulder fit is not
 * traded for a higher rate. Segmentation may drop to 128 only after a slow pass,
 * and it is never cropped.
 */
export function inferenceEdge(job: TrackJob, lastMs: number, cropped: boolean): number {
  if (job === "segment") {
    if (lastMs > 700) return 128;
    if (lastMs > 0 && lastMs < 260) return 160;
    return 144;
  }
  if (job === "face") return 160;
  if (job === "hands") return cropped ? 224 : 192;
  return 192;
}

export function due(now: number, lastSent: number, interval: number, inflight: boolean): boolean {
  if (inflight) return false;
  if (lastSent <= 0) return true;
  return now - lastSent >= interval;
}

export function shouldRefreshFull(tick: number, every: number): boolean {
  return every > 0 && tick % every === 0;
}

/** True while the last mask is still inside the segment interval, so the shader reuses it. */
export function maskIsFresh(now: number, lastMaskAt: number, interval: number): boolean {
  return lastMaskAt > 0 && now - lastMaskAt < interval;
}

export function roiFromPoints(
  points: Array<{ x: number; y: number } | null | undefined>,
  pad: number,
): NormRect | null {
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  let n = 0;
  for (const point of points) {
    if (!point) continue;
    if (point.x < -0.05 || point.x > 1.05 || point.y < -0.05 || point.y > 1.05) continue;
    n += 1;
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  if (n < 2) return null;
  const w = maxX - minX;
  const h = maxY - minY;
  if (w < 0.04 || h < 0.04) return null;
  if (w > 0.82 && h > 0.82) return null;
  const x = Math.max(0, minX - w * pad);
  const y = Math.max(0, minY - h * pad);
  const x2 = Math.min(1, maxX + w * pad);
  const y2 = Math.min(1, maxY + h * pad);
  return { x, y, w: Math.max(0.08, x2 - x), h: Math.max(0.08, y2 - y) };
}

export function isFullFrame(roi: NormRect): boolean {
  return roi.x <= 0.001 && roi.y <= 0.001 && roi.w >= 0.998 && roi.h >= 0.998;
}

export function remapPoint<T extends { x: number; y: number }>(point: T, roi: NormRect): T {
  if (isFullFrame(roi)) return point;
  return { ...point, x: roi.x + point.x * roi.w, y: roi.y + point.y * roi.h };
}

export function remapList<T extends { x: number; y: number }>(list: T[] | null | undefined, roi: NormRect): T[] | null {
  if (!list) return null;
  if (isFullFrame(roi)) return list;
  return list.map((point) => remapPoint(point, roi));
}

export function pixelCrop(roi: NormRect, width: number, height: number): { sx: number; sy: number; sw: number; sh: number } {
  const sx = Math.max(0, Math.min(width - 2, Math.floor(roi.x * width)));
  const sy = Math.max(0, Math.min(height - 2, Math.floor(roi.y * height)));
  const sw = Math.max(2, Math.min(width - sx, Math.round(roi.w * width)));
  const sh = Math.max(2, Math.min(height - sy, Math.round(roi.h * height)));
  return { sx, sy, sw, sh };
}
