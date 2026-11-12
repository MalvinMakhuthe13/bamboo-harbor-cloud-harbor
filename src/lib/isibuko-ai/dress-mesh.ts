import type { Pt } from "@/lib/isibuko-ai/types";
import type { GarmentMesh, GarmentVertex } from "@/lib/isibuko-ai/garment-mesh";

export type DressAnchors = {
  shoulderL: Pt;
  shoulderR: Pt;
  hipL: Pt;
  hipR: Pt;
  kneeL?: Pt | null;
  kneeR?: Pt | null;
};

type Options = { columns?: number; rows?: number; scale?: number; hemWidth?: number };

const finite = (p: Pt | null | undefined): p is Pt =>
  Boolean(p && Number.isFinite(p.x) && Number.isFinite(p.y));
const distance = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };
const normalize = (x: number, y: number): Pt => {
  const length = Math.hypot(x, y);
  return length > 1e-5 ? { x: x / length, y: y / length } : { x: 0, y: 1 };
};

/**
 * One connected shoulder-to-hem dress surface. The waist is shaped at hip
 * landmarks and the skirt flares toward a hem perpendicular to the tracked
 * body-down direction. This is a 2D camera-constrained surface, not cloth physics.
 */
export function buildDressMesh(anchors: DressAnchors, options: Options = {}): GarmentMesh | null {
  const required = [anchors.shoulderL, anchors.shoulderR, anchors.hipL, anchors.hipR];
  if (!required.every(finite)) return null;
  const shoulderWidth = distance(anchors.shoulderL, anchors.shoulderR);
  const hipWidth = distance(anchors.hipL, anchors.hipR);
  const shoulderMid = midpoint(anchors.shoulderL, anchors.shoulderR);
  const hipMid = midpoint(anchors.hipL, anchors.hipR);
  const torsoLength = distance(shoulderMid, hipMid);
  if (shoulderWidth < 0.045 || shoulderWidth > 0.82 || hipWidth < shoulderWidth * 0.25 ||
      hipWidth > shoulderWidth * 2.2 || torsoLength < shoulderWidth * 0.35 || torsoLength > 1.15) return null;

  const columns = Math.round(options.columns ?? 11);
  const rows = Math.round(options.rows ?? 17);
  const scale = options.scale ?? 1;
  const hemWidth = options.hemWidth ?? 1.55;
  if (!Number.isFinite(columns) || !Number.isFinite(rows) || columns < 3 || columns > 21 ||
      rows < 5 || rows > 31 || !Number.isFinite(scale) || scale < 0.75 || scale > 1.3 ||
      !Number.isFinite(hemWidth) || hemWidth < 1 || hemWidth > 2.5) return null;

  const leftKnee = finite(anchors.kneeL) ? anchors.kneeL : null;
  const rightKnee = finite(anchors.kneeR) ? anchors.kneeR : null;
  const kneeMid = leftKnee && rightKnee ? midpoint(leftKnee, rightKnee) : null;
  const bodyVector = kneeMid
    ? { x: kneeMid.x - hipMid.x, y: kneeMid.y - hipMid.y }
    : { x: 0, y: 1 };
  const down = normalize(bodyVector.x, bodyVector.y);
  const across = normalize(anchors.hipR.x - anchors.hipL.x, anchors.hipR.y - anchors.hipL.y);
  const trackedSkirtLength = kneeMid ? distance(hipMid, kneeMid) * 1.08 : torsoLength * 1.9;
  const hemDistance = Math.max(trackedSkirtLength, shoulderWidth * 1.25);
  const hemCenter = { x: hipMid.x + down.x * hemDistance, y: hipMid.y + down.y * hemDistance };
  const hemHalf = Math.max(hipWidth * 0.5 * hemWidth * scale, shoulderWidth * 0.38);
  const topHalf = shoulderWidth * 0.53 * scale;
  const waistHalf = hipWidth * 0.55 * scale;

  const centerAt = (v: number): Pt => {
    if (v <= 0.58) {
      const t = smooth(v / 0.58);
      return { x: mix(shoulderMid.x, hipMid.x, t), y: mix(shoulderMid.y, hipMid.y, t) };
    }
    const t = smooth((v - 0.58) / 0.42);
    return { x: mix(hipMid.x, hemCenter.x, t), y: mix(hipMid.y, hemCenter.y, t) };
  };
  const widthAt = (v: number): number => v <= 0.58
    ? mix(topHalf, waistHalf, smooth(v / 0.58))
    : mix(waistHalf, hemHalf, smooth((v - 0.58) / 0.42));

  const vertices: GarmentVertex[] = [];
  for (let row = 0; row < rows; row++) {
    const v = row / (rows - 1);
    const center = centerAt(v);
    const before = centerAt(Math.max(0, v - 0.012));
    const after = centerAt(Math.min(1, v + 0.012));
    let tangent = normalize(after.x - before.x, after.y - before.y);
    if (Math.hypot(after.x - before.x, after.y - before.y) < 1e-5) tangent = down;
    let normal = { x: -tangent.y, y: tangent.x };
    if (normal.x * across.x + normal.y * across.y < 0) normal = { x: -normal.x, y: -normal.y };
    const half = widthAt(v);
    for (let column = 0; column < columns; column++) {
      const u = column / (columns - 1);
      const side = (u * 2 - 1) * half;
      const subtleDrape = Math.sin(Math.PI * u * 4) * Math.sin(Math.PI * v) * shoulderWidth * 0.008;
      vertices.push({
        x: center.x + normal.x * (side + subtleDrape),
        y: center.y + normal.y * (side + subtleDrape),
        u,
        v,
      });
    }
  }

  const indices: number[] = [];
  for (let row = 0; row < rows - 1; row++) {
    for (let column = 0; column < columns - 1; column++) {
      const a = row * columns + column;
      const b = a + 1;
      const c = a + columns;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  if (!vertices.every((vertex) => [vertex.x, vertex.y, vertex.u, vertex.v].every(Number.isFinite))) return null;
  return {
    vertices,
    indices,
    parts: [{ kind: "torso", vertexStart: 0, vertexCount: vertices.length, indexStart: 0, indexCount: indices.length }],
    columns,
    rows,
  };
}
