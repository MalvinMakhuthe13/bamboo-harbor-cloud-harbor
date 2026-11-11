/** Body correspondence for a measured garment. It does not warp pixels onto a person. */

import { torsoUv, type Quad } from "../isibuko-ai/placement.ts";
import type { GarmentReading } from "./garment-encoder.ts";

export type Pt = { x: number; y: number };

export type FaceBox = { x: number; y: number; w: number; h: number };

export type GarmentPlacement = {
  generative: false;
  learnedDeformation: false;
  inpainting: false;
  replacesPixels: false;
  method: "geometric-correspondence";
  scale: number;
  correspondences: { garment: string; body: string; at: Pt }[];
  handOccludesTorso: boolean;
  paintableIntersectsFace: boolean;
  identityPreserved: boolean;
  blocked: string | null;
};

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function mid(a: Pt, b: Pt): Pt {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function lerp(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function faceCorners(face: FaceBox): Pt[] {
  return [
    { x: face.x, y: face.y },
    { x: face.x + face.w, y: face.y },
    { x: face.x, y: face.y + face.h },
    { x: face.x + face.w, y: face.y + face.h },
    { x: face.x + face.w / 2, y: face.y + face.h / 2 },
  ];
}

export function placeGarment(input: {
  reading: GarmentReading;
  frameWidth: number;
  shoulderL: Pt;
  shoulderR: Pt;
  elbowL: Pt;
  elbowR: Pt;
  hipL: Pt;
  hipR: Pt;
  hand: Pt | null;
  face: FaceBox;
}): GarmentPlacement {
  const shoulderPx = Math.max(1, input.reading.shoulderWidthPx);
  const scale = dist(input.shoulderL, input.shoulderR) / (shoulderPx / input.frameWidth);
  const sleeveReach = Math.min(1, input.reading.sleeveLengthPx / Math.max(1, input.reading.torsoLengthPx));
  const quad: Quad = {
    topL: input.shoulderL,
    topR: input.shoulderR,
    botL: input.hipL,
    botR: input.hipR,
  };
  const handOccludesTorso = input.hand ? torsoUv(input.hand, quad) !== null : false;
  const paintableIntersectsFace = faceCorners(input.face).some((point) => torsoUv(point, quad) !== null);
  const neck = mid(input.shoulderL, input.shoulderR);
  neck.y -= 0.04;
  return {
    generative: false,
    learnedDeformation: false,
    inpainting: false,
    replacesPixels: false,
    method: "geometric-correspondence",
    scale,
    correspondences: [
      { garment: "collar", body: "between-shoulders", at: neck },
      { garment: "left-sleeve", body: "left-arm", at: lerp(input.shoulderL, input.elbowL, sleeveReach) },
      { garment: "right-sleeve", body: "right-arm", at: lerp(input.shoulderR, input.elbowR, sleeveReach) },
      { garment: "hem", body: "hip-line", at: mid(input.hipL, input.hipR) },
    ],
    handOccludesTorso,
    paintableIntersectsFace,
    identityPreserved: !paintableIntersectsFace,
    blocked: paintableIntersectsFace ? "The garment region meets the face. Placement stops." : null,
  };
}
