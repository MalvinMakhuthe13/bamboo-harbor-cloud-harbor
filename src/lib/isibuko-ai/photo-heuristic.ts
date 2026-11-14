import { factFrom, type ProductFact } from "./product-facts.ts";
import { assertProductImage, imageMagic } from "./privacy.ts";

/**
 * Handcrafted reading of one merchant photograph.
 * This is not a learned model. It does not name a category, fabric, logo, or sleeve.
 *
 * A foreground pixel has alpha above {@link PHOTO_LIMITS.foregroundAlphaAbove}.
 * JPEG, WebP, and PNG images without a separated transparent background produce no visual facts.
 * An image whose declared edge or pixel count is above the cap is refused before a pixel buffer is kept.
 * PNG cannot be safely downscaled without inflating every scanline, so an oversized image is refused rather than decoded.
 */

export const PHOTO_LIMITS = {
  maxBytes: 1_500_000,
  maxEdge: 1024,
  maxPixels: 1024 * 1024,
  /** Foreground is alpha strictly greater than this. Matches the catalogue photograph scan. */
  foregroundAlphaAbove: 16,
  minTransparentRatio: 0.05,
} as const;

/** A fixed ceiling, not a measured accuracy. The heuristic has not been validated as a model. */
export const HEURISTIC_CONFIDENCE = 0.4;

const METHOD = "handcrafted-photograph";
const NO_FOREGROUND = "No separated foreground was available, so no visual facts were made.";
const READ_KEYS = ["bytes"] as const;
const FORBIDDEN_FIELDS = ["category", "fabric", "pattern", "logo", "sleeveLength", "material", "garmentType", "productColour"] as const;

export type HeuristicRefusal = {
  ok: false;
  code: "UNEXPECTED_INPUT" | "INVALID_IMAGE" | "TOO_LARGE" | "DIMENSIONS" | "DECODE";
  reason: string;
  learned: false;
  modelExecuted: null;
};

export type HeuristicReport = {
  ok: true;
  learned: false;
  method: typeof METHOD;
  modelExecuted: null;
  facts: ProductFact[];
  note: string;
};

let livePixelBuffers = 0;

/** Pixel buffers still retained. Tests use this to prove the scan releases its memory. */
export function livePixelBuffersHeld(): number {
  return livePixelBuffers;
}

function refuse(code: HeuristicRefusal["code"], reason: string): HeuristicRefusal {
  return { ok: false, code, reason, learned: false, modelExecuted: null };
}

function emptyReport(): HeuristicReport {
  return {
    ok: true,
    learned: false,
    method: METHOD,
    modelExecuted: null,
    facts: [],
    note: NO_FOREGROUND,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function u32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) * 16777216) + ((bytes[offset + 1] ?? 0) << 16) + ((bytes[offset + 2] ?? 0) << 8) + (bytes[offset + 3] ?? 0);
}

function u16(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function withinLimits(width: number, height: number): HeuristicRefusal | null {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    return refuse("DECODE", "The image dimensions could not be read.");
  }
  if (width > PHOTO_LIMITS.maxEdge || height > PHOTO_LIMITS.maxEdge || width * height > PHOTO_LIMITS.maxPixels) {
    return refuse("DIMENSIONS", `The image is above ${PHOTO_LIMITS.maxEdge} pixels on the long edge. It was not decoded.`);
  }
  return null;
}

function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset] ?? 0;
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) return null;
    if (offset + 1 >= bytes.length) return null;
    const length = u16(bytes, offset);
    if (length < 2 || offset + length > bytes.length) return null;
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      if (length < 7) return null;
      return { height: u16(bytes, offset + 3), width: u16(bytes, offset + 5) };
    }
    offset += length;
  }
  return null;
}

function webpSize(bytes: Uint8Array): { width: number; height: number } | null {
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = String.fromCharCode(bytes[offset] ?? 0, bytes[offset + 1] ?? 0, bytes[offset + 2] ?? 0, bytes[offset + 3] ?? 0);
    const size = (bytes[offset + 4] ?? 0) | ((bytes[offset + 5] ?? 0) << 8) | ((bytes[offset + 6] ?? 0) << 16) | ((bytes[offset + 7] ?? 0) << 24);
    const data = offset + 8;
    if (size < 0 || data + size > bytes.length) return null;
    if (type === "VP8X" && size >= 10) {
      const width = 1 + ((bytes[data + 4] ?? 0) | ((bytes[data + 5] ?? 0) << 8) | ((bytes[data + 6] ?? 0) << 16));
      const height = 1 + ((bytes[data + 7] ?? 0) | ((bytes[data + 8] ?? 0) << 8) | ((bytes[data + 9] ?? 0) << 16));
      return { width, height };
    }
    if (type === "VP8 " && size >= 10 && bytes[data + 3] === 0x9d && bytes[data + 4] === 0x01 && bytes[data + 5] === 0x2a) {
      const width = ((bytes[data + 6] ?? 0) | ((bytes[data + 7] ?? 0) << 8)) & 0x3fff;
      const height = ((bytes[data + 8] ?? 0) | ((bytes[data + 9] ?? 0) << 8)) & 0x3fff;
      return { width, height };
    }
    offset = data + size + (size & 1);
  }
  return null;
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const dl = Math.abs(estimate - left);
  const du = Math.abs(estimate - up);
  const dlu = Math.abs(estimate - upLeft);
  if (dl <= du && dl <= dlu) return left;
  if (du <= dlu) return up;
  return upLeft;
}

type PngHeader = { width: number; height: number; bitDepth: number; colorType: number; interlace: number; idat: Uint8Array | null };

function pngHeader(bytes: Uint8Array): PngHeader | HeuristicRefusal {
  if (bytes.length < 24) return refuse("DECODE", "The PNG is incomplete.");
  let offset = 8;
  let header: Omit<PngHeader, "idat"> | null = null;
  const parts: Uint8Array[] = [];
  let total = 0;
  while (offset + 8 <= bytes.length) {
    const length = u32(bytes, offset);
    const type = String.fromCharCode(bytes[offset + 4] ?? 0, bytes[offset + 5] ?? 0, bytes[offset + 6] ?? 0, bytes[offset + 7] ?? 0);
    if (length < 0 || offset + 12 + length > bytes.length) return refuse("DECODE", "The PNG is incomplete.");
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      if (length < 13) return refuse("DECODE", "The PNG header is incomplete.");
      header = {
        width: u32(data, 0),
        height: u32(data, 4),
        bitDepth: data[8] ?? 0,
        colorType: data[9] ?? 0,
        interlace: data[12] ?? 0,
      };
      const limited = withinLimits(header.width, header.height);
      if (limited) return limited;
    } else if (type === "IDAT" && header?.colorType === 6 && header.bitDepth === 8 && header.interlace === 0) {
      parts.push(data);
      total += data.length;
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  if (!header) return refuse("DECODE", "The PNG header is missing.");
  if (parts.length === 0) return { ...header, idat: null };
  const idat = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    idat.set(part, cursor);
    cursor += part.length;
  }
  return { ...header, idat };
}

/**
 * Node tests inflate here. The browser must not import `node:zlib` or the
 * wardrobe page fails to load. A browser without this builtin returns a
 * decode refusal; the file can still be saved.
 */
function inflatePng(data: Uint8Array): Uint8Array {
  const builtin = (
    globalThis as {
      process?: { getBuiltinModule?: (id: string) => { inflateSync: (input: Uint8Array) => Uint8Array } };
    }
  ).process?.getBuiltinModule?.("node:zlib");
  if (!builtin) throw new Error("PNG inflate is not available in this runtime.");
  return new Uint8Array(builtin.inflateSync(data));
}

function analyseRgba(width: number, height: number, idat: Uint8Array): HeuristicReport | HeuristicRefusal {
  livePixelBuffers += 1;
  let inflated: Uint8Array | null = null;
  let pixels: Uint8Array | null = null;
  try {
    inflated = inflatePng(idat);
    const stride = width * 4;
    const expected = height * (stride + 1);
    if (inflated.length < expected) return refuse("DECODE", "The PNG pixel data is incomplete.");
    pixels = new Uint8Array(height * stride);
    let source = 0;
    for (let y = 0; y < height; y += 1) {
      const filter = inflated[source] ?? 0;
      source += 1;
      const dest = y * stride;
      for (let index = 0; index < stride; index += 1) {
        const raw = inflated[source + index] ?? 0;
        const left = index >= 4 ? pixels[dest + index - 4] ?? 0 : 0;
        const up = y > 0 ? pixels[dest - stride + index] ?? 0 : 0;
        const upLeft = y > 0 && index >= 4 ? pixels[dest - stride + index - 4] ?? 0 : 0;
        let value = raw;
        if (filter === 1) value = (raw + left) & 255;
        else if (filter === 2) value = (raw + up) & 255;
        else if (filter === 3) value = (raw + ((left + up) >> 1)) & 255;
        else if (filter === 4) value = (raw + paeth(left, up, upLeft)) & 255;
        else if (filter !== 0) return refuse("DECODE", "The PNG row filter is not supported.");
        pixels[dest + index] = value;
      }
      source += stride;
    }
    inflated = null;
    const total = width * height;
    let transparent = 0;
    let foreground = 0;
    let x0 = width;
    let y0 = height;
    let x1 = -1;
    let y1 = -1;
    const red: number[] = [];
    const green: number[] = [];
    const blue: number[] = [];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const alpha = pixels[(y * width + x) * 4 + 3] ?? 0;
        if (alpha <= PHOTO_LIMITS.foregroundAlphaAbove) {
          transparent += 1;
          continue;
        }
        foreground += 1;
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
        const start = (y * width + x) * 4;
        red.push(pixels[start] ?? 0);
        green.push(pixels[start + 1] ?? 0);
        blue.push(pixels[start + 2] ?? 0);
      }
    }
    if (foreground < 1 || transparent / total < PHOTO_LIMITS.minTransparentRatio) return emptyReport();
    const facts = [
      observation("observedColour", `rgb(${median(red)}, ${median(green)}, ${median(blue)})`),
      observation("foregroundBounds", `${x0},${y0},${x1},${y1}`),
    ];
    if (facts.some((fact) => !fact)) return refuse("DECODE", "The observation could not be recorded.");
    return {
      ok: true,
      learned: false,
      method: METHOD,
      modelExecuted: null,
      facts: facts.filter((fact): fact is ProductFact => fact !== null),
      note: "Handcrafted scan of a transparent PNG. Not a learned model.",
    };
  } catch {
    return refuse("DECODE", "The PNG pixel data could not be read.");
  } finally {
    inflated = null;
    pixels = null;
    livePixelBuffers -= 1;
  }
}

function median(values: number[]): number {
  const sorted = values.slice().sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2);
}

function observation(field: "observedColour" | "foregroundBounds", value: string): ProductFact | null {
  if (FORBIDDEN_FIELDS.includes(field as (typeof FORBIDDEN_FIELDS)[number])) return null;
  const made = factFrom({
    field,
    value,
    origin: "detected",
    confidence: HEURISTIC_CONFIDENCE,
    verified: false,
    source: { kind: "detected", method: METHOD },
  });
  return made.ok ? made.fact : null;
}

export function readPhotograph(input: unknown): HeuristicReport | HeuristicRefusal {
  if (!isPlainObject(input)) return refuse("UNEXPECTED_INPUT", "The photograph request was refused.");
  for (const key of Object.keys(input)) {
    if (!READ_KEYS.includes(key as (typeof READ_KEYS)[number])) {
      return refuse("UNEXPECTED_INPUT", "Camera frames, landmarks, measurements, paths, and addresses are not accepted.");
    }
  }
  const bytes = input.bytes;
  if (!(bytes instanceof Uint8Array)) return refuse("UNEXPECTED_INPUT", "The photograph must be the file bytes, not a path or an address.");
  const magic = imageMagic(bytes);
  if (!magic) return refuse("INVALID_IMAGE", "The file is not a JPEG, PNG, or WebP.");
  const checked = assertProductImage({ type: magic, size: bytes.byteLength });
  if (!checked.ok) {
    return refuse(bytes.byteLength > PHOTO_LIMITS.maxBytes ? "TOO_LARGE" : "INVALID_IMAGE", checked.reason);
  }
  if (magic === "image/jpeg") {
    const size = jpegSize(bytes);
    if (!size) return refuse("DECODE", "The JPEG dimensions could not be read.");
    return withinLimits(size.width, size.height) ?? emptyReport();
  }
  if (magic === "image/webp") {
    const size = webpSize(bytes);
    if (!size) return refuse("DECODE", "The WebP dimensions could not be read.");
    return withinLimits(size.width, size.height) ?? emptyReport();
  }
  const header = pngHeader(bytes);
  if ("ok" in header) return header;
  if (header.bitDepth !== 8 || header.interlace !== 0 || header.colorType !== 6) return emptyReport();
  if (!header.idat) return refuse("DECODE", "The PNG has no pixel data.");
  return analyseRgba(header.width, header.height, header.idat);
}
