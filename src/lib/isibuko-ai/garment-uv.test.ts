
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildShirtMesh } from "./garment-mesh.ts";
import { applyShirtGarmentUv } from "./garment-uv.ts";

const bodyAnchors = {
  shoulderL: { x: 0.34, y: 0.32 },
  shoulderR: { x: 0.66, y: 0.32 },
  hipL: { x: 0.39, y: 0.69 },
  hipR: { x: 0.61, y: 0.69 },
  elbowL: { x: 0.27, y: 0.49 },
  elbowR: { x: 0.73, y: 0.49 },
  wristL: { x: 0.24, y: 0.64 },
  wristR: { x: 0.76, y: 0.64 },
};

const photoAnchors = {
  version: "isibuko.anchors/1" as const,
  points: {
    shoulderL: { x: 0.75, y: 0.2 },
    shoulderR: { x: 0.25, y: 0.2 },
    hipL: { x: 0.65, y: 0.75 },
    hipR: { x: 0.35, y: 0.75 },
    elbowL: { x: 0.88, y: 0.42 },
    elbowR: { x: 0.12, y: 0.42 },
    wristL: { x: 0.92, y: 0.68 },
    wristR: { x: 0.08, y: 0.68 },
  },
};

describe("shirt garment UV mapping", () => {
  it("preserves the original mesh when fitting anchors are absent", () => {
    const mesh = buildShirtMesh(bodyAnchors)!;
    const before = mesh.vertices.map((v) => ({ ...v }));

    applyShirtGarmentUv(mesh);

    assert.deepEqual(mesh.vertices, before);
  });

  it("maps torso UVs using garment-photo shoulder and hip anchors", () => {
    const mesh = buildShirtMesh(bodyAnchors)!;

    applyShirtGarmentUv(mesh, photoAnchors);

    const torso = mesh.parts[0]!;
    const topLeft = mesh.vertices[torso.vertexStart]!;
    const topRight = mesh.vertices[torso.vertexStart + mesh.columns - 1]!;
    const bottomLeft = mesh.vertices[torso.vertexStart + (mesh.rows - 1) * mesh.columns]!;
    const bottomRight = mesh.vertices[torso.vertexStart + mesh.rows * mesh.columns - 1]!;

    assert.ok(Math.abs(topLeft.u - 0.25) < 1e-9);
    assert.ok(Math.abs(topRight.u - 0.75) < 1e-9);
    assert.ok(Math.abs(bottomLeft.u - 0.35) < 1e-9);
    assert.ok(Math.abs(bottomRight.u - 0.65) < 1e-9);
  });

  it("keeps sleeve texture coordinates inside their separate regions", () => {
    const mesh = buildShirtMesh(bodyAnchors)!;

    applyShirtGarmentUv(mesh, photoAnchors);

    const left = mesh.parts.find((p) => p.kind === "sleeve-left")!;
    const right = mesh.parts.find((p) => p.kind === "sleeve-right")!;

    const leftUvs = mesh.vertices.slice(left.vertexStart, left.vertexStart + left.vertexCount);
    const rightUvs = mesh.vertices.slice(right.vertexStart, right.vertexStart + right.vertexCount);

    assert.ok(leftUvs.every((v) => v.u >= 0.02 && v.u <= 0.28));
    assert.ok(rightUvs.every((v) => v.u >= 0.72 && v.u <= 0.98));
  });

  it("does not change geometry or mesh topology", () => {
    const mesh = buildShirtMesh(bodyAnchors)!;
    const positions = mesh.vertices.map(({ x, y }) => ({ x, y }));
    const indices = [...mesh.indices];

    applyShirtGarmentUv(mesh, photoAnchors);

    assert.deepEqual(mesh.vertices.map(({ x, y }) => ({ x, y })), positions);
    assert.deepEqual(mesh.indices, indices);
  });

  it("leaves the mesh unchanged when torso anchors are inverted", () => {
    const mesh = buildShirtMesh(bodyAnchors)!;
    const before = mesh.vertices.map((v) => ({ ...v }));

    applyShirtGarmentUv(mesh, {
      version: "isibuko.anchors/1",
      points: {
        shoulderL: { x: 0.8, y: 0.2 },
        shoulderR: { x: 0.2, y: 0.2 },
        hipL: { x: 0.7, y: 0.75 },
        hipR: { x: 0.3, y: 0.75 },
      },
    });

    assert.deepEqual(mesh.vertices, before);
  });
});
