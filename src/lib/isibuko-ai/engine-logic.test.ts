import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { estimateFromWorld, landmarkProportions, matchSize, priorFromHeight, sizeScaleFor } from "./fit.ts";
import {
  allowsRegionPaint,
  CLASS,
  armsAreRaised,
  clothingQuad,
  containPoint,
  followQuad,
  glassesSprite,
  hangingSleeve,
  hugQuad,
  nailSegments,
  wigSprite,
  nailShapeFactors,
  necklineFromMask,
  collarY,
  hidesOriginalHair,
  isPlausibleClothingQuad,
  regionMode,
  spriteShowsCamera,
  stableSide,
  torsoTurn,
  wornLight,
  torsoUv,
  wornFrontTex,
} from "./placement.ts";
import { MODEL_REGISTRY, WEIGHT_BYTES } from "./registry.ts";
import { COMPOSITE_FRAG, GARMENT_MESH_FRAG, GARMENT_MESH_VERT } from "./shaders.ts";

describe("body-constrained shirt mesh renderer", () => {
  it("uses mirrored camera-space coordinates for the mesh", () => {
    assert.ok(GARMENT_MESH_VERT.includes("vScreen = vec2((aClip.x + 1.0) * 0.5, (1.0 - aClip.y) * 0.5)"));
    assert.ok(GARMENT_MESH_VERT.includes("vMaskUv = vec2(1.0 - vScreen.x, 1.0 - vScreen.y)"));
  });

  it("uses the segmentation mask to keep background, hair and face in front", () => {
    assert.ok(GARMENT_MESH_FRAG.includes("bool body = cls > 1.5 && cls < 2.5"));
    assert.ok(GARMENT_MESH_FRAG.includes("bool clothes = cls > 3.5 && cls < 4.5"));
    assert.ok(GARMENT_MESH_FRAG.includes("protectedFace(vScreen) || nearHand(vScreen)"));
    assert.ok(GARMENT_MESH_FRAG.includes("if (uHasFace < 0.5) return false;"));
    assert.ok(GARMENT_MESH_FRAG.includes("bool cloth = clothes || other"));
    assert.ok(GARMENT_MESH_FRAG.includes("if (!(cloth || fringe)) discard"));
  });

  it("keeps the product's transparent background and green-screen key", () => {
    assert.ok(GARMENT_MESH_FRAG.includes("if (product.a < 0.12) discard"));
    assert.ok(GARMENT_MESH_FRAG.includes("if (green > 0.22 && product.g > 0.25) discard"));
  });
});

describe("shader edge definitions", () => {
  it("uses defined ascending smoothstep edges for wig feathering", () => {
    assert.ok(COMPOSITE_FRAG.includes("1.0 - smoothstep(0.78, 1.0, e)"));
    assert.ok(!COMPOSITE_FRAG.includes("smoothstep(1.0, 0.78, e)"));
  });
});

describe("appearance replacement policy", () => {
  it("never paints the protected face", () => {
    assert.equal(
      allowsRegionPaint({
        mode: "hair",
        cls: CLASS.face,
        inGarment: false,
        inHairEllipse: true,
        inProtectedFace: true,
        nearHand: false,
      }),
      false,
    );
  });

  it("lets a fringe cover forehead outside the protected oval", () => {
    assert.equal(
      allowsRegionPaint({
        mode: "hair",
        cls: CLASS.face,
        inGarment: false,
        inHairEllipse: true,
        inProtectedFace: false,
        nearHand: false,
      }),
      true,
    );
  });

  it("replaces clothes and keeps hair in front of a garment", () => {
    assert.equal(
      allowsRegionPaint({
        mode: "clothing",
        cls: CLASS.clothes,
        inGarment: true,
        inHairEllipse: false,
        inProtectedFace: false,
        nearHand: false,
      }),
      true,
    );
    assert.equal(
      allowsRegionPaint({
        mode: "clothing",
        cls: CLASS.hair,
        inGarment: true,
        inHairEllipse: false,
        inProtectedFace: false,
        nearHand: false,
      }),
      false,
    );
    assert.equal(
      allowsRegionPaint({
        mode: "clothing",
        cls: CLASS.background,
        inGarment: true,
        inHairEllipse: false,
        inProtectedFace: false,
        nearHand: false,
      }),
      false,
    );
  });

  it("does not paint a hand that is in front of the body", () => {
    assert.equal(
      allowsRegionPaint({
        mode: "clothing",
        cls: CLASS.body,
        inGarment: true,
        inHairEllipse: false,
        inProtectedFace: false,
        nearHand: true,
      }),
      false,
    );
    assert.equal(
      allowsRegionPaint({
        mode: "clothing",
        cls: CLASS.clothes,
        inGarment: true,
        inHairEllipse: false,
        inProtectedFace: false,
        nearHand: true,
      }),
      false,
    );
  });

  it("keeps a bare arm in front of the garment and still replaces cloth", () => {
    assert.equal(
      allowsRegionPaint({
        mode: "clothing",
        cls: CLASS.body,
        inGarment: true,
        inHairEllipse: false,
        inProtectedFace: false,
        nearHand: false,
        onArm: true,
      }),
      false,
    );
    assert.equal(
      allowsRegionPaint({
        mode: "clothing",
        cls: CLASS.clothes,
        inGarment: false,
        inHairEllipse: false,
        inProtectedFace: false,
        nearHand: false,
        onArm: true,
      }),
      true,
    );
    assert.equal(
      allowsRegionPaint({
        mode: "clothing",
        cls: CLASS.other,
        inGarment: true,
        inHairEllipse: false,
        inProtectedFace: false,
        nearHand: false,
        onArm: false,
      }),
      false,
    );
    assert.equal(
      allowsRegionPaint({
        mode: "clothing",
        cls: CLASS.body,
        inGarment: true,
        inHairEllipse: false,
        inProtectedFace: false,
        nearHand: false,
        onArm: false,
      }),
      true,
    );
  });

  it("lets the face and a hand cover a wig, hat, or necklace plate", () => {
    assert.equal(spriteShowsCamera({ category: "wig", cls: CLASS.face, nearHand: false, hasMask: true }), true);
    assert.equal(spriteShowsCamera({ category: "hat", cls: CLASS.hair, nearHand: true, hasMask: true }), true);
    assert.equal(spriteShowsCamera({ category: "necklace", cls: CLASS.body, nearHand: false, hasMask: true }), false);
    assert.equal(spriteShowsCamera({ category: "glasses", cls: CLASS.face, nearHand: true, hasMask: true }), false);
    assert.equal(spriteShowsCamera({ category: "wig", cls: CLASS.face, nearHand: false, hasMask: false }), false);
  });

  it("clears original hair outside the protected face and leaves the face", () => {
    assert.equal(hidesOriginalHair({ cls: CLASS.hair, inProtectedFace: false }), true);
    assert.equal(hidesOriginalHair({ cls: CLASS.hair, inProtectedFace: true }), false);
    assert.equal(hidesOriginalHair({ cls: CLASS.face, inProtectedFace: false }), false);
  });
});

describe("product conditioning", () => {
  it("maps categories onto hair, clothing, or an accessory sprite", () => {
    assert.equal(regionMode("wig"), "hair");
    assert.equal(regionMode("shirt"), "clothing");
    assert.equal(regionMode("skirt"), "clothing");
    assert.equal(regionMode("dress"), "clothing");
    assert.equal(regionMode("bracelet"), "none");
    assert.equal(regionMode("glasses"), "none");
    assert.equal(regionMode("nails"), "none");
  });

  it("rejects garment geometry that could create a frame-sized overlay", () => {
    assert.equal(
      isPlausibleClothingQuad({
        topL: { x: -0.4, y: 0.2 },
        topR: { x: 1.4, y: 0.2 },
        botL: { x: -0.5, y: 0.9 },
        botR: { x: 1.5, y: 0.9 },
      }),
      false,
    );
  });

  it("rejects collapsed and non-finite pose geometry", () => {
    assert.equal(
      isPlausibleClothingQuad({
        topL: { x: 0.5, y: 0.3 },
        topR: { x: 0.5, y: 0.3 },
        botL: { x: 0.5, y: 0.7 },
        botR: { x: 0.5, y: 0.7 },
      }),
      false,
    );
    assert.equal(
      isPlausibleClothingQuad({
        topL: { x: Number.NaN, y: 0.3 },
        topR: { x: 0.6, y: 0.3 },
        botL: { x: 0.4, y: 0.7 },
        botR: { x: 0.6, y: 0.7 },
      }),
      false,
    );
  });

  it("rejects a folded garment quad with crossed corners", () => {
    assert.equal(
      isPlausibleClothingQuad({
        topL: { x: 0.3, y: 0.3 },
        topR: { x: 0.7, y: 0.3 },
        botL: { x: 0.3, y: 0.7 },
        botR: { x: 0.25, y: 0.45 },
      }),
      false,
    );
  });

  it("accepts a normal upper-body garment quad", () => {
    assert.equal(
      isPlausibleClothingQuad({
        topL: { x: 0.3, y: 0.3 },
        topR: { x: 0.7, y: 0.3 },
        botL: { x: 0.34, y: 0.72 },
        botR: { x: 0.66, y: 0.72 },
      }),
      true,
    );
  });

  it("lets the hem follow the shoulders instead of jumping with them", () => {
    const still = clothingQuad({
      shoulderL: { x: 0.32, y: 0.34 },
      shoulderR: { x: 0.68, y: 0.34 },
      hipL: { x: 0.36, y: 0.72 },
      hipR: { x: 0.64, y: 0.72 },
      category: "shirt",
      scale: 1,
      sleevesInPhoto: false,
    });
    const turned = clothingQuad({
      shoulderL: { x: 0.42, y: 0.34 },
      shoulderR: { x: 0.78, y: 0.34 },
      hipL: { x: 0.46, y: 0.72 },
      hipR: { x: 0.74, y: 0.72 },
      category: "shirt",
      scale: 1,
      sleevesInPhoto: false,
    });
    const followed = followQuad(still, turned);
    const shoulderGap = Math.abs(followed.topL.x - turned.topL.x);
    const hemGap = Math.abs(followed.botL.x - turned.botL.x);
    assert.ok(hemGap > shoulderGap);
    assert.ok(hemGap < 0.2);
    const settled = followQuad(turned, turned);
    assert.equal(settled.botL.x, turned.botL.x);
    assert.equal(settled.topR.y, turned.topR.y);
  });

  it("covers the shoulder of the shirt already being worn", () => {
    const quad = clothingQuad({
      shoulderL: { x: 0.3, y: 0.34 },
      shoulderR: { x: 0.7, y: 0.34 },
      hipL: { x: 0.34, y: 0.74 },
      hipR: { x: 0.66, y: 0.74 },
      category: "shirt",
      scale: 1,
      sleevesInPhoto: false,
    });
    const hugged = hugQuad(quad, "shirt");
    const width = (q: { topL: { x: number }; topR: { x: number }; botL: { x: number }; botR: { x: number } }, hem: boolean) =>
      hem ? Math.abs(q.botR.x - q.botL.x) : Math.abs(q.topR.x - q.topL.x);
    assert.ok(width(hugged, false) > width(quad, false));
    assert.ok(width(hugged, true) < width(hugged, false));
    assert.ok(Math.abs((hugged.topL.x + hugged.topR.x) / 2 - (quad.topL.x + quad.topR.x) / 2) < 0.001);
  });

  it("keeps each arm on its own side when the detector swaps them", () => {
    const left = { x: 0.32, y: 0.4 };
    const right = { x: 0.68, y: 0.4 };
    const swapped = stableSide(left, right, right, left);
    assert.equal(swapped.swapped, true);
    assert.equal(swapped.left.x, left.x);
    assert.equal(swapped.right.x, right.x);
    const moved = stableSide(left, right, { x: 0.36, y: 0.42 }, { x: 0.64, y: 0.48 });
    assert.equal(moved.swapped, false);
    assert.equal(moved.left.x, 0.36);
  });

  it("reads the neckline from the top of the clothes mask, not a low pose joint", () => {
    const width = 20;
    const height = 20;
    const data = new Uint8Array(width * height);
    for (let y = 12; y < height; y++) {
      for (let x = 0; x < width; x++) data[y * width + x] = 4;
    }
    const neck = necklineFromMask(data, width, height);
    assert.ok(neck != null);
    assert.ok(Math.abs((neck ?? 0) - 12 / 20) < 1e-6);
    assert.equal(necklineFromMask(new Uint8Array(width * height), width, height), null);
    assert.ok(Math.abs(collarY(0.4, 0.6) - 0.544) < 1e-6);
    assert.equal(collarY(0.5, 0.42), 0.42);
  });

  it("wears the front of the shirt and leaves the throat clear", () => {
    const centre = wornFrontTex(0, 0.5, 0);
    assert.ok(centre);
    assert.ok(Math.abs(centre.u - 0.5) < 0.04);
    assert.ok(centre.v > 0.18 && centre.v < 0.95);
    assert.equal(wornFrontTex(0, 0.05, 0), null);
    const turned = wornFrontTex(0, 0.5, 1);
    assert.ok(turned);
    assert.ok(turned.u > 0.3 && turned.u < 0.7);
    assert.ok(torsoTurn({ x: 0.3, y: 0.4 }, { x: 0.7, y: 0.4 }, { x: 0.62, y: 0.3 }) > 0);
    const hung = hangingSleeve({ x: 0.3, y: 0.35 }, { x: 0.34, y: 0.8 }, -0.08);
    assert.ok(hung.wrist.y > hung.elbow.y);
    assert.ok(hung.elbow.x < 0.3);
    const flat = wornLight(0.8, 0.7, 0.7);
    const crease = wornLight(0.8, 0.55, 0.7);
    assert.ok(crease < flat);
    assert.ok(wornLight(0.8, 0.85, 0.7) > flat);
  });

  it("keeps the centre of a torso inside the garment", () => {
    const quad = clothingQuad({
      shoulderL: { x: 0.32, y: 0.34 },
      shoulderR: { x: 0.68, y: 0.34 },
      hipL: { x: 0.36, y: 0.72 },
      hipR: { x: 0.64, y: 0.72 },
      category: "shirt",
      scale: 1,
    });
    const uv = torsoUv({ x: 0.5, y: 0.5 }, quad);
    assert.ok(uv);
    assert.ok(Math.abs(uv.u) < 0.35);
    assert.ok(uv.v > 0.15 && uv.v < 0.9);
  });

  it("keeps the collar off the throat", () => {
    const quad = clothingQuad({
      shoulderL: { x: 0.32, y: 0.42 },
      shoulderR: { x: 0.68, y: 0.42 },
      hipL: { x: 0.36, y: 0.78 },
      hipR: { x: 0.64, y: 0.78 },
      category: "shirt",
      scale: 1,
    });
    assert.equal(torsoUv({ x: 0.5, y: 0.3 }, quad), null);
    assert.ok(quad.topL.x < 0.32);
    assert.ok(quad.topL.x > 0.18);
  });

  it("treats hanging arms as part of the garment photo", () => {
    assert.equal(
      armsAreRaised({
        shoulderL: { x: 0.35, y: 0.4 },
        shoulderR: { x: 0.65, y: 0.4 },
        elbowL: { x: 0.32, y: 0.62 },
        elbowR: { x: 0.68, y: 0.62 },
        wristL: { x: 0.3, y: 0.84 },
        wristR: { x: 0.7, y: 0.84 },
      }),
      false,
    );
    assert.equal(
      armsAreRaised({
        shoulderL: { x: 0.35, y: 0.4 },
        shoulderR: { x: 0.65, y: 0.4 },
        elbowL: { x: 0.12, y: 0.28 },
        elbowR: { x: 0.68, y: 0.62 },
        wristL: { x: 0.08, y: 0.16 },
        wristR: { x: 0.7, y: 0.84 },
      }),
      true,
    );
  });

  it("scales glasses from the distance between the eyes", () => {
    const sprite = glassesSprite({ x: 0.4, y: 0.4 }, { x: 0.6, y: 0.4 }, 0.34, 1);
    assert.ok(Math.abs(sprite.w - 0.2 * 2.55) < 1e-6);
    assert.equal(sprite.cx, 0.5);
  });

  it("keeps polish inside the distal nail plate instead of extending past the fingertip", () => {
    for (const shape of ["almond", "square", "stiletto"] as const) {
      const factors = nailShapeFactors(shape);
      assert.ok(factors.start >= 0.4 && factors.start < factors.tip);
      assert.ok(factors.tip <= 1);
      assert.ok(factors.half > 0 && factors.half <= 0.15);
    }
  });

  it("sizes the wig plate to a plausible multiple of face width", () => {
    const face = {
      forehead: { x: 0.5, y: 0.3 },
      chin: { x: 0.5, y: 0.7 },
      cheekL: { x: 0.4, y: 0.5 },
      cheekR: { x: 0.6, y: 0.5 },
    };
    const sprite = wigSprite(face.forehead, face.chin, face.cheekL, face.cheekR, 1.1, 1, 0.12, 0.42);
    assert.ok(sprite.w / 0.2 < 2.3);
    assert.ok(sprite.w / 0.2 > 2.0);
  });

  it("reads ten nail tips from two hands", () => {
    const hand = Array.from({ length: 21 }, (_, i) => ({ x: i / 21, y: 0.5 }));
    assert.equal(nailSegments([hand, hand]).length, 10);
  });
});

describe("fit", () => {
  it("picks the shirt size that contains the chest", () => {
    const rows = [
      { label: "S", chest: [82, 90] as [number, number] },
      { label: "M", chest: [90, 98] as [number, number] },
      { label: "L", chest: [98, 106] as [number, number] },
    ];
    assert.equal(matchSize(rows, { chestCm: 94 })?.size, "M");
  });

  it("warns when a measurement is well outside the row", () => {
    const rows = [{ label: "M", chest: [90, 98] as [number, number] }];
    const fit = matchSize(rows, { chestCm: 110 });
    assert.equal(fit?.size, "M");
    assert.match(fit?.warning ?? "", /tight/);
  });

  it("does not invent centimetres when no stature was given", () => {
    const body = estimateFromWorld({
      world: [{ x: 0, y: 0, z: 0 }],
      heightCm: null,
      faceWidthCm: 14,
      wristCm: 16,
    });
    assert.equal(body.source, "none");
    assert.equal(body.chestCm, null);
    assert.equal(body.shoulderCm, null);
    assert.match(landmarkProportions().note, /not a clothing size/i);
  });

  it("derives a stature prior from height", () => {
    const body = priorFromHeight(170);
    assert.equal(body.source, "height-prior");
    assert.ok((body.chestCm ?? 0) > 80 && (body.chestCm ?? 0) < 100);
  });

  it("changes the garment scale with the chosen size", () => {
    assert.ok(sizeScaleFor("S") < sizeScaleFor("M"));
    assert.ok(sizeScaleFor("XL") > sizeScaleFor("L"));
  });
});

describe("registry", () => {
  it("does not claim the untrained video model is live", () => {
    const video = MODEL_REGISTRY.find((model) => model.id === "isibuko.video-diffusion");
    assert.equal(video?.status, "inactive");
    assert.equal(video?.live, false);
    assert.ok(MODEL_REGISTRY.some((model) => model.id === "isibuko.composite" && model.live));
    assert.ok(WEIGHT_BYTES.segmenter > WEIGHT_BYTES.face);
  });
});

describe("pointer mapping", () => {
  it("accounts for letterboxing", () => {
    const point = containPoint({
      clientX: 100,
      clientY: 100,
      rect: { left: 0, top: 0, width: 200, height: 200 },
      bitmapW: 100,
      bitmapH: 200,
    });
    assert.deepEqual(point, { x: 50, y: 100 });
  });
});
