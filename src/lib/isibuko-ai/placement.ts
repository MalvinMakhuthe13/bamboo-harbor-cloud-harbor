import type { Category, NailShape, Pt } from "@/lib/isibuko-ai/types";

export const CLASS = {
  background: 0,
  hair: 1,
  body: 2,
  face: 3,
  clothes: 4,
  other: 5,
} as const;

export type RegionMode = "none" | "clothing" | "hair";

export function regionMode(category: Category | null): RegionMode {
  if (category === "wig") return "hair";
  if (category === "shirt" || category === "jacket" || category === "dress" || category === "pants" || category === "skirt") return "clothing";
  return "none";
}

/**
 * Whether a pixel may be replaced. The face oval is never replaced.
 * Hair in front of a garment occludes it. Background is not painted as cloth.
 * Forehead pixels outside the protected oval may take a fringe.
 */
export function allowsRegionPaint(opts: {
  mode: RegionMode;
  cls: number;
  inGarment: boolean;
  inHairEllipse: boolean;
  inProtectedFace: boolean;
  nearHand: boolean;
  /** Body-skin inside a shoulder-to-wrist arm, including where that arm crosses the torso. */
  onArm?: boolean;
}): boolean {
  if (opts.mode === "none") return false;
  if (opts.inProtectedFace) return false;
  // A tracked hand stays the camera, including where it crosses a garment.
  if (opts.mode === "clothing" && opts.nearHand) return false;
  if (opts.mode === "clothing") {
    if (!opts.inGarment && !opts.onArm) return false;
    if (opts.cls === CLASS.background || opts.cls === CLASS.hair || opts.cls === CLASS.face || opts.cls === CLASS.other) return false;
    // A bare arm stays the person's arm. Cloth already on that arm can take the product sleeve.
    if (opts.onArm) return opts.cls === CLASS.clothes;
    return opts.cls === CLASS.clothes || opts.cls === CLASS.body;
  }
  if (!opts.inHairEllipse) return false;
  return true;
}

/** A cut-out plate must not cover the face or a hand that is in front of it. */
export function spriteShowsCamera(opts: { category: Category | null; cls: number; nearHand: boolean; hasMask: boolean }): boolean {
  if (!opts.hasMask) return false;
  if (opts.category !== "wig" && opts.category !== "hat" && opts.category !== "necklace") return false;
  if (opts.nearHand) return true;
  return opts.cls === CLASS.face;
}

/** Segmented hair outside the protected face is cleared so the wig plate is the hair, not a sticker on top of it. */
export function hidesOriginalHair(opts: { cls: number; inProtectedFace: boolean }): boolean {
  if (opts.inProtectedFace) return false;
  return opts.cls === CLASS.hair;
}

export function smoothPoint(prev: Pt | null, next: Pt, alpha: number): Pt {
  if (!prev) return { x: next.x, y: next.y };
  return {
    x: prev.x + (next.x - prev.x) * alpha,
    y: prev.y + (next.y - prev.y) * alpha,
  };
}

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function add(a: Pt, b: Pt, scale = 1): Pt {
  return { x: a.x + b.x * scale, y: a.y + b.y * scale };
}

function sub(a: Pt, b: Pt): Pt {
  return { x: a.x - b.x, y: a.y - b.y };
}

function mid(a: Pt, b: Pt): Pt {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function norm(v: Pt): Pt {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
}

function scaleAbout(center: Pt, p: Pt, s: number): Pt {
  return { x: center.x + (p.x - center.x) * s, y: center.y + (p.y - center.y) * s };
}

export type Quad = { topL: Pt; topR: Pt; botL: Pt; botR: Pt };


/**
 * Reject implausible tracker geometry before it reaches the garment shader.
 * A bad pose should temporarily hide the preview, never stretch a product
 * across the frame or paint it at a guessed location.
 */
export function isPlausibleClothingQuad(quad: Quad): boolean {
  const points = [quad.topL, quad.topR, quad.botL, quad.botR];
  if (points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return false;
  if (points.some((point) => point.x < -0.2 || point.x > 1.2 || point.y < -0.2 || point.y > 1.2)) return false;

  const topWidth = dist(quad.topL, quad.topR);
  const bottomWidth = dist(quad.botL, quad.botR);
  const length = dist(mid(quad.topL, quad.topR), mid(quad.botL, quad.botR));
  if (topWidth < 0.045 || topWidth > 0.82) return false;
  if (bottomWidth < 0.035 || bottomWidth > 1.05) return false;
  if (length < 0.055 || length > 1.15) return false;
  const widthRatio = bottomWidth / topWidth;
  if (widthRatio < 0.35 || widthRatio > 2.2) return false;

  // The shader assumes a non-folded garment surface. Reject crossed or
  // concave corners so a bad landmark order cannot mirror/fold the texture.
  const polygon = [quad.topL, quad.topR, quad.botR, quad.botL];
  const crosses = polygon.map((point, index) => {
    const next = polygon[(index + 1) % polygon.length]!;
    const after = polygon[(index + 2) % polygon.length]!;
    return (next.x - point.x) * (after.y - next.y) - (next.y - point.y) * (after.x - next.x);
  });
  const nonZero = crosses.filter((value) => Math.abs(value) > 1e-5);
  if (nonZero.length !== 4) return false;
  const clockwise = nonZero.every((value) => value > 0);
  const counterClockwise = nonZero.every((value) => value < 0);
  return clockwise || counterClockwise;
}

export function clothingQuad(opts: {
  shoulderL: Pt;
  shoulderR: Pt;
  hipL: Pt;
  hipR: Pt;
  category: "shirt" | "jacket" | "dress" | "pants" | "skirt";
  ankleL?: Pt | null;
  ankleR?: Pt | null;
  scale: number;
  /** When the arms hang, the product photo's own sleeves are mapped with the torso. */
  sleevesInPhoto?: boolean;
}): Quad {
  const s = opts.scale;
  if (opts.category === "pants" || opts.category === "skirt") {
    const hipMid = mid(opts.hipL, opts.hipR);
    const shMid = mid(opts.shoulderL, opts.shoulderR);
    const down = norm(sub(hipMid, shMid));
    const torso = Math.max(dist(shMid, hipMid), dist(opts.hipL, opts.hipR));
    const waistL = add(opts.hipL, down, -torso * 0.12);
    const waistR = add(opts.hipR, down, -torso * 0.12);
    const hem = (hip: Pt, ankle: Pt | null | undefined) => {
      if (opts.category === "skirt") {
        if (ankle) return { x: hip.x + (ankle.x - hip.x) * 0.46, y: hip.y + (ankle.y - hip.y) * 0.46 };
        return add(hip, down, torso * 0.62);
      }
      return ankle ?? add(hip, down, torso * 1.35);
    };
    const botL = hem(opts.hipL, opts.ankleL);
    const botR = hem(opts.hipR, opts.ankleR);
    const top = mid(waistL, waistR);
    return {
      topL: scaleAbout(top, waistL, s),
      topR: scaleAbout(top, waistR, s),
      botL: scaleAbout(mid(botL, botR), botL, s * (opts.category === "skirt" ? 0.92 : 0.86)),
      botR: scaleAbout(mid(botL, botR), botR, s * (opts.category === "skirt" ? 0.92 : 0.86)),
    };
  }
  const shMid = mid(opts.shoulderL, opts.shoulderR);
  const hipMid = mid(opts.hipL, opts.hipR);
  const up = norm(sub(shMid, hipMid));
  const torso = Math.max(dist(shMid, hipMid), 0.08);
  const span = Math.max(dist(opts.shoulderL, opts.shoulderR), 0.05);
  // Collar sits on the shoulder line. Pulling it higher smears the collar band up the throat.
  const raise = span * (opts.category === "jacket" ? 0.1 : 0.05);
  let topL = scaleAbout(shMid, add(opts.shoulderL, up, raise), s);
  let topR = scaleAbout(shMid, add(opts.shoulderR, up, raise), s);
  const extra = opts.category === "dress" ? 0.95 : opts.category === "jacket" ? 0.42 : 0.16;
  let botL = scaleAbout(hipMid, add(opts.hipL, up, -torso * extra), s);
  let botR = scaleAbout(hipMid, add(opts.hipR, up, -torso * extra), s);
  if (opts.category === "shirt" || opts.category === "jacket") {
    if (opts.sleevesInPhoto !== false) {
      const across = norm(sub(opts.shoulderR, opts.shoulderL));
      const sleeve = span * (opts.category === "jacket" ? 0.16 : 0.1) * s;
      topL = add(topL, across, -sleeve);
      topR = add(topR, across, sleeve);
      botL = add(botL, across, -sleeve * 0.35);
      botR = add(botR, across, sleeve * 0.35);
    }
  }
  return { topL, topR, botL, botR };
}

/** Pulls the product photograph onto the torso. Shoulders sit inside the arm, and a shirt narrows toward the waist. */
export function hugQuad(quad: Quad, category: "shirt" | "jacket" | "dress" | "pants" | "skirt"): Quad {
  const toward = (from: Pt, to: Pt, amount: number): Pt => ({
    x: from.x + (to.x - from.x) * amount,
    y: from.y + (to.y - from.y) * amount,
  });
  const top = mid(quad.topL, quad.topR);
  const bot = mid(quad.botL, quad.botR);
  // A shirt has to cover the shoulder caps of the clothes already being worn.
  // Pulling it inside the joints leaves those sleeves showing.
  const topIn = category === "shirt" || category === "jacket" ? -0.22 : category === "pants" ? 0.06 : category === "skirt" ? 0.16 : 0.02;
  const botIn = category === "shirt" || category === "jacket" ? 0.02 : category === "dress" || category === "skirt" ? 0.04 : category === "pants" ? 0.12 : 0.08;
  return {
    topL: toward(quad.topL, top, topIn),
    topR: toward(quad.topR, top, topIn),
    botL: toward(quad.botL, bot, botIn),
    botR: toward(quad.botR, bot, botIn),
  };
}

/** Keeps the left limb on the left. A one-frame detector swap is rejected. */
export function stableSide(prevL: Pt | null, prevR: Pt | null, nextL: Pt, nextR: Pt): { left: Pt; right: Pt; swapped: boolean } {
  if (!prevL || !prevR) return { left: nextL, right: nextR, swapped: false };
  const direct = dist(prevL, nextL) + dist(prevR, nextR);
  const crossed = dist(prevL, nextR) + dist(prevR, nextL);
  if (crossed + 0.02 < direct) return { left: nextR, right: nextL, swapped: true };
  return { left: nextL, right: nextR, swapped: false };
}

/**
 * Where the front of a flat-lay garment lands. `across` is -1..1 on the chest,
 * `down` is 0 at the shoulders. The collar opening is not placed on the throat.
 * A turn slides along the front panel and stops before the sleeves or the back.
 */
export function wornFrontTex(across: number, down: number, yaw: number): { u: number; v: number } | null {
  if (down < 0 || down > 1 || Math.abs(across) > 0.96) return null;
  if (down < 0.08 && Math.abs(across) < 0.12) return null;
  const slide = Math.max(-0.85, Math.min(0.85, yaw));
  const side = Math.max(-0.5, Math.min(0.5, across * 0.55 - slide * 0.18));
  let u = 0.3 + (side + 0.5) * (0.7 - 0.3);
  u += Math.sin(down * 24 + across * 5) * 0.012 * Math.abs(slide);
  u = Math.max(0.3, Math.min(0.7, u));
  const v = down < 0.08 ? 0.02 + (down / 0.08) * 0.1 : 0.16 + ((down - 0.08) / 0.92) * 0.78;
  return { u, v };
}

export function armIsHanging(shoulder: Pt, elbow: Pt | null, span: number): boolean {
  if (!elbow) return true;
  return dist(shoulder, elbow) < Math.max(span, 0.05) * 0.22;
}

/**
 * Top of the clothes class in the centre of the frame, as a fraction of height.
 * BlazePose drops the shoulders when the hips are out of frame. The worn shirt's
 * own mask is the neckline. Returns null when there is not enough cloth to trust.
 */
export function necklineFromMask(data: Uint8Array, width: number, height: number): number | null {
  if (width < 8 || height < 8 || data.length < width * height) return null;
  const x0 = Math.floor(width * 0.32);
  const x1 = Math.ceil(width * 0.68);
  const tops: number[] = [];
  for (let x = x0; x < x1; x++) {
    for (let y = 0; y < height; y++) {
      const cls = data[y * width + x] ?? 0;
      if (cls === 4 || cls === 5) {
        tops.push(y / height);
        break;
      }
    }
  }
  if (tops.length < (x1 - x0) * 0.45) return null;
  tops.sort((a, b) => a - b);
  return tops[Math.floor(tops.length * 0.15)]!;
}

/** Collar between the chin and the top of the clothes already being worn. 0.72 sits on the neckline, not the throat. */
export function collarY(chinY: number, clothesTopY: number): number {
  if (!(clothesTopY > chinY)) return clothesTopY;
  return chinY + (clothesTopY - chinY) * 0.72;
}

/** A sleeve for an arm that hangs beside the body, outside the shirt the person already has on. */
export function hangingSleeve(shoulder: Pt, hip: Pt, outward: number): { elbow: Pt; wrist: Pt } {
  const drop = Math.max(hip.y - shoulder.y, 0.18);
  return {
    elbow: { x: shoulder.x + outward, y: shoulder.y + drop * 0.5 },
    wrist: { x: shoulder.x + outward * 1.15, y: shoulder.y + drop * 0.98 },
  };
}

/** The product keeps its colour. Creases come from the shirt already on the body. */
export function wornLight(product: number, camera: number, around: number): number {
  const wrinkle = (camera - around) * 7;
  const form = (around - 0.62) * 0.9;
  const scale = Math.min(1.3, Math.max(0.5, 0.9 + wrinkle + form));
  return product * scale;
}

export function torsoTurn(shL: Pt, shR: Pt, nose: Pt | null): number {
  if (!nose) return 0;
  const span = Math.max(dist(shL, shR), 0.05);
  const mid = (shL.x + shR.x) / 2;
  return Math.max(-1, Math.min(1, (nose.x - mid) / (span * 0.5)));
}

/**
 * The shoulders take the new pose first. The hem catches up over the next frames,
 * and it cannot drift farther than a fraction of the torso. This is the product
 * photograph following the body. It does not generate new cloth.
 */
export function followQuad(prev: Quad | null, next: Quad, lead = 0.84, trail = 0.62, maxLag = 0.07): Quad {
  if (!prev) return next;
  const torso = Math.max(dist(next.topL, next.botL), dist(next.topR, next.botR), dist(mid(next.topL, next.topR), mid(next.botL, next.botR)), 0.08);
  const limit = torso * maxLag;
  const step = (from: Pt, to: Pt, alpha: number, cap: number): Pt => {
    const x = from.x + (to.x - from.x) * alpha;
    const y = from.y + (to.y - from.y) * alpha;
    const dx = x - to.x;
    const dy = y - to.y;
    const d = Math.hypot(dx, dy);
    if (d <= cap || d < 1e-6) return { x, y };
    const s = cap / d;
    return { x: to.x + dx * s, y: to.y + dy * s };
  };
  return {
    topL: step(prev.topL, next.topL, lead, limit * 0.35),
    topR: step(prev.topR, next.topR, lead, limit * 0.35),
    botL: step(prev.botL, next.botL, trail, limit),
    botR: step(prev.botR, next.botR, trail, limit),
  };
}

/** u across the torso (−1…1) and v down the torso (0…1). Null when outside. */
export function torsoUv(p: Pt, quad: Quad): { u: number; v: number } | null {
  const top = mid(quad.topL, quad.topR);
  const bot = mid(quad.botL, quad.botR);
  const axis = sub(bot, top);
  const len = Math.hypot(axis.x, axis.y);
  if (len < 1e-5) return null;
  const n = { x: axis.x / len, y: axis.y / len };
  const side = { x: -n.y, y: n.x };
  const v = ((p.x - top.x) * n.x + (p.y - top.y) * n.y) / len;
  const halfT = dist(quad.topL, quad.topR) / 2;
  const halfB = dist(quad.botL, quad.botR) / 2;
  const clamped = Math.min(1, Math.max(0, v));
  const halfW = halfT + (halfB - halfT) * clamped;
  const midP = { x: top.x + n.x * len * clamped, y: top.y + n.y * len * clamped };
  const u = ((p.x - midP.x) * side.x + (p.y - midP.y) * side.y) / Math.max(halfW, 1e-4);
  if (v < 0.0 || v > 1.0 || Math.abs(u) > 0.96) return null;
  return { u, v };
}

export type HairFrame = {
  center: Pt;
  halfW: number;
  halfH: number;
  rot: number;
  protect: { center: Pt; halfW: number; halfH: number; rot: number };
};

export function hairFrame(forehead: Pt, chin: Pt, cheekL: Pt, cheekR: Pt): HairFrame {
  const faceH = Math.max(dist(forehead, chin), 1e-4);
  const faceW = Math.max(dist(cheekL, cheekR), 1e-4);
  const down = norm(sub(chin, forehead));
  const midFace = mid(forehead, chin);
  const center = add(mid(cheekL, cheekR), down, faceH * 0.28);
  center.x = midFace.x * 0.35 + center.x * 0.65;
  const rot = Math.atan2(cheekR.y - cheekL.y, cheekR.x - cheekL.x);
  return {
    center,
    halfW: faceW * 0.78,
    halfH: faceH * 1.55,
    rot,
    protect: {
      center: add(midFace, down, faceH * 0.04),
      halfW: faceW * 0.38,
      halfH: faceH * 0.42,
      rot,
    },
  };
}

export function inEllipse(p: Pt, center: Pt, halfW: number, halfH: number, rot: number): boolean {
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const x = dx * c + dy * s;
  const y = -dx * s + dy * c;
  const nx = x / Math.max(halfW, 1e-4);
  const ny = y / Math.max(halfH, 1e-4);
  return nx * nx + ny * ny <= 1;
}

export type Sprite = { cx: number; cy: number; w: number; h: number; rot: number };

export function glassesSprite(eyeL: Pt, eyeR: Pt, imageAspect: number, scale: number): Sprite {
  const left = eyeL.x <= eyeR.x ? eyeL : eyeR;
  const right = eyeL.x <= eyeR.x ? eyeR : eyeL;
  const ipd = Math.max(dist(left, right), 1e-4);
  const w = ipd * 2.55 * scale;
  const h = w * imageAspect;
  return {
    cx: (left.x + right.x) / 2,
    cy: (left.y + right.y) / 2 + ipd * 0.12,
    w,
    h,
    rot: Math.atan2(right.y - left.y, right.x - left.x),
  };
}

export function wigSprite(forehead: Pt, chin: Pt, cheekL: Pt, cheekR: Pt, imageAspect: number, scale: number, opening = 0.16, holeFrac = 0.26): Sprite {
  const faceW = Math.max(dist(cheekL, cheekR), 1e-4);
  const left = cheekL.x <= cheekR.x ? cheekL : cheekR;
  const right = cheekL.x <= cheekR.x ? cheekR : cheekL;
  const w = (faceW * 0.92 * scale) / Math.max(holeFrac, 0.08);
  const h = w * imageAspect;
  const rot = Math.atan2(right.y - left.y, right.x - left.x);
  return {
    cx: (left.x + right.x) / 2,
    cy: forehead.y + h * (0.5 - opening),
    w,
    h,
    rot,
  };
}

export function earringSprite(ear: Pt, faceW: number, imageAspect: number, scale: number, drop: number, side: number): Sprite {
  const w = faceW * 0.22 * scale;
  return {
    cx: ear.x + faceW * 0.04 * side,
    cy: ear.y + faceW * 0.02 + drop,
    w,
    h: w * imageAspect,
    rot: 0,
  };
}

export function hatSprite(forehead: Pt, cheekL: Pt, cheekR: Pt, eyeRot: number, imageAspect: number, scale: number, cap: boolean): Sprite {
  const faceW = Math.max(dist(cheekL, cheekR), 1e-4);
  const w = faceW * (cap ? 1.55 : 1.75) * scale;
  const h = w * imageAspect;
  return {
    cx: forehead.x,
    cy: forehead.y - h * 0.18,
    w,
    h,
    rot: eyeRot,
  };
}

export function necklaceSprite(chin: Pt, shoulderL: Pt, shoulderR: Pt, imageAspect: number, scale: number, drop: number): Sprite {
  const span = Math.max(dist(shoulderL, shoulderR), 0.05);
  const w = span * 0.92 * scale;
  return {
    cx: (shoulderL.x + shoulderR.x) / 2,
    cy: chin.y + span * 0.28 + drop,
    w,
    h: w * imageAspect,
    rot: Math.atan2(shoulderR.y - shoulderL.y, shoulderR.x - shoulderL.x),
  };
}

export function braceletSprite(elbow: Pt, wrist: Pt, imageAspect: number, scale: number): Sprite {
  const along = Math.max(dist(elbow, wrist), 1e-4);
  const dx = (wrist.x - elbow.x) / along;
  const dy = (wrist.y - elbow.y) / along;
  const band = along * 0.22 * scale;
  return {
    cx: wrist.x + dx * along * 0.22,
    cy: wrist.y + dy * along * 0.22,
    w: band * 1.35,
    h: band * 0.42 * Math.max(imageAspect, 0.35),
    rot: Math.atan2(wrist.y - elbow.y, wrist.x - elbow.x),
  };
}

export function watchSprite(elbow: Pt, wrist: Pt, imageAspect: number, scale: number): Sprite {
  const along = Math.max(dist(elbow, wrist), 1e-4);
  const h = along * 0.62 * scale;
  const w = h / Math.max(imageAspect, 0.2);
  return {
    cx: wrist.x + (wrist.x - elbow.x) * 0.08,
    cy: wrist.y + (wrist.y - elbow.y) * 0.08,
    w,
    h,
    rot: Math.atan2(wrist.y - elbow.y, wrist.x - elbow.x) - Math.PI / 2,
  };
}

export function ringSprite(dip: Pt, tip: Pt, imageAspect: number, scale: number): Sprite {
  const along = Math.max(dist(dip, tip), 1e-4);
  const w = along * 1.15 * scale;
  return {
    cx: tip.x + (tip.x - dip.x) * 0.15,
    cy: tip.y + (tip.y - dip.y) * 0.15,
    w,
    h: w * imageAspect,
    rot: Math.atan2(tip.y - dip.y, tip.x - dip.x),
  };
}

const TIP = [4, 8, 12, 16, 20];
const DIP = [3, 7, 11, 15, 19];

export function nailSegments(hands: Pt[][]): { tip: Pt; base: Pt }[] {
  const out: { tip: Pt; base: Pt }[] = [];
  for (const hand of hands) {
    if (hand.length < 21) continue;
    for (let i = 0; i < TIP.length; i++) {
      const tip = hand[TIP[i]!];
      const base = hand[DIP[i]!];
      if (!tip || !base) continue;
      out.push({ tip, base });
    }
  }
  return out.slice(0, 10);
}

export function nailShapeFactors(shape: NailShape): { half: number; start: number; tip: number } {
  // Hand landmarks span the distal finger segment, not the nail plate itself.
  // Keep polish on the fingertip and stop before it spills beyond the fingertip.
  if (shape === "square") return { half: 0.13, start: 0.48, tip: 0.94 };
  if (shape === "stiletto") return { half: 0.105, start: 0.45, tip: 0.98 };
  return { half: 0.12, start: 0.46, tip: 0.96 };
}

export function containPoint(opts: {
  clientX: number;
  clientY: number;
  rect: { left: number; top: number; width: number; height: number };
  bitmapW: number;
  bitmapH: number;
}): Pt | null {
  const { rect, bitmapW, bitmapH } = opts;
  if (bitmapW <= 0 || bitmapH <= 0 || rect.width <= 0 || rect.height <= 0) return null;
  const scale = Math.min(rect.width / bitmapW, rect.height / bitmapH);
  const dw = bitmapW * scale;
  const dh = bitmapH * scale;
  const ox = rect.left + (rect.width - dw) / 2;
  const oy = rect.top + (rect.height - dh) / 2;
  const x = (opts.clientX - ox) / scale;
  const y = (opts.clientY - oy) / scale;
  if (x < 0 || y < 0 || x > bitmapW || y > bitmapH) return null;
  return { x, y };
}

export function hasSleeves(category: Category | null): boolean {
  return category === "shirt" || category === "jacket";
}

/** Arms hanging beside the body use the garment photo's own sleeves. Raised arms need a separate sleeve strip. */
export function armsAreRaised(opts: {
  shoulderL: Pt;
  shoulderR: Pt;
  elbowL: Pt;
  elbowR: Pt;
  wristL: Pt;
  wristR: Pt;
}): boolean {
  const span = Math.max(dist(opts.shoulderL, opts.shoulderR), 0.05);
  const raised = (sh: Pt, el: Pt, wr: Pt) => sh.y - el.y > span * 0.18 || Math.abs(wr.x - sh.x) > span * 0.78;
  return raised(opts.shoulderL, opts.elbowL, opts.wristL) || raised(opts.shoulderR, opts.elbowR, opts.wristR);
}
