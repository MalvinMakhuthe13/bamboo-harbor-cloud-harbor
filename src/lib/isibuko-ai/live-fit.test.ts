import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildShirtMesh } from "./garment-mesh.ts";
import {
  adaptiveAlpha,
  findSkinPoint,
  hemSway,
  holdCroppedHips,
  neckClearFor,
  planLiveFit,
  predictPoint,
  shouldRevealSkin,
  sleeveCutFor,
  sleeveLengthFor,
  stabilizeMask,
} from "./live-fit.ts";
import { estimateToeNails, fingerNailPlates } from "./placement.ts";
import { PresenceGate } from "./presence.ts";

const shoulders = {
  shoulderL: { x: 0.34, y: 0.28 },
  shoulderR: { x: 0.66, y: 0.3 },
  hipL: { x: 0.4, y: 0.62 },
  hipR: { x: 0.6, y: 0.64 },
};

describe("sleeve and neckline cuts", () => {
  it("keeps a stated sleeveless shirt from painting arms", () => {
    assert.equal(sleeveCutFor("shirt", "sleeveless"), "sleeveless");
    assert.equal(sleeveLengthFor("sleeveless"), 0);
    assert.equal(sleeveLengthFor("short"), 0.46);
    assert.equal(sleeveLengthFor("long"), 1);
    assert.equal(neckClearFor("strapless") > neckClearFor("open"), true);
    assert.equal(neckClearFor("closed"), 0);
  });

  it("shows skin on a bare arm and keeps a long sleeve", () => {
    assert.equal(
      shouldRevealSkin({
        cut: "sleeveless",
        neckline: "open",
        clothes: true,
        inTorso: false,
        inArm: true,
        along: 0.5,
        neckDown: 0.4,
      }),
      true,
    );
    assert.equal(
      shouldRevealSkin({
        cut: "short",
        neckline: "closed",
        clothes: true,
        inTorso: false,
        inArm: true,
        along: 0.8,
        neckDown: 0.5,
      }),
      true,
    );
    assert.equal(
      shouldRevealSkin({
        cut: "long",
        neckline: "closed",
        clothes: true,
        inTorso: false,
        inArm: true,
        along: 0.8,
        neckDown: 0.5,
      }),
      false,
    );
    assert.equal(
      shouldRevealSkin({
        cut: "sleeveless",
        neckline: "open",
        clothes: false,
        inTorso: false,
        inArm: true,
        along: 0.5,
        neckDown: 0.2,
      }),
      false,
    );
  });

  it("builds a torso without sleeve panels when the cut is sleeveless", () => {
    const mesh = buildShirtMesh(
      {
        ...shoulders,
        elbowL: { x: 0.24, y: 0.48 },
        elbowR: { x: 0.76, y: 0.48 },
        wristL: { x: 0.22, y: 0.66 },
        wristR: { x: 0.78, y: 0.66 },
      },
      { sleeveLength: 0 },
    );
    assert.ok(mesh);
    assert.deepEqual(mesh?.parts.map((part) => part.kind), ["torso"]);
  });

  it("narrows the waist and lets a wider hip change the hem", () => {
    const base = buildShirtMesh(shoulders);
    const shaped = buildShirtMesh(shoulders, {
      contour: { shoulder: 0.16, chest: 0.17, waist: 0.11, hip: 0.2 },
    });
    assert.ok(base && shaped);
    const width = (mesh: NonNullable<typeof base>, row: number) => {
      const rowVerts = mesh.vertices.slice(row * mesh.columns, (row + 1) * mesh.columns);
      return Math.abs(rowVerts[rowVerts.length - 1]!.x - rowVerts[0]!.x);
    };
    const waistRow = 5;
    const hemRow = shaped!.rows - 1;
    assert.ok(width(shaped!, waistRow) < width(base!, waistRow));
    assert.ok(width(shaped!, hemRow) > width(base!, hemRow));
  });

  it("moves the hem sideways more than the collar", () => {
    const mesh = buildShirtMesh(shoulders, { sway: 0.02 });
    assert.ok(mesh);
    const top = mesh!.vertices[0]!.x;
    const plain = buildShirtMesh(shoulders);
    const hem = mesh!.vertices[mesh!.vertices.length - 1]!.x;
    const plainHem = plain!.vertices[plain!.vertices.length - 1]!.x;
    assert.ok(Math.abs(top - plain!.vertices[0]!.x) < Math.abs(hem - plainHem));
  });
});

describe("cropped portrait anchors", () => {
  it("keeps the last torso length when the hips fall off the frame", () => {
    const held = holdCroppedHips({
      shoulderL: shoulders.shoulderL,
      shoulderR: shoulders.shoulderR,
      hipL: { x: 0.4, y: 1.04 },
      hipR: { x: 0.6, y: 1.05 },
      visible: false,
      previous: {
        hipL: shoulders.hipL,
        hipR: shoulders.hipR,
        torso: 0.36,
        hipOverShoulder: 0.7,
        held: false,
      },
    });
    assert.equal(held.held, true);
    assert.ok(held.torso > 0.3);
    const collar = (shoulders.shoulderL.y + shoulders.shoulderR.y) / 2;
    assert.ok(held.hipL.y - collar > 0.25);
    assert.ok(held.hipL.y < 1.2);
  });

  it("does not collapse a portrait plan onto the shoulders", () => {
    const plan = planLiveFit({
      category: "shirt",
      sleeve: "long",
      neckline: "closed",
      shoulderL: shoulders.shoulderL,
      shoulderR: shoulders.shoulderR,
      hipL: null,
      hipR: null,
      hipsReported: false,
      previousHips: null,
      mask: null,
      maskW: 0,
      maskH: 0,
      previousContour: null,
      previousHem: null,
      skin: { x: 0.5, y: 0.4 },
    });
    const collar = (plan.meshShoulderL.y + plan.meshShoulderR.y) / 2;
    assert.ok(plan.hipL.y - collar > 0.2);
    assert.equal(plan.sleeveLength, 1);
    assert.equal(plan.revealSkin, false);
  });
});

describe("motion and mask stability", () => {
  it("follows a fast point more readily than a still one", () => {
    assert.ok(adaptiveAlpha(1.2, 16) > adaptiveAlpha(0.01, 16));
    assert.ok(adaptiveAlpha(0.01, 16) < 0.4);
    assert.ok(adaptiveAlpha(1.2, 16) > 0.6);
  });

  it("keeps hem sway small and signed with the motion", () => {
    assert.ok(hemSway(0.8, 0) > 0);
    assert.ok(hemSway(-0.8, 0) < 0);
    assert.equal(hemSway(0, 0), 0);
    assert.ok(Math.abs(hemSway(4, 1)) <= 0.028);
  });

  it("rejects a one-pixel class flicker", () => {
    const width = 5;
    const height = 5;
    const prev = new Uint8Array(width * height).fill(4);
    const next = prev.slice();
    next[12] = 2;
    const stable = stabilizeMask(prev, next, width, height);
    assert.equal(stable[12], 4);
    next[11] = 2;
    next[13] = 2;
    const moved = stabilizeMask(prev, next, width, height);
    assert.equal(moved[12], 2);
  });

  it("finds a body-class pixel and mirrors it into landmark space", () => {
    const width = 10;
    const height = 10;
    const data = new Uint8Array(width * height);
    data[4 * width + 2] = 2;
    const point = findSkinPoint(data, width, height);
    assert.ok(point);
    assert.ok(point!.x > 0.5);
    assert.ok(point!.y > 0.3 && point!.y < 0.6);
  });

  it("leads a moving point by a short capped step and leaves a still point", () => {
    const still = predictPoint({ x: 0.2, y: 0.2 }, { x: 0.2, y: 0.2 }, 16);
    assert.deepEqual(still, { x: 0.2, y: 0.2 });
    const led = predictPoint({ x: 0, y: 0.4 }, { x: 0.04, y: 0.4 }, 16);
    assert.ok(led.x > 0.04);
    assert.ok(led.x - 0.04 <= 0.018);
  });
});

describe("nails", () => {
  it("hides a fingertip covered by a closer finger and keeps the rest", () => {
    const hand = Array.from({ length: 21 }, () => ({ x: 0.2, y: 0.2, z: 0 }));
    hand[4] = { x: 0.3, y: 0.3, z: 0 };
    hand[3] = { x: 0.28, y: 0.28, z: 0 };
    hand[8] = { x: 0.31, y: 0.31, z: -0.05 };
    hand[7] = { x: 0.27, y: 0.27, z: -0.05 };
    const plates = fingerNailPlates([hand]);
    assert.ok(plates.length >= 1);
    assert.equal(plates.some((plate) => plate.tip.x === 0.3 && plate.tip.y === 0.3), false);
  });

  it("places the tracked foot point and four estimated neighbours, or nothing", () => {
    const plates = estimateToeNails({
      ankle: { x: 0.46, y: 0.62 },
      heel: { x: 0.5, y: 0.72 },
      footIndex: { x: 0.5, y: 0.5 },
    });
    assert.equal(plates?.length, 5);
    assert.equal(plates?.[0]?.estimated, false);
    assert.equal(plates?.[1]?.estimated, true);
    assert.ok(Math.hypot((plates?.[0]?.tip.x ?? 0) - 0.5, (plates?.[0]?.tip.y ?? 0) - 0.5) < 0.08);
    assert.ok((plates?.[4]?.tip.y ?? 1) < 0.7);
    assert.equal(
      estimateToeNails({
        ankle: { x: 0.5, y: 0.5 },
        heel: { x: 0.5, y: 0.5 },
        footIndex: { x: 0.51, y: 0.5 },
      }),
      null,
    );
  });
});

describe("presence", () => {
  it("eases in, holds a brief loss, then fades", () => {
    const gate = new PresenceGate();
    assert.equal(gate.update(0, true, 1), 0.4);
    assert.equal(gate.update(40, false, 0), 0.4);
    assert.equal(gate.update(500, false, 0), 0);
    gate.reset();
    assert.equal(gate.update(0, false, 1), 0);
  });
});
