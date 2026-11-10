import {
  CHEST_BREADTH_OF_SHOULDER,
  CHEST_DEPTH_OF_BREADTH,
  FACE_TO_HEAD,
  HIP_BREADTH_OF_HEIGHT,
  HIP_DEPTH_OF_BREADTH,
  WAIST_DEPTH_OF_BREADTH,
  WAIST_OF_HIP,
  WAIST_OF_SHOULDER,
} from "@/lib/tryon/physics";
import type { BodyEstimate, FitResult, SizeRow } from "@/lib/tryon/types";

export type Vec3 = { x: number; y: number; z: number };

/** Pinch closes when thumb tip and index tip are this close in normalised hand space. */
export const PINCH_MAX = 0.05;

/** Head above the nose plus heel below the ankle, added back onto nose-to-ankle. */
export const CRANIUM_AND_HEEL_M = 0.16;

/**
 * Stature priors, used only until a pose scan exists.
 * Fractions of standing height. They are population averages, not a measurement.
 */
export const STATURE_PRIORS = {
  shoulderBreadth: 0.225,
  chestCirc: 0.53,
  waistCirc: 0.45,
  hipCirc: 0.56,
  inseam: 0.45,
  faceWidth: 0.078,
  headCirc: 0.333,
  wristCirc: 0.095,
  fingerBreadth: 0.011,
} as const;

export function dist3(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Ramanujan's second approximation of an ellipse circumference.
 * a and b are semi-axes (half the breadth, half the depth), same units.
 */
export function ellipseCircumference(a: number, b: number): number {
  const sum = a + b;
  if (sum <= 0) return 0;
  const h = ((a - b) * (a - b)) / (sum * sum);
  return Math.PI * sum * (1 + (3 * h) / (10 + Math.sqrt(Math.max(0, 4 - 3 * h))));
}

/**
 * Chest / waist / hip tapes we cannot see from a single camera.
 * Breadth comes from the pose. Depth is an assumed fraction of breadth
 * (a torso is flatter than it is wide). The tape is the ellipse around both.
 */
export function torsoTape(breadthCm: number, depthOverBreadth: number): number {
  const depth = breadthCm * depthOverBreadth;
  return ellipseCircumference(breadthCm / 2, depth / 2);
}

export function priorFromHeight(heightCm: number, headCircCm: number | null): BodyEstimate {
  const h = clamp(heightCm, 120, 220);
  const shoulder = h * STATURE_PRIORS.shoulderBreadth;
  const hipBreadth = h * HIP_BREADTH_OF_HEIGHT;
  return {
    source: "height-prior",
    scale: 1,
    shoulderCm: round1(shoulder),
    hipBreadthCm: round1(hipBreadth),
    chestCm: round1(h * STATURE_PRIORS.chestCirc),
    waistCm: round1(h * STATURE_PRIORS.waistCirc),
    hipCm: round1(h * STATURE_PRIORS.hipCirc),
    inseamCm: round1(h * STATURE_PRIORS.inseam),
    faceWidthCm: round1(h * STATURE_PRIORS.faceWidth),
    headCircCm: round1(headCircCm ?? h * STATURE_PRIORS.headCirc),
    wristCm: round1(h * STATURE_PRIORS.wristCirc),
    fingerCm: round1(h * STATURE_PRIORS.fingerBreadth),
    notes: [
      "No body scan yet. These are stature priors — fractions of the height you typed.",
      "A live pose replaces them. Entered head circumference is kept either way.",
    ],
  };
}

export function estimateFromPose(opts: {
  world: Vec3[];
  imageVisibility: number[];
  heightCm: number;
  headCircEntered: number | null;
  faceWidthCm: number | null;
  wristCm: number | null;
  fingerCm: number | null;
}): BodyEstimate | null {
  const w = opts.world;
  if (w.length < 29) return null;
  const shoulderM = dist3(w[11], w[12]);
  const hipM = dist3(w[23], w[24]);
  if (!Number.isFinite(shoulderM) || shoulderM < 0.08 || shoulderM > 0.7) return null;

  const anklesOk =
    (opts.imageVisibility[27] ?? 0) > 0.45 && (opts.imageVisibility[28] ?? 0) > 0.45;
  const noseAnkle = (dist3(w[0], w[27]) + dist3(w[0], w[28])) / 2;
  const rawStatureM = noseAnkle + CRANIUM_AND_HEEL_M;
  const targetM = clamp(opts.heightCm, 120, 220) / 100;

  let scale = 1;
  let statureNote: string;
  if (anklesOk && rawStatureM > 0.5 && rawStatureM < 2.6) {
    scale = targetM / rawStatureM;
    statureNote =
      "Scale forces reconstructed stature (nose-to-ankle plus 16 cm of skull and heel) to match the height you entered.";
  } else {
    scale = 1;
    statureNote =
      "Ankles are not reliable in frame, so pose metres are used without a stature correction. Step back for a full-body scale.";
  }

  const shoulderCm = shoulderM * scale * 100;
  const hipBreadthCm = hipM * scale * 100;
  if (shoulderCm < 24 || shoulderCm > 62) return null;

  const chestBreadth = shoulderCm * CHEST_BREADTH_OF_SHOULDER;
  const chestCm = torsoTape(chestBreadth, CHEST_DEPTH_OF_BREADTH);
  const waistBreadth = hipBreadthCm > 8 ? hipBreadthCm * WAIST_OF_HIP : shoulderCm * WAIST_OF_SHOULDER;
  const waistCm = torsoTape(waistBreadth, WAIST_DEPTH_OF_BREADTH);
  const hipCm = hipBreadthCm > 8 ? torsoTape(hipBreadthCm, HIP_DEPTH_OF_BREADTH) : null;

  let inseamCm: number | null = null;
  if (anklesOk) {
    const thigh = (dist3(w[23], w[25]) + dist3(w[24], w[26])) / 2;
    const shin = (dist3(w[25], w[27]) + dist3(w[26], w[28])) / 2;
    inseamCm = round1((thigh + shin) * scale * 100);
  }

  const faceWidthCm = opts.faceWidthCm;
  const headCircCm =
    opts.headCircEntered ??
    (faceWidthCm != null ? round1(faceWidthCm * FACE_TO_HEAD) : null);

  return {
    source: "live-scan",
    scale: round1(scale),
    shoulderCm: round1(shoulderCm),
    hipBreadthCm: hipBreadthCm > 8 ? round1(hipBreadthCm) : null,
    chestCm: round1(chestCm),
    waistCm: round1(waistCm),
    hipCm: hipCm != null ? round1(hipCm) : null,
    inseamCm,
    faceWidthCm: faceWidthCm != null ? round1(faceWidthCm) : null,
    headCircCm,
    wristCm: opts.wristCm != null ? round1(opts.wristCm) : null,
    fingerCm: opts.fingerCm != null ? round1(opts.fingerCm) : null,
    notes: [
      statureNote,
      "Chest, waist and hip tapes are ellipse circumferences: camera breadth, assumed depth. Expect a few centimetres of error. This names a size. It is not a tailor's cut.",
    ],
  };
}

type RangeName = "chest" | "waist" | "shoulder" | "head" | "wrist" | "finger" | "face" | "hip";

const RANGE_LABEL: Record<RangeName, string> = {
  chest: "chest",
  waist: "waist",
  shoulder: "shoulder",
  head: "head",
  wrist: "wrist",
  finger: "finger",
  face: "face width",
  hip: "hip",
};

export function matchSize(
  rows: SizeRow[],
  m: {
    chestCm?: number | null;
    waistCm?: number | null;
    shoulderCm?: number | null;
    headCircCm?: number | null;
    wristCm?: number | null;
    fingerCm?: number | null;
    faceWidthCm?: number | null;
    hipCm?: number | null;
  },
): FitResult | null {
  let best: { row: SizeRow; score: number; warning: string | null; detail: string } | null = null;

  for (const row of rows) {
    const parts: string[] = [];
    let score = 0;
    let n = 0;
    let worstTight = 0;
    let tightName = "";
    let worstLoose = 0;
    let looseName = "";

    const check = (range: [number, number] | undefined, value: number | null | undefined, key: RangeName) => {
      if (!range || value == null || !Number.isFinite(value)) return;
      const mid = (range[0] + range[1]) / 2;
      const half = Math.max((range[1] - range[0]) / 2, 0.5);
      const delta = value - mid;
      score += (delta * delta) / (half * half);
      n += 1;
      parts.push(`${RANGE_LABEL[key]} ${value.toFixed(0)} cm vs ${range[0]}–${range[1]}`);
      if (value > range[1]) {
        const over = value - range[1];
        if (over > worstTight) {
          worstTight = over;
          tightName = RANGE_LABEL[key];
        }
      } else if (value < range[0]) {
        const under = range[0] - value;
        if (under > worstLoose) {
          worstLoose = under;
          looseName = RANGE_LABEL[key];
        }
      }
    };

    check(row.chest, m.chestCm, "chest");
    check(row.waist, m.waistCm, "waist");
    check(row.shoulder, m.shoulderCm, "shoulder");
    check(row.head, m.headCircCm, "head");
    check(row.wrist, m.wristCm, "wrist");
    check(row.finger, m.fingerCm, "finger");
    check(row.face, m.faceWidthCm, "face");
    check(row.hip, m.hipCm, "hip");
    if (n === 0) continue;

    let warning: string | null = null;
    if (worstTight >= 2.5) {
      warning = `${tightName} is ${worstTight.toFixed(0)} cm above this size. It may feel tight.`;
    } else if (worstLoose >= 2.5) {
      warning = `${looseName} is ${worstLoose.toFixed(0)} cm under this size. It may feel loose.`;
    }

    const candidate = { row, score: score / n, warning, detail: parts.join(" · ") };
    if (!best || candidate.score < best.score) best = candidate;
  }

  if (!best) return null;
  return { size: best.row.label, warning: best.warning, detail: best.detail, score: best.score };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
