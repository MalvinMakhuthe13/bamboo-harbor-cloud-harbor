import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDressMesh } from "./dress-mesh.ts";

const anchors = {
  shoulderL: { x: 0.34, y: 0.28 },
  shoulderR: { x: 0.66, y: 0.28 },
  hipL: { x: 0.41, y: 0.58 },
  hipR: { x: 0.59, y: 0.58 },
  kneeL: { x: 0.40, y: 0.86 },
  kneeR: { x: 0.60, y: 0.86 },
};

describe("continuous dress mesh", () => {
  it("builds one connected shoulder-to-hem surface", () => {
    const mesh = buildDressMesh(anchors);
    assert.ok(mesh);
    assert.equal(mesh.parts.length, 1);
    assert.equal(mesh.parts[0]?.kind, "torso");
    assert.equal(mesh.vertices.length, mesh.columns * mesh.rows);
    assert.equal(mesh.indices.length, (mesh.columns - 1) * (mesh.rows - 1) * 6);
  });

  it("keeps a continuous row topology from neckline to hem", () => {
    const mesh = buildDressMesh(anchors);
    assert.ok(mesh);
    for (let row = 0; row < mesh.rows; row++) {
      const rowVertices = mesh.vertices.slice(row * mesh.columns, (row + 1) * mesh.columns);
      assert.equal(rowVertices.length, mesh.columns);
      assert.ok(rowVertices.every((vertex) => Number.isFinite(vertex.x) && Number.isFinite(vertex.y)));
      assert.ok(rowVertices.every((vertex, index) => vertex.u === index / (mesh.columns - 1)));
      assert.ok(rowVertices.every((vertex) => vertex.v === row / (mesh.rows - 1)));
    }
    assert.equal(mesh.vertices[0]?.u, 0);
    assert.equal(mesh.vertices[mesh.columns - 1]?.u, 1);
    assert.equal(mesh.vertices[0]?.v, 0);
    assert.equal(mesh.vertices.at(-1)?.v, 1);
  });

  it("flares the hem beyond the waist while keeping the top shoulder width", () => {
    const mesh = buildDressMesh(anchors);
    assert.ok(mesh);
    const rowWidth = (row: number) => {
      const vertices = mesh.vertices.slice(row * mesh.columns, (row + 1) * mesh.columns);
      return Math.hypot(vertices.at(-1)!.x - vertices[0]!.x, vertices.at(-1)!.y - vertices[0]!.y);
    };
    assert.ok(rowWidth(mesh.rows - 1) > rowWidth(Math.round(mesh.rows * 0.58)));
    assert.ok(rowWidth(0) > rowWidth(Math.round(mesh.rows * 0.58)));
  });

  it("follows a leaning body axis when knee landmarks are available", () => {
    const leaning = {
      ...anchors,
      kneeL: { x: 0.55, y: 0.83 },
      kneeR: { x: 0.73, y: 0.83 },
    };
    const mesh = buildDressMesh(leaning);
    assert.ok(mesh);
    const hem = mesh.vertices.slice(-mesh.columns);
    const hemCenter = hem.reduce((sum, vertex) => sum + vertex.x, 0) / hem.length;
    assert.ok(hemCenter > 0.59);
  });

  it("uses a vertical fallback when knee landmarks are unavailable", () => {
    const mesh = buildDressMesh({ shoulderL: anchors.shoulderL, shoulderR: anchors.shoulderR, hipL: anchors.hipL, hipR: anchors.hipR });
    assert.ok(mesh);
    const top = mesh.vertices.slice(0, mesh.columns);
    const hem = mesh.vertices.slice(-mesh.columns);
    const center = (row: typeof top) => row.reduce((sum, vertex) => sum + vertex.x, 0) / row.length;
    assert.ok(Math.abs(center(top) - center(hem)) < 0.02);
  });

  it("rejects collapsed landmarks and unsafe mesh settings", () => {
    assert.equal(buildDressMesh({ ...anchors, shoulderR: anchors.shoulderL }), null);
    assert.equal(buildDressMesh({ ...anchors, hipL: { x: Number.NaN, y: 0.5 } }), null);
    assert.equal(buildDressMesh(anchors, { columns: 2 }), null);
    assert.equal(buildDressMesh(anchors, { rows: 40 }), null);
    assert.equal(buildDressMesh(anchors, { hemWidth: 4 }), null);
  });

  it("keeps all vertex attributes finite and indices in range", () => {
    const mesh = buildDressMesh(anchors);
    assert.ok(mesh);
    assert.ok(mesh.vertices.every((vertex) => [vertex.x, vertex.y, vertex.u, vertex.v].every(Number.isFinite)));
    assert.ok(mesh.indices.every((index) => Number.isInteger(index) && index >= 0 && index < mesh.vertices.length));
  });
});
