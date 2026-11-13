
import type { ProductFittingAnchors, ProductAnchorPoint } from "./types.ts";
import type { GarmentMesh } from "./garment-mesh.ts";

function validPoint(point: ProductAnchorPoint | undefined): point is ProductAnchorPoint {
  return Boolean(
    point &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    point.x >= 0 &&
    point.x <= 1 &&
    point.y >= 0 &&
    point.y <= 1,
  );
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}


function validTorsoQuad(
  leftTop: ProductAnchorPoint,
  rightTop: ProductAnchorPoint,
  leftBottom: ProductAnchorPoint,
  rightBottom: ProductAnchorPoint,
): boolean {
  const topWidth = rightTop.x - leftTop.x;
  const bottomWidth = rightBottom.x - leftBottom.x;
  const leftHeight = leftBottom.y - leftTop.y;
  const rightHeight = rightBottom.y - rightTop.y;

  const sameHorizontalOrientation =
    Math.sign(topWidth) === Math.sign(bottomWidth);

  return (
    Math.abs(topWidth) >= 0.025 &&
    Math.abs(bottomWidth) >= 0.025 &&
    sameHorizontalOrientation &&
    leftHeight >= 0.025 &&
    rightHeight >= 0.025 &&
    Math.abs(leftTop.y - rightTop.y) < 0.45 &&
    Math.abs(leftBottom.y - rightBottom.y) < 0.45
  );
}


/**
 * Maps the torso mesh to the actual garment-photo anchor coordinates.
 * Only UVs are modified. Geometry, indices and sleeve UVs remain unchanged.
 */
export function applyShirtGarmentUv(
  mesh: GarmentMesh,
  fittingAnchors?: ProductFittingAnchors | null,
): GarmentMesh {
  if (
    fittingAnchors?.version !== "isibuko.anchors/1" ||
    !fittingAnchors.points
  ) {
    return mesh;
  }

  const points = fittingAnchors.points;
  const leftTop = points.shoulderL;
  const rightTop = points.shoulderR;
  const leftBottom = points.hipL;
  const rightBottom = points.hipR;

  if (
    !validPoint(leftTop) ||
    !validPoint(rightTop) ||
    !validPoint(leftBottom) ||
    !validPoint(rightBottom) ||
    !validTorsoQuad(leftTop, rightTop, leftBottom, rightBottom)
  ) {
    return mesh;
  }

  const torso = mesh.parts.find((part) => part.kind === "torso");

  if (
    !torso ||
    torso.vertexCount !== mesh.columns * mesh.rows ||
    torso.vertexStart < 0 ||
    torso.vertexStart + torso.vertexCount > mesh.vertices.length
  ) {
    return mesh;
  }

  for (let row = 0; row < mesh.rows; row++) {
    const down = row / (mesh.rows - 1);

    const leftX = mix(leftTop.x, leftBottom.x, down);
    const leftY = mix(leftTop.y, leftBottom.y, down);
    const rightX = mix(rightTop.x, rightBottom.x, down);
    const rightY = mix(rightTop.y, rightBottom.y, down);

    for (let column = 0; column < mesh.columns; column++) {
      const across = column / (mesh.columns - 1);
      const vertex = mesh.vertices[torso.vertexStart + row * mesh.columns + column];

      if (!vertex) continue;

      vertex.u = mix(leftX, rightX, across);
      vertex.v = mix(leftY, rightY, across);
    }
  }

  return mesh;
}
