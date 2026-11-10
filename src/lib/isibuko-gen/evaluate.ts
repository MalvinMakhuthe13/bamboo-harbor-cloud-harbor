/** Pixel scores for a future shirt model. Operates on buffers the caller already has. */

export type Rgba = { width: number; height: number; data: Uint8Array };

export type ShirtScore = {
  /** 0 is a perfect mean-colour match between the merchant shirt and the worn region. */
  colorDrift: number;
  /** Mean absolute change inside the garment across consecutive frames. Lower is steadier. */
  flicker: number;
  /** Mean absolute change outside the garment. Lower means the person was left alone. */
  identityDrift: number;
  /** Mean absolute change inside a hand-occlusion mask. Lower means the hand was not repainted. */
  occlusionDrift: number;
  pixels: number;
};

function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function rgbAt(image: Rgba, index: number): [number, number, number] {
  const o = index * 4;
  return [image.data[o] ?? 0, image.data[o + 1] ?? 0, image.data[o + 2] ?? 0];
}

export function meanColor(image: Rgba, mask?: Uint8Array): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  const count = image.width * image.height;
  for (let i = 0; i < count; i++) {
    if (mask && !mask[i]) continue;
    const [pr, pg, pb] = rgbAt(image, i);
    r += pr;
    g += pg;
    b += pb;
    n += 1;
  }
  if (!n) return [0, 0, 0];
  return [r / n, g / n, b / n];
}

export function colorDrift(garment: Rgba, worn: Rgba, wornMask: Uint8Array): number {
  const a = meanColor(garment);
  const b = meanColor(worn, wornMask);
  return (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) / 3;
}

export function maskedDrift(before: Rgba, after: Rgba, mask: Uint8Array, inside: boolean): number {
  const count = Math.min(before.width * before.height, after.width * after.height, mask.length);
  const diffs: number[] = [];
  for (let i = 0; i < count; i++) {
    const on = Boolean(mask[i]);
    if (on !== inside) continue;
    const p = rgbAt(before, i);
    const q = rgbAt(after, i);
    diffs.push((Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2])) / 3);
  }
  return mean(diffs);
}

export function flicker(frames: Rgba[], garmentMask: Uint8Array): number {
  if (frames.length < 2) return 0;
  const scores: number[] = [];
  for (let i = 1; i < frames.length; i++) {
    const prev = frames[i - 1];
    const next = frames[i];
    if (!prev || !next) continue;
    scores.push(maskedDrift(prev, next, garmentMask, true));
  }
  return mean(scores);
}

export function evaluateShirt(input: {
  garment: Rgba;
  before: Rgba;
  worn: Rgba[];
  garmentMask: Uint8Array;
  handMask: Uint8Array;
}): ShirtScore {
  const first = input.worn[0];
  return {
    colorDrift: first ? colorDrift(input.garment, first, input.garmentMask) : 0,
    flicker: flicker(input.worn, input.garmentMask),
    identityDrift: first ? maskedDrift(input.before, first, input.garmentMask, false) : 0,
    occlusionDrift: first ? maskedDrift(input.before, first, input.handMask, true) : 0,
    pixels: input.before.width * input.before.height,
  };
}

/** 2×2 numeric fixture. Not a photograph and not a model output. */
export function syntheticScoreFixture(): Parameters<typeof evaluateShirt>[0] {
  const solid = (r: number, g: number, b: number, pixels = 4): Rgba => ({
    width: 2,
    height: 2,
    data: Uint8Array.from({ length: pixels * 4 }, (_, i) => {
      const channel = i % 4;
      if (channel === 3) return 255;
      return [r, g, b][channel] ?? 0;
    }),
  });
  const garment = solid(180, 150, 110);
  const before = solid(20, 40, 60);
  const worn = solid(180, 150, 110);
  // Leave pixel 0 (outside the garment) as the original person.
  worn.data[0] = 20;
  worn.data[1] = 40;
  worn.data[2] = 60;
  const next = {
    width: 2,
    height: 2,
    data: Uint8Array.from(worn.data),
  };
  next.data[4] = 176;
  return {
    garment,
    before,
    worn: [worn, next],
    garmentMask: Uint8Array.from([0, 1, 1, 1]),
    handMask: Uint8Array.from([0, 0, 0, 0]),
  };
}

/** Mean step between landmarks. A synthetic track is not a person. */
export function landmarkJitter(points: { x: number; y: number }[]): number {
  if (points.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const next = points[i]!;
    sum += Math.hypot(next.x - prev.x, next.y - prev.y);
  }
  return sum / (points.length - 1);
}

export function latencyWithin(ms: number, budgetMs: number): { pass: boolean; ms: number; budgetMs: number } {
  return { pass: ms >= 0 && ms <= budgetMs, ms, budgetMs };
}
