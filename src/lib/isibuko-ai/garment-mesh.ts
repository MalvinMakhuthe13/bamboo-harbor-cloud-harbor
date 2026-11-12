import type { Pt } from "@/lib/isibuko-ai/types";

export type ShirtAnchorSet = {
  shoulderL: Pt;
  shoulderR: Pt;
  hipL: Pt;
  hipR: Pt;
  elbowL?: Pt | null;
  elbowR?: Pt | null;
  wristL?: Pt | null;
  wristR?: Pt | null;
};

export type GarmentVertex = {
  /** Normalized mirrored-camera coordinates: x/y in the same space as pose landmarks. */
  x: number;
  y: number;
  /** Product-photo UV coordinates, origin at top-left. */
  u: number;
  v: number;
};

export type GarmentPart = {
  kind: "torso" | "sleeve-left" | "sleeve-right";
  vertexStart: number;
  vertexCount: number;
  indexStart: number;
  indexCount: number;
};

export type GarmentMesh = {
  vertices: GarmentVertex[];
  indices: number[];
  parts: GarmentPart[];
  columns: number;
  rows: number;
};

export type ShirtMeshOptions = {
  columns?: number;
  rows?: number;
  scale?: number;
  hemLength?: number;
  sleeveLength?: number;
};

const EPSILON = 1e-5;
const DEFAULT_COLUMNS = 9;
const DEFAULT_ROWS = 9;

function finitePoint(point: Pt | null | undefined): point is Pt {
  return Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y));
}

function distance(a: Pt, b: Pt): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smooth(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

function midpoint(a: Pt, b: Pt): Pt {
  return { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
}

function normalize(x: number, y: number): Pt {
  const length = Math.hypot(x, y);
  if (length < EPSILON) return { x: 0, y: 1 };
  return { x: x / length, y: y / length };
}

function validAnchorSet(anchors: ShirtAnchorSet): boolean {
  const required = [anchors.shoulderL, anchors.shoulderR, anchors.hipL, anchors.hipR];
  if (!required.every(finitePoint)) return false;
  const shoulder = distance(anchors.shoulderL, anchors.shoulderR);
  const hip = distance(anchors.hipL, anchors.hipR);
  const torso = distance(midpoint(anchors.shoulderL, anchors.shoulderR), midpoint(anchors.hipL, anchors.hipR));
  if (shoulder < 0.045 || shoulder > 0.82 || hip < shoulder * 0.3 || hip > shoulder * 2.2) return false;
  if (torso < shoulder * 0.35 || torso > 1.15) return false;
  return true;
}

function addGridIndices(indices: number[], start: number, columns: number, rows: number): void {
  for (let row = 0; row < rows - 1; row++) {
    for (let column = 0; column < columns - 1; column++) {
      const a = start + row * columns + column;
      const b = a + 1;
      const c = a + columns;
      const d = c + 1;
      // Consistent winding. The renderer uses no face culling for camera overlays.
      indices.push(a, c, b, b, c, d);
    }
  }
}

function addPart(
  mesh: Pick<GarmentMesh, "vertices" | "indices" | "parts">,
  kind: GarmentPart["kind"],
  vertices: GarmentVertex[],
  columns: number,
  rows: number,
): void {
  const vertexStart = mesh.vertices.length;
  const indexStart = mesh.indices.length;
  mesh.vertices.push(...vertices);
  addGridIndices(mesh.indices, vertexStart, columns, rows);
  mesh.parts.push({
    kind,
    vertexStart,
    vertexCount: vertices.length,
    indexStart,
    indexCount: (columns - 1) * (rows - 1) * 6,
  });
}

/**
 * Builds a low-poly, body-constrained shirt surface.
 *
 * The chest/shoulder row follows shoulder anchors; the lower rows taper toward
 * the hips and hem. It is deliberately deterministic and contains no cloth
 * simulation: first validate stable topology and tracking, then add selective
 * physics to loose hem vertices in a separate experiment.
 *
 * UVs preserve the existing catalogue-photo convention: central 60% for the
 * torso, left 26% and right 26% for sleeve strips.
 */
export function buildShirtMesh(
  anchors: ShirtAnchorSet,
  options: ShirtMeshOptions = {},
): GarmentMesh | null {
  if (!validAnchorSet(anchors)) return null;

  const columns = Math.round(options.columns ?? DEFAULT_COLUMNS);
  const rows = Math.round(options.rows ?? DEFAULT_ROWS);
  const scale = options.scale ?? 1;
  const hemLength = options.hemLength ?? 0.16;
  const sleeveLength = options.sleeveLength ?? 0.62;
  if (
    !Number.isFinite(columns) || !Number.isFinite(rows) ||
    columns < 3 || columns > 25 || rows < 3 || rows > 25 ||
    !Number.isFinite(scale) || scale < 0.75 || scale > 1.3 ||
    !Number.isFinite(hemLength) || hemLength < 0 || hemLength > 0.45 ||
    !Number.isFinite(sleeveLength) || sleeveLength < 0.2 || sleeveLength > 1
  ) return null;

  const shoulderMid = midpoint(anchors.shoulderL, anchors.shoulderR);
  const hipMid = midpoint(anchors.hipL, anchors.hipR);
  const down = normalize(hipMid.x - shoulderMid.x, hipMid.y - shoulderMid.y);
  const shoulderWidth = distance(anchors.shoulderL, anchors.shoulderR);
  const hipWidth = distance(anchors.hipL, anchors.hipR);
  const baseLength = distance(shoulderMid, hipMid);
  const hemMid = {
    x: hipMid.x + down.x * baseLength * hemLength,
    y: hipMid.y + down.y * baseLength * hemLength,
  };

  const leftTop = {
    x: shoulderMid.x + (anchors.shoulderL.x - shoulderMid.x) * 1.06 * scale,
    y: shoulderMid.y + (anchors.shoulderL.y - shoulderMid.y) * 1.06 * scale,
  };
  const rightTop = {
    x: shoulderMid.x + (anchors.shoulderR.x - shoulderMid.x) * 1.06 * scale,
    y: shoulderMid.y + (anchors.shoulderR.y - shoulderMid.y) * 1.06 * scale,
  };
  const leftHem = {
    x: hemMid.x + (anchors.hipL.x - hipMid.x) * 1.12 * scale,
    y: hemMid.y + (anchors.hipL.y - hipMid.y) * 1.12 * scale,
  };
  const rightHem = {
    x: hemMid.x + (anchors.hipR.x - hipMid.x) * 1.12 * scale,
    y: hemMid.y + (anchors.hipR.y - hipMid.y) * 1.12 * scale,
  };

  const vertices: GarmentVertex[] = [];
  for (let row = 0; row < rows; row++) {
    const v = row / (rows - 1);
    const t = smooth(v);
    const left = {
      x: mix(leftTop.x, leftHem.x, t),
      y: mix(leftTop.y, leftHem.y, t),
    };
    const right = {
      x: mix(rightTop.x, rightHem.x, t),
      y: mix(rightTop.y, rightHem.y, t),
    };
    // A small deterministic ease at the waist prevents a rigid rectangular
    // sheet; the maximum contour is intentionally subtle until depth is known.
    const waistEase = Math.sin(Math.PI * v) * shoulderWidth * 0.018 * (1 - v);
    for (let column = 0; column < columns; column++) {
      const u = column / (columns - 1);
      const across = mix(left.x, right.x, u);
      const vertical = mix(left.y, right.y, u);
      const bulge = Math.sin(Math.PI * u) * waistEase;
      vertices.push({
        x: across + down.x * bulge,
        y: vertical + down.y * bulge,
        u: mix(0.2, 0.8, u),
        v: mix(0.02, 0.98, v),
      });
    }
  }

  const mesh: GarmentMesh = { vertices: [], indices: [], parts: [], columns, rows };
  addPart(mesh, "torso", vertices, columns, rows);

  addSleeve(mesh, "sleeve-left", anchors.shoulderL, anchors.elbowL, anchors.wristL, true, shoulderWidth, sleeveLength);
  addSleeve(mesh, "sleeve-right", anchors.shoulderR, anchors.elbowR, anchors.wristR, false, shoulderWidth, sleeveLength);

  if (!mesh.vertices.every((vertex) => [vertex.x, vertex.y, vertex.u, vertex.v].every(Number.isFinite))) return null;
  if (!mesh.indices.every((index) => Number.isInteger(index) && index >= 0 && index < mesh.vertices.length)) return null;
  return mesh;
}

function addSleeve(
  mesh: GarmentMesh,
  kind: "sleeve-left" | "sleeve-right",
  shoulder: Pt,
  elbow: Pt | null | undefined,
  wrist: Pt | null | undefined,
  left: boolean,
  shoulderWidth: number,
  sleeveLength: number,
): void {
  if (!finitePoint(elbow) || !finitePoint(wrist)) return;
  const armX = wrist.x - shoulder.x;
  const armY = wrist.y - shoulder.y;
  const armLength = Math.hypot(armX, armY);
  if (armLength < shoulderWidth * 0.25 || armLength > shoulderWidth * 3.5) return;

  const direction = normalize(armX, armY);
  const normal = { x: -direction.y, y: direction.x };
  const rows = 5;
  const columns = 3;
  const points = [shoulder, elbow, wrist];
  const widths = [shoulderWidth * 0.19, shoulderWidth * 0.16, shoulderWidth * 0.115];
  const vertices: GarmentVertex[] = [];
  for (let row = 0; row < rows; row++) {
    const t = (row / (rows - 1)) * sleeveLength;
    const segment = t <= 0.5 ? 0 : 1;
    const local = segment === 0 ? t * 2 : (t - 0.5) * 2;
    const center = {
      x: mix(points[segment]!.x, points[segment + 1]!.x, local),
      y: mix(points[segment]!.y, points[segment + 1]!.y, local),
    };
    const halfWidth = mix(widths[segment]!, widths[segment + 1]!, local);
    for (let column = 0; column < columns; column++) {
      const across = column / (columns - 1) * 2 - 1;
      const side = across * halfWidth;
      const sourceU = left ? mix(0.02, 0.28, column / (columns - 1)) : mix(0.72, 0.98, column / (columns - 1));
      vertices.push({
        x: center.x + normal.x * side,
        y: center.y + normal.y * side,
        u: sourceU,
        v: mix(0.14, 0.82, t),
      });
    }
  }
  addPart(mesh, kind, vertices, columns, rows);
}
