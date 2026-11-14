import type { Pt } from "@/lib/isibuko-ai/types";

/**
 * Secondary motion for the wig photograph and for small hanging pieces.
 * Three damped groups hang from the hairline. A head flick pushes them, they
 * overshoot, and the spring settles them. This moves the photograph. It does
 * not grow hair and it is not a cloth simulation.
 *
 * Constants are hand-set. The developer capture panel can store landmark
 * numbers after an explicit checkbox. It does not store pixels.
 */
export type HairCardState = { x: number; y: number; px: number; py: number };

export type HairStep = {
  state: HairCardState;
  hemX: number;
  hemY: number;
};

export type StrandName = "left" | "centre" | "right";
export type StrandSet = Record<StrandName, HairCardState>;
export type StrandStep = {
  state: StrandSet;
  hemX: number;
  hemY: number;
  leftX: number;
  rightX: number;
};

const REST_Y = 0.008;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function restHairCard(): HairCardState {
  return { x: 0, y: REST_Y, px: 0, py: REST_Y };
}

export function restStrands(): StrandSet {
  return { left: restHairCard(), centre: restHairCard(), right: restHairCard() };
}

/** A sudden speed increase becomes a short impulse. A steady speed does not. */
export function flickImpulse(previousSpeed: number, speed: number): number {
  if (!Number.isFinite(previousSpeed) || !Number.isFinite(speed)) return 0;
  const jump = speed - Math.max(0, previousSpeed);
  if (jump < 0.9) return 0;
  return clamp(jump * 1.8, 0, 5);
}

export function stepHairCard(
  state: HairCardState,
  opts: { dt: number; headVelocity: Pt; handPush: Pt; bias?: number; impulse?: number },
): HairStep {
  const dt = clamp(Number.isFinite(opts.dt) ? opts.dt : 1 / 60, 1 / 240, 1 / 30);
  const damp = 0.72;
  let vx = ((state.x - state.px) / dt) * damp;
  let vy = ((state.y - state.py) / dt) * damp;
  const driveX = Number.isFinite(opts.headVelocity.x) ? opts.headVelocity.x : 0;
  const driveY = Number.isFinite(opts.headVelocity.y) ? opts.headVelocity.y : 0;
  const pushX = Number.isFinite(opts.handPush.x) ? opts.handPush.x : 0;
  const pushY = Number.isFinite(opts.handPush.y) ? opts.handPush.y : 0;
  const bias = opts.bias ?? 0;
  const impulse = opts.impulse ?? 0;
  const ax = -(state.x - bias) * 34 - driveX * 2.1 + pushX + impulse;
  const ay = (REST_Y - state.y) * 26 + 0.22 - driveY * 0.9 + pushY;
  vx += ax * dt;
  vy += ay * dt;
  const x = clamp(state.x + vx * dt, -0.042, 0.042);
  const y = clamp(state.y + vy * dt, -0.016, 0.046);
  return { state: { x, y, px: state.x, py: state.y }, hemX: x, hemY: y };
}

const STRAND_BIAS: Record<StrandName, number> = { left: -0.01, centre: 0, right: 0.01 };
const STRAND_LAG: Record<StrandName, number> = { left: 1, centre: 0.72, right: 0.48 };

/** Three groups. The left answers a flick first. The right follows. */
export function stepStrandGroups(
  strands: StrandSet,
  opts: { dt: number; headVelocity: Pt; handPush: Pt; impulse?: number },
): StrandStep {
  const impulse = opts.impulse ?? 0;
  const next = { ...strands };
  const hems = {} as Record<StrandName, HairStep>;
  for (const name of ["left", "centre", "right"] as const) {
    const step = stepHairCard(strands[name], {
      dt: opts.dt,
      headVelocity: { x: opts.headVelocity.x * STRAND_LAG[name], y: opts.headVelocity.y * STRAND_LAG[name] },
      handPush: opts.handPush,
      bias: STRAND_BIAS[name],
      impulse: impulse * STRAND_LAG[name],
    });
    next[name] = step.state;
    hems[name] = step;
  }
  return {
    state: next,
    hemX: hems.centre.hemX,
    hemY: hems.centre.hemY,
    leftX: hems.left.hemX,
    rightX: hems.right.hemX,
  };
}

export type OrnamentState = HairCardState;

export function restOrnament(): OrnamentState {
  return restHairCard();
}

/** Earring or necklace swing. Shorter travel than the hair. */
export function stepOrnament(
  state: OrnamentState,
  opts: { dt: number; headVelocity: Pt },
): { state: OrnamentState; x: number; y: number } {
  const stepped = stepHairCard(state, {
    dt: opts.dt,
    headVelocity: opts.headVelocity,
    handPush: { x: 0, y: 0 },
  });
  return {
    state: stepped.state,
    x: clamp(stepped.hemX, -0.02, 0.02),
    y: clamp(stepped.hemY * 0.35, -0.008, 0.016),
  };
}

/** A palm inside the hair pushes the length away. Outside that radius it does nothing. */
export function handPushOnHair(forehead: Pt, palms: readonly Pt[], faceW: number): Pt {
  let x = 0;
  let y = 0;
  const reach = Math.max(faceW * 1.3, 0.08);
  for (const palm of palms) {
    const dx = forehead.x - palm.x;
    const dy = forehead.y + faceW * 0.35 - palm.y;
    const distance = Math.hypot(dx, dy);
    if (distance >= reach || distance < 1e-4) continue;
    const strength = ((reach - distance) / reach) * 14;
    x += (dx / distance) * strength;
    y += (dy / distance) * strength;
  }
  return { x: clamp(x, -12, 12), y: clamp(y, -12, 12) };
}
