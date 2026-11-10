/**
 * Offline motion-analysis primitives for seller demonstration videos.
 *
 * The video decoder/tracker is deliberately separate: it must supply timestamped,
 * normalised product landmarks relative to a stable wearer anchor. Raw screen-space
 * coordinates would confuse camera movement with product movement.
 */

export type MotionSample = {
  timestampMs: number;
  /** Wearer's head yaw in radians, from face/head tracking. */
  headYawRad: number;
  /** Product landmark position relative to its wearer anchor, normalised by head width. */
  productOffsetX: number;
  productOffsetY: number;
  /** Combined tracking confidence in [0, 1]. */
  confidence: number;
};

export type ProductMotionProfile = {
  sampleCount: number;
  durationMs: number;
  meanConfidence: number;
  headTurnRangeRad: number;
  peakRelativeDisplacement: number;
  responsePerRadian: number | null;
  settleTimeMs: number | null;
  quality: "insufficient" | "usable" | "strong";
};

const MIN_SAMPLES = 5;
const MIN_CONFIDENCE = 0.45;

/**
 * Summarise measured motion without inventing physical coefficients.
 * Offsets must already be stabilised against the wearer's head/body anchor.
 */
export function analyzeMotionSamples(samples: MotionSample[]): ProductMotionProfile {
  const valid = samples
    .filter((sample) =>
      Number.isFinite(sample.timestampMs) &&
      Number.isFinite(sample.headYawRad) &&
      Number.isFinite(sample.productOffsetX) &&
      Number.isFinite(sample.productOffsetY) &&
      Number.isFinite(sample.confidence) &&
      sample.confidence >= MIN_CONFIDENCE,
    )
    .sort((a, b) => a.timestampMs - b.timestampMs);

  const first = valid[0];
  const last = valid[valid.length - 1];
  const durationMs = first && last ? Math.max(0, last.timestampMs - first.timestampMs) : 0;
  const meanConfidence = valid.length
    ? valid.reduce((sum, sample) => sum + clamp(sample.confidence, 0, 1), 0) / valid.length
    : 0;

  if (valid.length < MIN_SAMPLES || durationMs <= 0) {
    return {
      sampleCount: valid.length,
      durationMs,
      meanConfidence,
      headTurnRangeRad: 0,
      peakRelativeDisplacement: 0,
      responsePerRadian: null,
      settleTimeMs: null,
      quality: "insufficient",
    };
  }

  // Use the opening two observations as the resting baseline. Including a third\n  // sample can absorb the beginning of a turn into the baseline and hide settling.\n  const baseline = valid.slice(0, Math.min(2, valid.length));
  const baseX = average(baseline.map((sample) => sample.productOffsetX));
  const baseY = average(baseline.map((sample) => sample.productOffsetY));
  const yaws = valid.map((sample) => sample.headYawRad);
  const headTurnRangeRad = Math.max(...yaws) - Math.min(...yaws);
  const displacement = valid.map((sample) =>
    Math.hypot(sample.productOffsetX - baseX, sample.productOffsetY - baseY),
  );
  const peakRelativeDisplacement = Math.max(...displacement);
  const responsePerRadian = headTurnRangeRad > 0.08
    ? peakRelativeDisplacement / headTurnRangeRad
    : null;

  // Estimate settling only when the final samples remain close to baseline.
  // This is an observed time, not a fitted damping constant.
  const threshold = Math.max(0.015, peakRelativeDisplacement * 0.12);
  let settleTimeMs: number | null = null;
  for (let i = 1; i < displacement.length - 1; i++) {
    if (displacement.slice(i).every((value) => value <= threshold)) {
      settleTimeMs = valid[i].timestampMs - valid[0].timestampMs;
      break;
    }
  }

  const quality = valid.length >= 20 && meanConfidence >= 0.75 && headTurnRangeRad >= 0.2
    ? "strong"
    : valid.length >= MIN_SAMPLES && meanConfidence >= 0.6
      ? "usable"
      : "insufficient";

  return {
    sampleCount: valid.length,
    durationMs,
    meanConfidence,
    headTurnRangeRad,
    peakRelativeDisplacement,
    responsePerRadian,
    settleTimeMs,
    quality,
  };
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
