import type { Pt } from "@/lib/isibuko-ai/types";

export type LowerBodyAnchors = {
  hipL: Pt;
  hipR: Pt;
  kneeL?: Pt | null;
  kneeR?: Pt | null;
  ankleL?: Pt | null;
  ankleR?: Pt | null;
};

export type LowerBodyVertex = { x: number; y: number; u: number; v: number };
export type LowerBodyPart = {
  kind: "pant-leg-left" | "pant-leg-right" | "skirt";
  vertexStart: number;
  vertexCount: number;
  indexStart: number;
  indexCount: number;
};
export type LowerBodyMesh = {
  vertices: LowerBodyVertex[];
  indices: number[];
  parts: LowerBodyPart[];
  columns: number;
  rows: number;
};

type Options = { columns?: number; rows?: number; scale?: number; hemWidth?: number };

const finite = (p: Pt | null | undefined): p is Pt =>
  Boolean(p && Number.isFinite(p.x) && Number.isFinite(p.y));
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => t * t * (3 - 2 * t);

function validPointSet(points: (Pt | null | undefined)[]): points is Pt[] {
  return points.every(finite) && points.every((p) => p.x >= -0.2 && p.x <= 1.2 && p.y >= -0.2 && p.y <= 1.2);
}

function appendGrid(mesh: LowerBodyMesh, kind: LowerBodyPart["kind"], vertices: LowerBodyVertex[], columns: number, rows: number) {
  const vertexStart = mesh.vertices.length;
  const indexStart = mesh.indices.length;
  mesh.vertices.push(...vertices);
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < columns - 1; c++) {
      const a = vertexStart + r * columns + c;
      const b = a + 1;
      const d = a + columns;
      const e = d + 1;
      mesh.indices.push(a, d, b, b, d, e);
    }
  }
  mesh.parts.push({
    kind,
    vertexStart,
    vertexCount: vertices.length,
    indexStart,
    indexCount: (columns - 1) * (rows - 1) * 6,
  });
}

function buildPanel(
  start: Pt,
  middle: Pt,
  end: Pt,
  columns: number,
  rows: number,
  uvLeft: number,
  uvRight: number,
  widthScale: number,
): LowerBodyVertex[] {
  const vertices: LowerBodyVertex[] = [];
  const axis = { x: end.x - start.x, y: end.y - start.y };
  const length = Math.hypot(axis.x, axis.y) || 1;
  const normal = { x: -axis.y / length, y: axis.x / length };
  const startHalf = Math.max(dist(start, middle) * 0.22, 0.018) * widthScale;
  const midHalf = Math.max(dist(start, middle) * 0.17, 0.014) * widthScale;
  const endHalf = Math.max(dist(middle, end) * 0.12, 0.01) * widthScale;
  for (let r = 0; r < rows; r++) {
    const v = r / (rows - 1);
    const t = smooth(v);
    const center = v <= 0.5
      ? { x: mix(start.x, middle.x, smooth(v * 2)), y: mix(start.y, middle.y, smooth(v * 2)) }
      : { x: mix(middle.x, end.x, smooth((v - 0.5) * 2)), y: mix(middle.y, end.y, smooth((v - 0.5) * 2)) };
    const half = v <= 0.5 ? mix(startHalf, midHalf, t * 2) : mix(midHalf, endHalf, (t - 0.5) * 2);
    for (let c = 0; c < columns; c++) {
      const u = c / (columns - 1);
      const side = (u * 2 - 1) * half;
      vertices.push({
        x: center.x + normal.x * side,
        y: center.y + normal.y * side,
        u: mix(uvLeft, uvRight, u),
        v,
      });
    }
  }
  return vertices;
}

/**
 * Builds separate trouser-leg panels or one continuous skirt panel.
 * Product UV convention: trouser legs use left/right halves of the image;
 * skirts use the complete image. No shirt atlas assumptions are reused.
 */
export function buildLowerBodyMesh(
  category: "pants" | "skirt",
  anchors: LowerBodyAnchors,
  options: Options = {},
): LowerBodyMesh | null {
  const columns = Math.round(options.columns ?? 7);
  const rows = Math.round(options.rows ?? 11);
  const scale = options.scale ?? 1;
  const hemWidth = options.hemWidth ?? 1;
  if (
    !Number.isFinite(columns) || !Number.isFinite(rows) ||
    columns < 3 || columns > 17 || rows < 3 || rows > 25 ||
    !Number.isFinite(scale) || scale < 0.75 || scale > 1.3 ||
    !Number.isFinite(hemWidth) || hemWidth < 0.55 || hemWidth > 1.8
  ) return null;

  const { hipL, hipR } = anchors;
  if (!validPointSet([hipL, hipR]) || dist(hipL, hipR) < 0.045 || dist(hipL, hipR) > 0.75) return null;
  const waistMid = mid(hipL, hipR);
  const waistL = { x: waistMid.x + (hipL.x - waistMid.x) * 1.04 * scale, y: waistMid.y + (hipL.y - waistMid.y) * 1.04 * scale };
  const waistR = { x: waistMid.x + (hipR.x - waistMid.x) * 1.04 * scale, y: waistMid.y + (hipR.y - waistMid.y) * 1.04 * scale };
  const mesh: LowerBodyMesh = { vertices: [], indices: [], parts: [], columns, rows };

  if (category === "skirt") {
    const down = { x: 0, y: 1 };
    const hemCenter = { x: waistMid.x, y: waistMid.y + Math.max(dist(hipL, hipR) * 2.3, 0.22) };
    const hemHalf = Math.max(dist(hipL, hipR) * 0.58 * hemWidth, 0.055);
    const vertices: LowerBodyVertex[] = [];
    for (let r = 0; r < rows; r++) {
      const v = r / (rows - 1);
      const t = smooth(v);
      const left = { x: mix(waistL.x, hemCenter.x - hemHalf, t), y: mix(waistL.y, hemCenter.y, t) };
      const right = { x: mix(waistR.x, hemCenter.x + hemHalf, t), y: mix(waistR.y, hemCenter.y, t) };
      for (let c = 0; c < columns; c++) {
        const u = c / (columns - 1);
        vertices.push({ x: mix(left.x, right.x, u), y: mix(left.y, right.y, u) + down.y * Math.sin(Math.PI * u) * Math.sin(Math.PI * v) * 0.012, u, v });
      }
    }
    appendGrid(mesh, "skirt", vertices, columns, rows);
  } else {
    const required = [anchors.kneeL, anchors.kneeR, anchors.ankleL, anchors.ankleR];
    if (!validPointSet(required)) return null;
    const [kneeL, kneeR, ankleL, ankleR] = required;
    if (dist(hipL, kneeL) < 0.025 || dist(hipR, kneeR) < 0.025 ||
        dist(kneeL, ankleL) < 0.025 || dist(kneeR, ankleR) < 0.025) return null;
    appendGrid(mesh, "pant-leg-left", buildPanel(waistL, kneeL, ankleL, columns, rows, 0.02, 0.48, 1), columns, rows);
    appendGrid(mesh, "pant-leg-right", buildPanel(waistR, kneeR, ankleR, columns, rows, 0.52, 0.98, 1), columns, rows);
  }

  if (!mesh.vertices.every((v) => [v.x, v.y, v.u, v.v].every(Number.isFinite))) return null;
  if (!mesh.indices.every((i) => Number.isInteger(i) && i >= 0 && i < mesh.vertices.length)) return null;
  return mesh;
}
