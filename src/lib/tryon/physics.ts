import type { Material, WigStyle } from "@/lib/tryon/types";

/**
 * Scene units are centimetres. These coefficients are what the mirror integrates
 * and what the Fit math page prints. Change them here, not in the renderer.
 *
 * Gravity is 520 cm/s², not 981. A phone cannot spare the substeps a true
 * Earth fall would need at 30 fps, and hair that snaps to the floor in two
 * frames does not read as hair.
 */

export const GRAVITY_CM_S2 = 520;
export const VERLET_DAMP = 0.94;
export const CONSTRAINT_PASSES = 3;
export const GRAB_LERP = 0.55;
export const GRAB_RADIUS_NORM = 0.055;
export const SECTION_RADIUS = 3;
export const SECTION_FOLLOW = 0.42;

export const PENDULUM_K = 14;
export const PENDULUM_DAMP = 0.9;
export const PENDULUM_DRIVE = 0.85;
export const EAR_SWING_X = 0.8;
export const EAR_SWING_Z = 1.4;

export const PALM_TO_WRIST = 2.15;
export const PALM_TO_FINGER = 1 / 5.1;
export const FACE_TO_HEAD = Math.PI * 0.92;
export const GLASSES_REF_FACE_CM = 14;
export const WATCH_REF_WRIST_CM = 16.5;
export const RING_REF_FINGER_CM = 1.6;
export const FINGER_LENGTH_TO_BREADTH = 4.8;

export const CHEST_BREADTH_OF_SHOULDER = 0.78;
export const CHEST_DEPTH_OF_BREADTH = 0.72;
export const WAIST_OF_HIP = 0.92;
export const WAIST_OF_SHOULDER = 0.7;
export const WAIST_DEPTH_OF_BREADTH = 0.7;
export const HIP_DEPTH_OF_BREADTH = 0.68;
export const HIP_BREADTH_OF_HEIGHT = 0.19;

export const POSE_Z_TO_CM = 28;
export const HAND_Z_TO_CM = 18;
export const NAIL_SETBACK_CM = 0.12;
export const CAT_EYE_ROLL = 0.22;

export const NECKLACE_BEADS = 12;
export const NECKLACE_SEGMENT_CM = 1.15;
export const NECKLACE_STIFFNESS = 0.72;

export const FOLD_FREQ = 9;
export const FOLD_SPEED = 2.4;

export type ChainNode = { x: number; y: number; px: number; py: number };

export function constraintBlend(stiffness: number): number {
  return 0.45 + stiffness * 0.45;
}

export function hairStiffness(sway: number, curly: boolean): number {
  const drag = curly ? 0.7 : 1;
  return clamp(1 - sway * drag, 0.2, 0.92);
}

/** Rest length of a full strand, in centimetres, before a per-strand multiplier. */
export function hairDropCm(length: number, style: WigStyle): number {
  const base = style === "bob" ? 16 : style === "braids" ? 30 : 24;
  return length * base;
}

export function ribbonWidthCm(style: WigStyle): number {
  if (style === "braids") return 0.72;
  if (style === "bob") return 0.26;
  return 0.2;
}

/**
 * Strands within `radius` indices of the grabbed one, not including it.
 * Weight falls linearly. The wig is not one rigid body.
 */
export function sectionWeights(
  count: number,
  grabbed: number,
  radius = SECTION_RADIUS,
): { index: number; weight: number }[] {
  if (grabbed < 0 || grabbed >= count || count < 2) return [];
  const out: { index: number; weight: number }[] = [];
  for (let i = 0; i < count; i++) {
    const distance = Math.abs(i - grabbed);
    if (distance === 0 || distance > radius) continue;
    out.push({ index: i, weight: 1 - distance / (radius + 1) });
  }
  return out;
}

export function stepPendulum(
  swing: number,
  vel: number,
  yawRate: number,
  dt: number,
): { swing: number; vel: number } {
  let next = vel - swing * PENDULUM_K * dt;
  next *= PENDULUM_DAMP;
  next += yawRate * PENDULUM_DRIVE;
  return { swing: swing + next, vel: next };
}

export function foldAmplitudeCm(material: Material): number {
  if (material === "satin") return 0.55;
  if (material === "cotton") return 1.35;
  if (material === "silky") return 0.9;
  return 0.75;
}

export function foldWaveCm(rowT: number, time: number, amplitude: number, belly: boolean): number {
  return Math.sin(rowT * FOLD_FREQ + time * FOLD_SPEED) * amplitude * (belly ? 1 : 0.35);
}

export function thighRadiusCm(hipSpanCm: number): number {
  return clamp(hipSpanCm * 0.28, 3.4, 8.5);
}

export function shinRadiusCm(thigh: number): number {
  return thigh * 0.7;
}

export type EaseRead = {
  /** Garment midpoint minus the body. Positive means the cloth is larger. */
  easeCm: number;
  /** How far each side seam moves out from the body, in centimetres. */
  flareCm: number;
  /** 0.25 is taut and almost smooth. Near 2 is loose and rumpled. */
  wrinkle: number;
  taut: boolean;
};

/**
 * Ease is why the same body looks different in two shirts.
 * The size row is the body the garment was cut for. The flare is the extra
 * half-breadth that ease becomes, and the wrinkle gain follows it:
 * tight cloth cannot fold, loose cloth has to.
 */
export function garmentEase(bodyCm: number | null, range: [number, number] | null | undefined): EaseRead {
  if (!range) return { easeCm: 4, flareCm: 1, wrinkle: 1, taut: false };
  const mid = (range[0] + range[1]) / 2;
  const body = bodyCm ?? mid;
  const easeCm = mid - body;
  return {
    easeCm,
    flareCm: clamp(easeCm / 4.2, -1.8, 4.8),
    wrinkle: easeCm < -1 ? 0.25 : clamp(0.5 + easeCm / 12, 0.25, 1.9),
    taut: easeCm < -1,
  };
}

/**
 * Kinematic fold, not a cloth solver. Depth is off the body, slide is along
 * the seam. `bend` gathers the waist when the torso shortens. `twist` is the
 * shoulder line versus the hip line, so a turn drags the fold with it.
 */
export function clothWrinkleCm(
  rowT: number,
  across: number,
  phase: number,
  amplitude: number,
  bend: number,
  twist: number,
): { depth: number; slide: number } {
  const belly = rowT > 0.2 && rowT < 0.95 ? 1 : 0.4;
  const hem = rowT > 1 ? 1.3 : 1;
  const gather = 1 + bend * 1.7 * (1 - Math.min(1, Math.abs(across - 0.5) * 2));
  const amp = amplitude * belly * hem * gather;
  const x = across * 2 - 1;
  const depth =
    Math.sin(rowT * 8.2 + phase + x * 3.1) * 0.64 * amp +
    Math.sin(rowT * 14.5 - phase * 0.65 + twist * 2.2 + x * 5) * 0.36 * amp;
  const slide = Math.cos(rowT * 7.4 + phase * 0.8 + twist) * amp * 0.28 * x;
  return { depth, slide };
}

/** 0 is a straight leg. 1 is a hard fold at the knee. */
export function kneeBendAmount(
  hip: { x: number; y: number; z: number },
  knee: { x: number; y: number; z: number },
  ankle: { x: number; y: number; z: number },
): number {
  const ax = knee.x - hip.x;
  const ay = knee.y - hip.y;
  const az = knee.z - hip.z;
  const bx = ankle.x - knee.x;
  const by = ankle.y - knee.y;
  const bz = ankle.z - knee.z;
  const la = Math.hypot(ax, ay, az) || 1;
  const lb = Math.hypot(bx, by, bz) || 1;
  const cos = (ax * bx + ay * by + az * bz) / (la * lb);
  return clamp((1 - cos) / 1.35, 0, 1);
}

export function wristFromPalm(palmCm: number): number {
  return palmCm * PALM_TO_WRIST;
}

export function fingerFromPalm(palmCm: number): number {
  return palmCm * PALM_TO_FINGER;
}

export function headFromFace(faceWidthCm: number): number {
  return faceWidthCm * FACE_TO_HEAD;
}

export function glassesScale(faceCm: number | null): number {
  return clamp((faceCm ?? GLASSES_REF_FACE_CM) / GLASSES_REF_FACE_CM, 0.82, 1.25);
}

export function watchScale(wristCm: number | null): number {
  return clamp((wristCm ?? WATCH_REF_WRIST_CM) / WATCH_REF_WRIST_CM, 0.75, 1.35);
}

export function ringScale(fingerCm: number | null): number {
  return clamp((fingerCm ?? RING_REF_FINGER_CM) / RING_REF_FINGER_CM, 0.7, 1.45);
}

export function nailScale(shape: "almond" | "square" | "stiletto"): number {
  if (shape === "stiletto") return 1.15;
  if (shape === "square") return 1;
  return 0.9;
}

/**
 * One Verlet step of a 2D chain, same coefficients as the 3D hair and necklace.
 * `gravity` is in the same unit as the positions, per second squared.
 * A grabbed node lerps toward `grabAt` and skips integration.
 */
export function stepChain2d(
  nodes: ChainNode[],
  root: { x: number; y: number },
  segment: number,
  dt: number,
  stiffness: number,
  grabIndex: number,
  grabAt: { x: number; y: number } | null,
  pull = 1,
  gravity = GRAVITY_CM_S2,
): void {
  if (nodes.length === 0) return;
  const g = gravity * dt * dt;
  const blend = constraintBlend(stiffness);
  nodes[0].px = nodes[0].x;
  nodes[0].py = nodes[0].y;
  nodes[0].x = root.x;
  nodes[0].y = root.y;
  for (let i = 1; i < nodes.length; i++) {
    const n = nodes[i];
    if (i === grabIndex && grabAt) {
      n.px = n.x;
      n.py = n.y;
      const t = GRAB_LERP * pull;
      n.x += (grabAt.x - n.x) * t;
      n.y += (grabAt.y - n.y) * t;
      continue;
    }
    const vx = (n.x - n.px) * VERLET_DAMP;
    const vy = (n.y - n.py) * VERLET_DAMP;
    n.px = n.x;
    n.py = n.y;
    n.x += vx;
    n.y += vy + g;
  }
  for (let pass = 0; pass < CONSTRAINT_PASSES; pass++) {
    for (let i = 1; i < nodes.length; i++) {
      const a = nodes[i - 1];
      const b = nodes[i];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 0.0001;
      const scale = ((len - segment) / len) * blend;
      dx *= scale;
      dy *= scale;
      const moveA = i - 1 > 0 && i - 1 !== grabIndex;
      const moveB = i !== grabIndex;
      if (moveA) {
        a.x += dx;
        a.y += dy;
      }
      if (moveB) {
        b.x -= dx;
        b.y -= dy;
      }
    }
  }
}

export function hangChain(count: number, originX: number, originY: number, segment: number): ChainNode[] {
  return Array.from({ length: count }, (_, i) => {
    const y = originY + i * segment;
    return { x: originX, y, px: originX, py: y };
  });
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
