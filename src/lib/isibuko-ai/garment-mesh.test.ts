import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildShirtMesh } from "./garment-mesh.ts";

const anchors = {
  shoulderL: { x: 0.34, y: 0.32 },
  shoulderR: { x: 0.66, y: 0.32 },
  hipL: { x: 0.39, y: 0.69 },
  hipR: { x: 0.61, y: 0.69 },
  elbowL: { x: 0.27, y: 0.49 },
  elbowR: { x: 0.73, y: 0.49 },
  wristL: { x: 0.24, y: 0.64 },
  wristR: { x: 0.76, y: 0.64 },
};

describe("body-constrained shirt mesh", () => {
  it("builds a deterministic torso grid with independent sleeve panels", () => {
    const mesh = buildShirtMesh(anchors);
    assert.ok(mesh);
    assert.equal(mesh?.columns, 9);
    assert.equal(mesh?.rows, 9);
    assert.deepEqual(mesh?.parts.map((part) => part.kind), ["torso", "sleeve-left", "sleeve-right"]);
    assert.equal(mesh?.parts[0]?.vertexCount, 81);
    assert.equal(mesh?.parts[0]?.indexCount, 8 * 8 * 6);
    assert.equal(mesh?.vertices.length, 81 + 15 + 15);
  });

  it("keeps torso UVs within the central garment photo region", () => {
    const mesh = buildShirtMesh(anchors);
    assert.ok(mesh);
    const torso = mesh!.vertices.slice(0, mesh!.parts[0]!.vertexCount);
    assert.equal(torso[0]?.u, 0.2);
    assert.equal(torso[8]?.u, 0.8);
    assert.equal(torso[0]?.v, 0.02);
    assert.equal(torso[72]?.v, 0.98);
  });

  it("maps left and right sleeves to separate source-photo strips", () => {
    const mesh = buildShirtMesh(anchors);
    assert.ok(mesh);
    const left = mesh!.parts.find((part) => part.kind === "sleeve-left")!;
    const right = mesh!.parts.find((part) => part.kind === "sleeve-right")!;
    const leftU = mesh!.vertices.slice(left.vertexStart, left.vertexStart + left.vertexCount).map((vertex) => vertex.u);
    const rightU = mesh!.vertices.slice(right.vertexStart, right.vertexStart + right.vertexCount).map((vertex) => vertex.u);
    assert.ok(Math.max(...leftU) <= 0.28);
    assert.ok(Math.min(...rightU) >= 0.72);
  });

  it("does not create sleeve geometry when elbow or wrist tracking is absent", () => {
    const mesh = buildShirtMesh({ ...anchors, elbowL: null, wristL: null, elbowR: undefined, wristR: undefined });
    assert.ok(mesh);
    assert.deepEqual(mesh.parts.map((part) => part.kind), ["torso"]);
  });

  it("rejects collapsed, non-finite and implausible torso anchors", () => {
    assert.equal(buildShirtMesh({
      ...anchors,
      shoulderL: { x: 0.5, y: 0.3 },
      shoulderR: { x: 0.5, y: 0.3 },
    }), null);
    assert.equal(buildShirtMesh({
      ...anchors,
      hipL: { x: Number.NaN, y: 0.7 },
    }), null);
    assert.equal(buildShirtMesh({
      ...anchors,
      hipL: { x: 0.1, y: 0.7 },
      hipR: { x: 0.9, y: 0.7 },
    }), null);
  });

  it("rejects unsafe grid dimensions and deformation settings", () => {
    assert.equal(buildShirtMesh(anchors, { columns: 2 }), null);
    assert.equal(buildShirtMesh(anchors, { rows: 30 }), null);
    assert.equal(buildShirtMesh(anchors, { scale: Number.NaN }), null);
    assert.equal(buildShirtMesh(anchors, { hemLength: 2 }), null);
  });

  it("keeps every vertex and index finite and in range", () => {
    const mesh = buildShirtMesh(anchors);
    assert.ok(mesh);
    for (const vertex of mesh!.vertices) {
      for (const value of [vertex.x, vertex.y, vertex.u, vertex.v]) assert.ok(Number.isFinite(value));
    }
    for (const index of mesh!.indices) {
      assert.ok(Number.isInteger(index));
      assert.ok(index >= 0 && index < mesh!.vertices.length);
    }
  });
});
