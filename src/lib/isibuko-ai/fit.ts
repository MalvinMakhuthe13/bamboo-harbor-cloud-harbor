import type { BodyEstimate, FitResult, SizeRow } from "@/lib/isibuko-ai/types";

const CHEST_BREADTH_OF_SHOULDER = 0.78;
const CHEST_DEPTH_OF_BREADTH = 0.72;
const WAIST_OF_HIP = 0.92;
const WAIST_OF_SHOULDER = 0.7;
const WAIST_DEPTH_OF_BREADTH = 0.7;
const HIP_DEPTH_OF_BREADTH = 0.68;
const HIP_BREADTH_OF_HEIGHT = 0.19;
const FACE_TO_HEAD = Math.PI * 0.92;

export const STATURE_PRIORS = {
  shoulderBreadth: 0.225,
  chestCirc: 0.53,
  waistCirc: 0.45,
  hipCirc: 0.56,
  faceWidth: 0.078,
  headCirc: 0.333,
  wristCirc: 0.095,
  fingerBreadth: 0.011,
} as const;

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Ramanujan's second approximation. a and b are semi-axes. */
export function ellipseCircumference(a: number, b: number): number {
  const sum = a + b;
  if (sum <= 0) return 0;
  const h = ((a - b) * (a - b)) / (sum * sum);
  return Math.PI * sum * (1 + (3 * h) / (10 + Math.sqrt(Math.max(0, 4 - 3 * h))));
}

export function torsoTape(breadthCm: number, depthOverBreadth: number): number {
  const depth = breadthCm * depthOverBreadth;
  return ellipseCircumference(breadthCm / 2, depth / 2);
}

export function priorFromHeight(heightCm: number): BodyEstimate {
  const h = clamp(heightCm, 120, 220);
  const shoulder = h * STATURE_PRIORS.shoulderBreadth;
  const hipBreadth = h * HIP_BREADTH_OF_HEIGHT;
  return {
    source: "height-prior",
    shoulderCm: round1(shoulder),
    chestCm: round1(h * STATURE_PRIORS.chestCirc),
    waistCm: round1(h * STATURE_PRIORS.waistCirc),
    hipCm: round1(h * STATURE_PRIORS.hipCirc),
    faceWidthCm: round1(h * STATURE_PRIORS.faceWidth),
    headCircCm: round1(h * STATURE_PRIORS.headCirc),
    wristCm: round1(h * STATURE_PRIORS.wristCirc),
    note: "A standing pose is missing, so this is a stature prior. You are not asked to type a measurement.",
  };
}

type WorldPt = { x: number; y: number; z: number };

function dist3(a: WorldPt, b: WorldPt): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * Shoulder breadth comes from the pose in metres. Chest, waist and hip are
 * ellipse tapes: measured breadth, assumed depth. Not a tailor's tape.
 */
export function estimateFromWorld(opts: {
  world: WorldPt[] | null;
  heightCm: number;
  faceWidthCm: number | null;
  wristCm: number | null;
}): BodyEstimate {
  const prior = priorFromHeight(opts.heightCm);
  const w = opts.world;
  if (!w || w.length < 25) {
    return {
      ...prior,
      faceWidthCm: opts.faceWidthCm != null ? round1(opts.faceWidthCm) : prior.faceWidthCm,
      wristCm: opts.wristCm != null ? round1(opts.wristCm) : prior.wristCm,
    };
  }
  const shoulderM = dist3(w[11]!, w[12]!);
  if (!Number.isFinite(shoulderM) || shoulderM < 0.08 || shoulderM > 0.7) return prior;
  const shoulderCm = shoulderM * 100;
  if (shoulderCm < 24 || shoulderCm > 62) return prior;
  const hipM = dist3(w[23]!, w[24]!);
  const hipBreadthCm = hipM > 0.08 && hipM < 0.7 ? hipM * 100 : null;
  const chestCm = torsoTape(shoulderCm * CHEST_BREADTH_OF_SHOULDER, CHEST_DEPTH_OF_BREADTH);
  const waistBreadth =
    hipBreadthCm != null ? hipBreadthCm * WAIST_OF_HIP : shoulderCm * WAIST_OF_SHOULDER;
  const waistCm = torsoTape(waistBreadth, WAIST_DEPTH_OF_BREADTH);
  const hipCm = hipBreadthCm != null ? torsoTape(hipBreadthCm, HIP_DEPTH_OF_BREADTH) : null;
  const face = opts.faceWidthCm;
  return {
    source: "live-scan",
    shoulderCm: round1(shoulderCm),
    chestCm: round1(chestCm),
    waistCm: round1(waistCm),
    hipCm: hipCm != null ? round1(hipCm) : null,
    faceWidthCm: face != null ? round1(face) : prior.faceWidthCm,
    headCircCm: face != null ? round1(face * FACE_TO_HEAD) : prior.headCircCm,
    wristCm: opts.wristCm != null ? round1(opts.wristCm) : prior.wristCm,
    note: "Pose breadth, with depth assumed as a fraction of breadth. Expect a few centimetres of error.",
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
    if (worstTight >= 2.5) warning = `${tightName} is ${worstTight.toFixed(0)} cm above this size. It may feel tight.`;
    else if (worstLoose >= 2.5) warning = `${looseName} is ${worstLoose.toFixed(0)} cm under this size. It may feel loose.`;
    const candidate = { row, score: score / n, warning, detail: parts.join(" · ") };
    if (!best || candidate.score < best.score) best = candidate;
  }
  if (!best) return null;
  return { size: best.row.label, warning: best.warning, detail: best.detail, score: best.score };
}

export function sizeScaleFor(label: string | null): number {
  if (!label) return 1;
  const table: Record<string, number> = {
    S: 0.94,
    M: 1,
    L: 1.07,
    XL: 1.14,
    Petite: 0.92,
    Average: 1,
    Large: 1.08,
    Narrow: 0.92,
    Medium: 1,
    Wide: 1.08,
    P: 0.94,
    R: 1,
    T: 1.08,
  };
  return table[label] ?? 1;
}
