import type { Category, Pt } from "@/lib/isibuko-ai/types";

/**
 * Geometric fit for the live mirror.
 * Widths come from the pose and the segmentation mask. Motion is a damped
 * offset of the hem. Nothing here is a cloth simulation or a learned model.
 */

export type SleeveCut = "sleeveless" | "short" | "long";
export type NecklineCut = "closed" | "open" | "strapless";

export type WidthContour = {
  /** Half-widths in the same normalized space as pose landmarks. */
  shoulder: number;
  chest: number;
  waist: number;
  hip: number;
};

export type HipHold = {
  hipL: Pt;
  hipR: Pt;
  torso: number;
  hipOverShoulder: number;
  held: boolean;
};

const BODY = 2;
const CLOTHES = 4;
const OTHER = 5;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function silhouette(cls: number): boolean {
  return cls === BODY || cls === CLOTHES || cls === OTHER;
}

export function sleeveCutFor(category: Category | null, stated?: SleeveCut | null): SleeveCut {
  if (stated === "sleeveless" || stated === "short" || stated === "long") {
    if (category === "pants" || category === "skirt") return "sleeveless";
    return stated;
  }
  if (category === "jacket") return "long";
  if (category === "shirt") return "long";
  return "sleeveless";
}

export function necklineFor(category: Category | null, stated?: NecklineCut | null): NecklineCut {
  if (stated === "closed" || stated === "open" || stated === "strapless") return stated;
  if (category === "dress") return "open";
  return "closed";
}

/** 0 omits sleeve triangles. Short stops near the elbow. Long follows the wrist. */
export function sleeveLengthFor(cut: SleeveCut): number {
  if (cut === "sleeveless") return 0;
  if (cut === "short") return 0.46;
  return 1;
}

/** How far down the torso the worn collar is left as skin. Closed keeps the collar. */
export function neckClearFor(cut: NecklineCut): number {
  if (cut === "strapless") return 0.2;
  if (cut === "open") return 0.1;
  return 0;
}

/**
 * Low-latency landmark blend. Still points keep a small step so tracker
 * jitter does not shiver the garment. A real movement takes a larger step
 * in the same frame. This is not a predictive model.
 */
/**
 * A short lead while the point is actually moving, capped so it cannot swim
 * away from the tracker. Still points are not pushed.
 */
export function predictPoint(prev: Pt | null, next: Pt, dtMs: number): Pt {
  if (!prev || !Number.isFinite(dtMs) || dtMs < 8 || dtMs > 70) return next;
  const vx = (next.x - prev.x) / dtMs;
  const vy = (next.y - prev.y) / dtMs;
  const speed = Math.hypot(vx, vy) * 1000;
  if (speed < 0.25) return next;
  const lead = Math.min(14, dtMs * 0.35);
  const x = next.x + vx * lead;
  const y = next.y + vy * lead;
  const dx = x - next.x;
  const dy = y - next.y;
  const d = Math.hypot(dx, dy);
  if (d <= 0.018 || d < 1e-6) return { x, y };
  const s = 0.018 / d;
  return { x: next.x + dx * s, y: next.y + dy * s };
}

export function adaptiveAlpha(speedPerSec: number, dtMs: number): number {
  if (!Number.isFinite(speedPerSec) || !Number.isFinite(dtMs) || dtMs <= 0) return 0.48;
  if (dtMs > 220) return 0.86;
  const t = clamp((speedPerSec - 0.05) / 0.7, 0, 1);
  const shaped = t * t * (3 - 2 * t);
  return 0.24 + (0.78 - 0.24) * shaped;
}

/**
 * Lateral hem offset, in normalized screen units, from shoulder velocity
 * (units per second) and torso tilt (−1…1). Clamped. It is a geometric lag,
 * not simulated cloth.
 */
export function hemSway(vxPerSec: number, tilt: number): number {
  if (!Number.isFinite(vxPerSec) || !Number.isFinite(tilt)) return 0;
  const drive = vxPerSec * 0.045 + clamp(tilt, -1, 1) * 0.02;
  return clamp(drive, -0.028, 0.028);
}

export function smoothScalar(prev: number | null, next: number, alpha = 0.42): number {
  if (prev == null || !Number.isFinite(prev)) return next;
  return prev + (next - prev) * alpha;
}

/**
 * Keeps a class only when the new mask agrees with itself nearby.
 * A one-pixel flicker stays on the previous class. This is temporal
 * hysteresis, not a learned segmentation model.
 */
export function stabilizeMask(
  prev: Uint8Array | null,
  next: Uint8Array,
  width: number,
  height: number,
  into?: Uint8Array,
): Uint8Array {
  const reusable = into && into.length === next.length ? into : null;
  if (!prev || prev.length !== next.length || width < 3 || height < 3) {
    if (!reusable) return next.slice();
    reusable.set(next);
    return reusable;
  }
  const out = reusable ?? next.slice();
  if (out !== next) out.set(next);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const incoming = next[i] ?? 0;
      if ((prev[i] ?? 0) === incoming) continue;
      let agree = 0;
      if ((next[i - 1] ?? -1) === incoming) agree += 1;
      if ((next[i + 1] ?? -1) === incoming) agree += 1;
      if ((next[i - width] ?? -1) === incoming) agree += 1;
      if ((next[i + width] ?? -1) === incoming) agree += 1;
      if (agree < 2) out[i] = prev[i] ?? incoming;
    }
  }
  return out;
}

/** A body-class pixel in mirrored landmark space, or null when the mask has no skin. */
export function findSkinPoint(data: Uint8Array, width: number, height: number): Pt | null {
  if (width < 8 || height < 8 || data.length < width * height) return null;
  const y0 = Math.floor(height * 0.18);
  const y1 = Math.floor(height * 0.78);
  const x0 = Math.floor(width * 0.12);
  const x1 = Math.floor(width * 0.88);
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      if ((data[y * width + x] ?? 0) === BODY) {
        return { x: 1 - (x + 0.5) / width, y: (y + 0.5) / height };
      }
    }
  }
  return null;
}

function centralHalf(data: Uint8Array, width: number, height: number, yNorm: number): number | null {
  const y = clamp(Math.round(yNorm * (height - 1)), 0, height - 1);
  const cx = Math.floor(width / 2);
  let seed = -1;
  const reach = Math.floor(width * 0.28);
  for (let d = 0; d <= reach; d++) {
    if ((data[y * width + cx + d] ?? 0) && silhouette(data[y * width + cx + d] ?? 0)) {
      seed = cx + d;
      break;
    }
    if (d > 0 && silhouette(data[y * width + cx - d] ?? 0)) {
      seed = cx - d;
      break;
    }
  }
  if (seed < 0) return null;
  let left = seed;
  let right = seed;
  while (left > 0 && silhouette(data[y * width + left - 1] ?? 0)) left -= 1;
  while (right < width - 1 && silhouette(data[y * width + right + 1] ?? 0)) right += 1;
  const full = (right - left + 1) / width;
  if (full < 0.05 || full > 0.92) return null;
  return full * 0.5;
}

function clothesBottom(data: Uint8Array, width: number, height: number): number | null {
  const x0 = Math.floor(width * 0.35);
  const x1 = Math.ceil(width * 0.65);
  for (let y = height - 1; y >= 0; y--) {
    let hits = 0;
    for (let x = x0; x < x1; x++) if (silhouette(data[y * width + x] ?? 0)) hits += 1;
    if (hits > (x1 - x0) * 0.35) return y / height;
  }
  return null;
}

export function hipsLookVisible(opts: {
  shoulderL: Pt;
  shoulderR: Pt;
  hipL: Pt | null;
  hipR: Pt | null;
  reported: boolean;
}): boolean {
  if (!opts.reported || !opts.hipL || !opts.hipR) return false;
  if (opts.hipL.y > 0.98 || opts.hipR.y > 0.98) return false;
  const shoulder = Math.hypot(opts.shoulderR.x - opts.shoulderL.x, opts.shoulderR.y - opts.shoulderL.y);
  const midS = { x: (opts.shoulderL.x + opts.shoulderR.x) / 2, y: (opts.shoulderL.y + opts.shoulderR.y) / 2 };
  const midH = { x: (opts.hipL.x + opts.hipR.x) / 2, y: (opts.hipL.y + opts.hipR.y) / 2 };
  const torso = Math.hypot(midH.x - midS.x, midH.y - midS.y);
  return torso > Math.max(shoulder, 0.05) * 0.55;
}

/**
 * When the hips leave a portrait frame, keep the last torso length and
 * place the hem from the shoulders. Do not pull the hips up under the collar.
 */
export function holdCroppedHips(opts: {
  shoulderL: Pt;
  shoulderR: Pt;
  hipL: Pt | null;
  hipR: Pt | null;
  visible: boolean;
  previous: HipHold | null;
}): HipHold {
  const shoulderW = Math.max(Math.hypot(opts.shoulderR.x - opts.shoulderL.x, opts.shoulderR.y - opts.shoulderL.y), 0.05);
  const midS = { x: (opts.shoulderL.x + opts.shoulderR.x) / 2, y: (opts.shoulderL.y + opts.shoulderR.y) / 2 };
  if (opts.visible && opts.hipL && opts.hipR) {
    const midH = { x: (opts.hipL.x + opts.hipR.x) / 2, y: (opts.hipL.y + opts.hipR.y) / 2 };
    const torso = Math.hypot(midH.x - midS.x, midH.y - midS.y);
    const hipW = Math.hypot(opts.hipR.x - opts.hipL.x, opts.hipR.y - opts.hipL.y);
    return {
      hipL: opts.hipL,
      hipR: opts.hipR,
      torso,
      hipOverShoulder: hipW / shoulderW,
      held: false,
    };
  }
  const torso = opts.previous?.torso && opts.previous.torso > shoulderW * 0.55 ? opts.previous.torso : shoulderW * 1.45;
  const ratio = opts.previous?.hipOverShoulder && opts.previous.hipOverShoulder > 0.4 ? opts.previous.hipOverShoulder : 0.92;
  const ax = (opts.shoulderR.x - opts.shoulderL.x) / shoulderW;
  const ay = (opts.shoulderR.y - opts.shoulderL.y) / shoulderW;
  let px = -ay;
  let py = ax;
  if (py < 0) {
    px = -px;
    py = -py;
  }
  const midY = Math.min(1.12, midS.y + py * torso);
  const midX = midS.x + px * torso;
  const half = shoulderW * ratio * 0.5;
  return {
    hipL: { x: midX - ax * half, y: midY - ay * half },
    hipR: { x: midX + ax * half, y: midY + ay * half },
    torso,
    hipOverShoulder: ratio,
    held: true,
  };
}

export function measureContour(opts: {
  data: Uint8Array | null;
  width: number;
  height: number;
  shoulderL: Pt;
  shoulderR: Pt;
  hipL: Pt;
  hipR: Pt;
  previous: WidthContour | null;
  previousHem: number | null;
}): { contour: WidthContour; hemLength: number } {
  const shoulderW = Math.max(Math.hypot(opts.shoulderR.x - opts.shoulderL.x, opts.shoulderR.y - opts.shoulderL.y), 0.05);
  const poseHalf = shoulderW * 0.5;
  const hipW = Math.hypot(opts.hipR.x - opts.hipL.x, opts.hipR.y - opts.hipL.y);
  const shoulderY = (opts.shoulderL.y + opts.shoulderR.y) / 2;
  const hipY = (opts.hipL.y + opts.hipR.y) / 2;
  const torso = Math.max(hipY - shoulderY, shoulderW * 0.8);
  const band = (y: number, minK: number, maxK: number, fallbackK: number): number => {
    const measured =
      opts.data && opts.width > 8 && opts.height > 8 && opts.data.length >= opts.width * opts.height
        ? centralHalf(opts.data, opts.width, opts.height, y)
        : null;
    const fallback = poseHalf * fallbackK;
    const value = measured == null ? fallback : clamp(measured, poseHalf * minK, poseHalf * maxK);
    return value;
  };
  const raw: WidthContour = {
    shoulder: band(shoulderY + torso * 0.06, 0.92, 1.18, 1.06),
    chest: band(shoulderY + torso * 0.28, 0.86, 1.22, 1.02),
    waist: band(shoulderY + torso * 0.62, 0.7, 1.12, 0.9),
    hip: band(hipY, 0.78, 1.4, Math.max(0.9, (hipW / shoulderW) * 1.12)),
  };
  const contour: WidthContour = {
    shoulder: smoothScalar(opts.previous?.shoulder ?? null, raw.shoulder),
    chest: smoothScalar(opts.previous?.chest ?? null, raw.chest),
    waist: smoothScalar(opts.previous?.waist ?? null, raw.waist),
    hip: smoothScalar(opts.previous?.hip ?? null, raw.hip),
  };
  let hemLength = opts.previousHem ?? 0.16;
  if (opts.data && opts.width > 8 && opts.height > 8 && opts.data.length >= opts.width * opts.height) {
    const bottom = clothesBottom(opts.data, opts.width, opts.height);
    if (bottom == null || bottom > 0.96) {
      hemLength = opts.previousHem ?? 0.16;
    } else {
      const extra = (bottom - hipY) / Math.max(torso, 0.08);
      hemLength = smoothScalar(opts.previousHem, clamp(extra, 0.06, 0.4));
    }
  }
  return { contour, hemLength };
}

export type LiveFitPlan = {
  hipL: Pt;
  hipR: Pt;
  hipHold: HipHold;
  meshShoulderL: Pt;
  meshShoulderR: Pt;
  contour: WidthContour;
  hemLength: number;
  sleeveLength: number;
  sleeveReach: number;
  neckClear: number;
  revealSkin: boolean;
};

export function planLiveFit(opts: {
  category: Category | null;
  sleeve?: SleeveCut | null;
  neckline?: NecklineCut | null;
  shoulderL: Pt;
  shoulderR: Pt;
  hipL: Pt | null;
  hipR: Pt | null;
  hipsReported: boolean;
  previousHips: HipHold | null;
  mask: Uint8Array | null;
  maskW: number;
  maskH: number;
  previousContour: WidthContour | null;
  previousHem: number | null;
  skin: Pt | null;
}): LiveFitPlan {
  const visible = hipsLookVisible({
    shoulderL: opts.shoulderL,
    shoulderR: opts.shoulderR,
    hipL: opts.hipL,
    hipR: opts.hipR,
    reported: opts.hipsReported,
  });
  const hipHold = holdCroppedHips({
    shoulderL: opts.shoulderL,
    shoulderR: opts.shoulderR,
    hipL: opts.hipL,
    hipR: opts.hipR,
    visible,
    previous: opts.previousHips,
  });
  const measured = measureContour({
    data: opts.mask,
    width: opts.maskW,
    height: opts.maskH,
    shoulderL: opts.shoulderL,
    shoulderR: opts.shoulderR,
    hipL: hipHold.hipL,
    hipR: hipHold.hipR,
    previous: opts.previousContour,
    previousHem: opts.previousHem,
  });
  const cut = sleeveCutFor(opts.category, opts.sleeve);
  const neckline = necklineFor(opts.category, opts.neckline);
  const neckClear = neckClearFor(neckline);
  const drop = neckline === "strapless" ? 0.16 : neckline === "open" ? 0.07 : 0;
  const meshShoulderL = { x: opts.shoulderL.x, y: opts.shoulderL.y + hipHold.torso * drop };
  const meshShoulderR = { x: opts.shoulderR.x, y: opts.shoulderR.y + hipHold.torso * drop };
  const sleeveLength = opts.category === "shirt" || opts.category === "jacket" ? sleeveLengthFor(cut) : 0;
  const sleeveReach = sleeveLengthFor(cut);
  const clothing = opts.category === "shirt" || opts.category === "jacket" || opts.category === "dress";
  return {
    hipL: hipHold.hipL,
    hipR: hipHold.hipR,
    hipHold,
    meshShoulderL,
    meshShoulderR,
    contour: measured.contour,
    hemLength: measured.hemLength,
    sleeveLength,
    sleeveReach,
    neckClear,
    revealSkin: Boolean(clothing && opts.skin && (neckClear > 0.03 || sleeveReach < 0.95)),
  };
}

/** Old sleeve pixels that should show nearby skin instead of the worn shirt or the new cloth. */
export function shouldRevealSkin(opts: {
  cut: SleeveCut;
  neckline: NecklineCut;
  clothes: boolean;
  inTorso: boolean;
  inArm: boolean;
  along: number;
  neckDown: number;
}): boolean {
  if (!opts.clothes) return false;
  const neck = neckClearFor(opts.neckline);
  if (neck > 0.03 && opts.neckDown > -0.18 && opts.neckDown < neck) return true;
  if (!opts.inArm || opts.inTorso) return false;
  if (opts.cut === "sleeveless") return true;
  if (opts.cut === "short") return opts.along > sleeveLengthFor("short") + 0.04;
  return false;
}
