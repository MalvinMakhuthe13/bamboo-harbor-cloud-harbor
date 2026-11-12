export type HeadPoseSource = "matrix" | "landmarks" | "none";

export type HeadPose = {
  yaw: number;
  pitch: number;
  roll: number;
  confidence: number;
  source: Exclude<HeadPoseSource, "none">;
};

export type EulerAngles = Pick<HeadPose, "yaw" | "pitch" | "roll">;

export type FacePoint = { x: number; y: number; z?: number };

const RAD_TO_DEG = 180 / Math.PI;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function finite(values: readonly number[]): boolean {
  return values.every(Number.isFinite);
}

/**
 * Converts MediaPipe's 4x4 column-major canonical-to-observed face matrix
 * into camera-space Euler angles. Angles are degrees.
 *
 * Rotation convention: yaw around Y, pitch around X, roll around Z.
 */
export function matrixToEuler(matrix: readonly number[] | null | undefined): EulerAngles | null {
  if (!matrix || matrix.length !== 16 || !finite(matrix)) return null;

  // Matrix.data is column-major: index = column * 4 + row.
  const r00 = matrix[0]!;
  const r10 = matrix[1]!;
  const r20 = matrix[2]!;
  const r11 = matrix[5]!;
  const r21 = matrix[6]!;
  const r12 = matrix[9]!;
  const r22 = matrix[10]!;

  const columnLengths = [
    Math.hypot(r00, r10, r20),
    Math.hypot(r01, r11, r21),
    Math.hypot(r02, r12, r22),
  ];
  if (columnLengths.some((length) => length < 0.5 || length > 1.5)) return null;

  const sinYaw = clamp(-r20, -1, 1);
  const yaw = Math.asin(sinYaw);
  const cosYaw = Math.cos(yaw);
  let pitch: number;
  let roll: number;

  if (Math.abs(cosYaw) > 1e-5) {
    pitch = Math.atan2(r21, r22);
    roll = Math.atan2(r10, r00);
  } else {
    // Gimbal-lock fallback: keep a stable roll and recover pitch from the
    // remaining observable terms.
    pitch = Math.atan2(-r12, r11);
    roll = 0;
  }

  const result = {
    yaw: yaw * RAD_TO_DEG,
    pitch: pitch * RAD_TO_DEG,
    roll: roll * RAD_TO_DEG,
  };
  return finite([result.yaw, result.pitch, result.roll]) ? result : null;
}

/**
 * Low-confidence 2D fallback. It estimates yaw from nose displacement within
 * the cheek span and roll from the eye line. Pitch is intentionally neutral:
 * 2D landmarks alone do not provide a dependable absolute pitch estimate.
 */
export function landmarkPose(landmarks: readonly FacePoint[] | null | undefined): HeadPose | null {
  if (!landmarks || landmarks.length <= 454) return null;
  const leftEye = landmarks[33];
  const rightEye = landmarks[263];
  const leftCheek = landmarks[234];
  const rightCheek = landmarks[454];
  const nose = landmarks[1];
  if (!leftEye || !rightEye || !leftCheek || !rightCheek || !nose) return null;
  const points = [leftEye, rightEye, leftCheek, rightCheek, nose];
  if (!points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) return null;

  const eyeDx = rightEye.x - leftEye.x;
  const eyeDy = rightEye.y - leftEye.y;
  const cheekSpan = rightCheek.x - leftCheek.x;
  if (Math.abs(eyeDx) < 1e-4 || Math.abs(cheekSpan) < 1e-4) return null;

  const cheekCenter = (leftCheek.x + rightCheek.x) / 2;
  const normalizedNoseOffset = (nose.x - cheekCenter) / (Math.abs(cheekSpan) * 0.5);
  const yaw = Math.asin(clamp(normalizedNoseOffset, -0.85, 0.85)) * RAD_TO_DEG * 0.55;
  const roll = Math.atan2(eyeDy, eyeDx) * RAD_TO_DEG;

  return {
    yaw: clamp(yaw, -55, 55),
    pitch: 0,
    roll: clamp(roll, -45, 45),
    confidence: 0.3,
    source: "landmarks",
  };
}

export function fuseHeadPose(
  matrix: readonly number[] | null | undefined,
  landmarks: readonly FacePoint[] | null | undefined,
): HeadPose | null {
  const euler = matrixToEuler(matrix);
  if (euler) return { ...euler, confidence: 0.95, source: "matrix" };
  return landmarkPose(landmarks);
}

function shortestAngleDelta(next: number, previous: number): number {
  return ((next - previous + 540) % 360) - 180;
}

function alpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

/** One Euro filter for a single angular channel, with wrap-safe deltas. */
export class OneEuroAngleFilter {
  private previousRaw: number | null = null;
  private filtered: number | null = null;
  private filteredDerivative = 0;
  private previousAt: number | null = null;

  private readonly minCutoff: number;
  private readonly beta: number;
  private readonly derivativeCutoff: number;

  constructor(minCutoff = 1, beta = 0.02, derivativeCutoff = 1) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.derivativeCutoff = derivativeCutoff;
  }

  filter(value: number, atMs: number): number {
    if (!Number.isFinite(value) || !Number.isFinite(atMs)) {
      return this.filtered ?? 0;
    }
    if (this.filtered == null || this.previousRaw == null || this.previousAt == null || atMs <= this.previousAt) {
      this.previousRaw = value;
      this.filtered = value;
      this.previousAt = atMs;
      this.filteredDerivative = 0;
      return value;
    }

    const dt = Math.max(1e-3, (atMs - this.previousAt) / 1000);
    const rawDelta = shortestAngleDelta(value, this.previousRaw);
    const derivative = rawDelta / dt;
    const derivativeAlpha = alpha(this.derivativeCutoff, dt);
    this.filteredDerivative += derivativeAlpha * (derivative - this.filteredDerivative);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.filteredDerivative);
    const valueAlpha = alpha(cutoff, dt);
    const deltaToFiltered = shortestAngleDelta(value, this.filtered);
    const next = this.filtered + valueAlpha * deltaToFiltered;
    this.filtered = ((next + 540) % 360) - 180;
    this.previousRaw = value;
    this.previousAt = atMs;
    return this.filtered;
  }

  reset(): void {
    this.previousRaw = null;
    this.filtered = null;
    this.filteredDerivative = 0;
    this.previousAt = null;
  }
}

/** Collects a stable neutral pose and returns angles relative to that baseline. */
export class NeutralPoseCalibration {
  private neutral: EulerAngles | null = null;

  setNeutral(pose: EulerAngles): void {
    if (!finite([pose.yaw, pose.pitch, pose.roll])) return;
    this.neutral = { ...pose };
  }

  clear(): void {
    this.neutral = null;
  }

  apply(pose: EulerAngles): EulerAngles {
    if (!this.neutral) return { ...pose };
    return {
      yaw: shortestAngleDelta(pose.yaw, this.neutral.yaw),
      pitch: shortestAngleDelta(pose.pitch, this.neutral.pitch),
      roll: shortestAngleDelta(pose.roll, this.neutral.roll),
    };
  }

  get calibrated(): boolean {
    return this.neutral !== null;
  }
}

/** Combines neutral calibration with per-axis One Euro smoothing. */
export class HeadPoseSmoother {
  private readonly calibration = new NeutralPoseCalibration();
  private readonly yaw = new OneEuroAngleFilter();
  private readonly pitch = new OneEuroAngleFilter();
  private readonly roll = new OneEuroAngleFilter();

  update(pose: HeadPose, atMs: number): HeadPose {
    const relative = this.calibration.apply(pose);
    return {
      ...pose,
      yaw: this.yaw.filter(relative.yaw, atMs),
      pitch: this.pitch.filter(relative.pitch, atMs),
      roll: this.roll.filter(relative.roll, atMs),
    };
  }

  calibrateNeutral(pose: HeadPose): void {
    this.calibration.setNeutral(pose);
    this.yaw.reset();
    this.pitch.reset();
    this.roll.reset();
  }

  reset(): void {
    this.calibration.clear();
    this.yaw.reset();
    this.pitch.reset();
    this.roll.reset();
  }

  get calibrated(): boolean {
    return this.calibration.calibrated;
  }
}
