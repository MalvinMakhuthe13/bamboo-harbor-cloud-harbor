import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildLowerBodyMesh } from "./lower-body-mesh.ts";

const anchors = {
  hipL: { x: 0.42, y: 0.52 },
  hipR: { x: 0.58, y: 0.52 },
  kneeL: { x: 0.40, y: 0.73 },
  kneeR: { x: 0.60, y: 0.73 },
  ankleL: { x: 0.39, y: 0.94 },
  ankleR: { x: 0.61, y: 0.94 },
};

describe("lower-body garment mesh", () => {
  it("creates two independently tracked trouser legs with distinct atlas regions", () => {
    const mesh = buildLowerBodyMesh("pants", anchors);
    assert.ok(mesh);
    assert.deepEqual(mesh.parts.map((part) => part.kind), ["pant-leg-left", "pant-leg-right"]);
    assert.equal(mesh.parts[0]?.vertexCount, 77);
    const left = mesh.vertices.slice(mesh.parts[0]!.vertexStart, mesh.parts[0]!.vertexStart + mesh.parts[0]!.vertexCount);
    const right = mesh.vertices.slice(mesh.parts[1]!.vertexStart, mesh.parts[1]!.vertexStart + mesh.parts[1]!.vertexCount);
    assert.ok(Math.max(...left.map((v) => v.u)) <= 0.48);
    assert.ok(Math.min(...right.map((v) => v.u)) >= 0.52);
    assert.notDeepEqual(left.map((v) => [v.x, v.y]), right.map((v) => [v.x, v.y]));
  });

  it("creates one continuous waist-to-hem skirt panel using the full texture", () => {
    const mesh = buildLowerBodyMesh("skirt", anchors);
    assert.ok(mesh);
    assert.deepEqual(mesh.parts.map((part) => part.kind), ["skirt"]);
    assert.equal(mesh.parts[0]?.vertexCount, 77);
    assert.equal(Math.min(...mesh.vertices.map((v) => v.u)), 0);
    assert.equal(Math.max(...mesh.vertices.map((v) => v.u)), 1);
  });

  it("rotates the skirt hem with the tracked body axis when the wearer leans", () => {
    const leaning = {
      ...anchors,
      kneeL: { x: 0.53, y: 0.72 },
      kneeR: { x: 0.69, y: 0.72 },
    };
    const mesh = buildLowerBodyMesh("skirt", leaning);
    assert.ok(mesh);
    const lastRow = mesh.vertices.slice(-mesh.columns);
    const hemCenterX = lastRow.reduce((sum, vertex) => sum + vertex.x, 0) / lastRow.length;
    assert.ok(hemCenterX > 0.58, "hem should follow the right-leaning body axis");
    assert.ok(lastRow.every((vertex) => vertex.y > 0.52), "hem should still extend down the body");
  });

  it("keeps a safe vertical skirt fallback when knee tracking is absent", () => {
    const mesh = buildLowerBodyMesh("skirt", { hipL: anchors.hipL, hipR: anchors.hipR });
    assert.ok(mesh);
    const firstRow = mesh.vertices.slice(0, mesh.columns);
    const lastRow = mesh.vertices.slice(-mesh.columns);
    const firstCenterX = firstRow.reduce((sum, vertex) => sum + vertex.x, 0) / firstRow.length;
    const lastCenterX = lastRow.reduce((sum, vertex) => sum + vertex.x, 0) / lastRow.length;
    assert.ok(Math.abs(lastCenterX - firstCenterX) < 0.02);
  });

  it("rejects missing or implausible lower-body tracking instead of guessing", () => {
    assert.equal(buildLowerBodyMesh("pants", { hipL: anchors.hipL, hipR: anchors.hipR }), null);
    assert.equal(buildLowerBodyMesh("pants", { ...anchors, kneeL: null }), null);
    assert.equal(buildLowerBodyMesh("pants", { ...anchors, ankleR: { x: 3, y: 0.9 } }), null);
    assert.equal(buildLowerBodyMesh("skirt", { hipL: { x: 0.5, y: 0.5 }, hipR: { x: 0.5, y: 0.5 } }), null);
  });

  it("keeps topology finite and all indices in range", () => {
    for (const category of ["pants", "skirt"] as const) {
      const mesh = buildLowerBodyMesh(category, anchors);
      assert.ok(mesh);
      assert.ok(mesh.vertices.every((v) => [v.x, v.y, v.u, v.v].every(Number.isFinite)));
      assert.ok(mesh.indices.every((i) => Number.isInteger(i) && i >= 0 && i < mesh.vertices.length));
    }
  });

  it("rejects unsafe grid and scale options", () => {
    assert.equal(buildLowerBodyMesh("skirt", anchors, { columns: 2 }), null);
    assert.equal(buildLowerBodyMesh("skirt", anchors, { rows: 40 }), null);
    assert.equal(buildLowerBodyMesh("skirt", anchors, { scale: 4 }), null);
  });
});
