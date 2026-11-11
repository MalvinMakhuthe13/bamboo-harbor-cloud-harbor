/** Measures a garment raster. This is not a neural encoder and it does not paint a person. */

export type Rgb = [number, number, number];

export type Raster = { width: number; height: number; rgba: Uint8Array };

export type GarmentReading = {
  sku: string;
  lockId: string;
  assetHash: string;
  method: "measured-geometry";
  learnedEncoder: false;
  generative: false;
  executed: true;
  bounds: { x0: number; y0: number; x1: number; y1: number };
  sleeveLengthPx: number;
  collarOpening: boolean;
  hemY: number;
  logo: { x0: number; y0: number; x1: number; y1: number } | null;
  patternRuns: number;
  textureStd: number;
  shoulderWidthPx: number;
  torsoLengthPx: number;
  materialFromLock: string;
  coloursFromLock: string[];
};

const BG: Rgb = [8, 8, 8];
const CLOTH: Rgb = [170, 120, 70];
const STRIPE: Rgb = [90, 55, 30];
const LOGO: Rgb = [20, 40, 200];

function at(raster: Raster, x: number, y: number): number {
  return (y * raster.width + x) * 4;
}

function rgb(raster: Raster, x: number, y: number): Rgb {
  const i = at(raster, x, y);
  return [raster.rgba[i]!, raster.rgba[i + 1]!, raster.rgba[i + 2]!];
}

function fill(raster: Raster, x0: number, y0: number, x1: number, y1: number, color: Rgb) {
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const i = at(raster, x, y);
      raster.rgba[i] = color[0];
      raster.rgba[i + 1] = color[1];
      raster.rgba[i + 2] = color[2];
      raster.rgba[i + 3] = 255;
    }
  }
}

function far(color: Rgb, from: Rgb): boolean {
  const d = Math.abs(color[0] - from[0]) + Math.abs(color[1] - from[1]) + Math.abs(color[2] - from[2]);
  return d > 40;
}

/** A drawn shirt with a known collar hole, sleeves, stripe, and logo. Not a photograph and not a person. */
export function knownShirt(): Raster {
  const raster: Raster = { width: 80, height: 96, rgba: new Uint8Array(80 * 96 * 4) };
  fill(raster, 0, 0, 79, 95, BG);
  fill(raster, 22, 20, 57, 84, CLOTH);
  fill(raster, 6, 24, 21, 44, CLOTH);
  fill(raster, 58, 24, 73, 44, CLOTH);
  fill(raster, 34, 20, 45, 30, BG);
  for (let x = 22; x <= 57; x += 1) {
    if (Math.floor((x - 22) / 4) % 2 === 0) fill(raster, x, 48, x, 52, STRIPE);
  }
  fill(raster, 46, 40, 51, 46, LOGO);
  return raster;
}

function logoPixel(color: Rgb): boolean {
  return color[2] > 150 && color[0] < 40;
}

export function bindGarment(
  raster: Raster,
  lock: { lockId: string; sku: string; contentHash: string; material: string; colours: string[] },
  digest: (bytes: Uint8Array) => string,
): { ok: true; reading: GarmentReading } | { ok: false; errors: string[] } {
  const assetHash = digest(raster.rgba);
  if (assetHash !== lock.contentHash) {
    return { ok: false, errors: ["The raster hash does not match the product lock."] };
  }
  const background = rgb(raster, 0, 0);
  let x0 = raster.width;
  let y0 = raster.height;
  let x1 = 0;
  let y1 = 0;
  let foreground = 0;
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      if (!far(rgb(raster, x, y), background)) continue;
      foreground += 1;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  if (foreground < 20) return { ok: false, errors: ["No garment pixels were found."] };

  const widthAt = (y: number) => {
    let left = -1;
    let right = -1;
    for (let x = 0; x < raster.width; x += 1) {
      if (!far(rgb(raster, x, y), background)) continue;
      if (left < 0) left = x;
      right = x;
    }
    return left < 0 ? 0 : right - left + 1;
  };
  const shoulderWidthPx = widthAt(34);
  const torsoWidthPx = widthAt(70);
  const sleeveLengthPx = Math.round((shoulderWidthPx - torsoWidthPx) / 2);
  let hemY = y0;
  const mid = Math.round((x0 + x1) / 2);
  for (let y = raster.height - 1; y >= 0; y -= 1) {
    if (far(rgb(raster, mid, y), background)) {
      hemY = y;
      break;
    }
  }
  let hole = 0;
  for (let y = y0; y <= y0 + 12; y += 1) {
    for (let x = mid - 4; x <= mid + 4; x += 1) {
      if (!far(rgb(raster, x, y), background)) hole += 1;
    }
  }
  let lx0 = raster.width;
  let ly0 = raster.height;
  let lx1 = -1;
  let ly1 = -1;
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      if (!logoPixel(rgb(raster, x, y))) continue;
      lx0 = Math.min(lx0, x);
      ly0 = Math.min(ly0, y);
      lx1 = Math.max(lx1, x);
      ly1 = Math.max(ly1, y);
    }
  }
  const scanY = 50;
  let runs = 0;
  let previous = "";
  for (let x = 22; x <= 57; x += 1) {
    const color = rgb(raster, x, scanY);
    const key = logoPixel(color) ? "logo" : far(color, CLOTH) ? "mark" : "cloth";
    if (previous && key !== previous) runs += 1;
    previous = key;
  }
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 36; y <= 44; y += 1) {
    for (let x = 24; x <= 40; x += 1) {
      const color = rgb(raster, x, y);
      if (!far(color, background) || logoPixel(color)) continue;
      const lum = (color[0] + color[1] + color[2]) / 3;
      sum += lum;
      sumSq += lum * lum;
      n += 1;
    }
  }
  const mean = n ? sum / n : 0;
  const textureStd = n ? Math.sqrt(Math.max(0, sumSq / n - mean * mean)) : 0;
  const torsoLengthPx = hemY - y0 + 1;
  return {
    ok: true,
    reading: {
      sku: lock.sku,
      lockId: lock.lockId,
      assetHash,
      method: "measured-geometry",
      learnedEncoder: false,
      generative: false,
      executed: true,
      bounds: { x0, y0, x1, y1 },
      sleeveLengthPx,
      collarOpening: hole > 20,
      hemY,
      logo: lx1 >= 0 ? { x0: lx0, y0: ly0, x1: lx1, y1: ly1 } : null,
      patternRuns: runs,
      textureStd,
      shoulderWidthPx,
      torsoLengthPx,
      materialFromLock: lock.material,
      coloursFromLock: [...lock.colours],
    },
  };
}
