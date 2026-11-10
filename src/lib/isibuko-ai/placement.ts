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
  if (category === "shirt" || category === "jacket" || category === "dress" || category === "pants") return "clothing";
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
}): boolean {
  if (opts.mode === "none") return false;
  if (opts.inProtectedFace) return false;
  if (opts.nearHand && (opts.cls === CLASS.body || opts.cls === CLASS.other)) return false;
  if (opts.mode === "clothing") {
    if (!opts.inGarment) return false;
    if (opts.cls === CLASS.background || opts.cls === CLASS.hair || opts.cls === CLASS.face) return false;
    return opts.cls === CLASS.clothes || opts.cls === CLASS.body || opts.cls === CLASS.other;
  }
  if (!opts.inHairEllipse) return false;
  return true;
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

export function clothingQuad(opts: {
  shoulderL: Pt;
  shoulderR: Pt;
  hipL: Pt;
  hipR: Pt;
  category: "shirt" | "jacket" | "dress" | "pants";
  ankleL?: Pt | null;
  ankleR?: Pt | null;
  scale: number;
  /** When the arms hang, the product photo's own sleeves are mapped with the torso. */
  sleevesInPhoto?: boolean;
}): Quad {
  const s = opts.scale;
  if (opts.category === "pants") {
    const hipMid = mid(opts.hipL, opts.hipR);
    const shMid = mid(opts.shoulderL, opts.shoulderR);
    const down = norm(sub(hipMid, shMid));
    const torso = Math.max(dist(shMid, hipMid), dist(opts.hipL, opts.hipR));
    const waistL = add(opts.hipL, down, -torso * 0.12);
    const waistR = add(opts.hipR, down, -torso * 0.12);
    const botL = opts.ankleL ?? add(opts.hipL, down, torso * 1.35);
    const botR = opts.ankleR ?? add(opts.hipR, down, torso * 1.35);
    const top = mid(waistL, waistR);
    return {
      topL: scaleAbout(top, waistL, s),
      topR: scaleAbout(top, waistR, s),
      botL: scaleAbout(mid(botL, botR), botL, s * 0.86),
      botR: scaleAbout(mid(botL, botR), botR, s * 0.86),
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
  if (v < 0.0 || v > 1.04 || Math.abs(u) > 1.02) return null;
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

export function nailShapeFactors(shape: NailShape): { half: number; tip: number } {
  if (shape === "square") return { half: 0.22, tip: 1.02 };
  if (shape === "stiletto") return { half: 0.12, tip: 1.32 };
  return { half: 0.17, tip: 1.14 };
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
