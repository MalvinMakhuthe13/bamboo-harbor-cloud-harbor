import type { Category } from "./types.ts";
import { imageMagic, publicHttpUrl, type ProductImageMime } from "./privacy.ts";

/**
 * Bring a product photograph in from a file or a public image URL.
 * The category is a shape guess the shopper confirms. It is not a model.
 * Camera frames are not accepted here and are not fetched.
 */

export type CutoutKind = "alpha" | "corner-key" | "none";

export type PictureGuess = {
  category: Category;
  confidence: "low";
  reason: string;
  colourHex: string | null;
  cutout: CutoutKind;
};

const MAX_BYTES = 1_500_000;

export function guessFromPicture(opts: {
  width: number;
  height: number;
  transparentRatio: number;
  cornerUniform: boolean;
}): PictureGuess {
  const aspect = opts.width / Math.max(1, opts.height);
  const cutout: CutoutKind = opts.transparentRatio > 0.08 ? "alpha" : opts.cornerUniform ? "corner-key" : "none";
  let category: Category = "shirt";
  let reason = "Wider than it is tall, so the guess is a top. Change it if that is wrong.";
  if (aspect > 2.4) {
    category = "bracelet";
    reason = "A short wide picture. The guess is a bracelet. A watch is the same wrist fit if you change it.";
  } else if (aspect > 1.7 && opts.height < 240) {
    category = "glasses";
    reason = "A wide, short picture. The guess is glasses.";
  } else if (aspect < 0.55) {
    category = "dress";
    reason = "A tall picture. The guess is a dress. A skirt or trousers may fit this better.";
  } else if (aspect < 0.8 && opts.transparentRatio > 0.25) {
    category = "wig";
    reason = "A tall cut-out. The guess is hair. Confirm before trying it on.";
  } else if (aspect > 0.9 && aspect < 1.15 && opts.width < 400) {
    category = "earrings";
    reason = "A small nearly square picture. The guess is earrings.";
  }
  return { category, confidence: "low", reason, colourHex: null, cutout };
}

export function medianColourHex(pixels: Uint8Array): string | null {
  if (pixels.length < 4) return null;
  const reds: number[] = [];
  const greens: number[] = [];
  const blues: number[] = [];
  for (let i = 0; i < pixels.length; i += 16) {
    const alpha = pixels[i + 3] ?? 0;
    if (alpha < 20) continue;
    reds.push(pixels[i] ?? 0);
    greens.push(pixels[i + 1] ?? 0);
    blues.push(pixels[i + 2] ?? 0);
  }
  if (!reds.length) return null;
  const mid = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(mid(reds))}${hex(mid(greens))}${hex(mid(blues))}`;
}

export function readableImageUrl(raw: string): { ok: true; url: string } | { ok: false; reason: string } {
  const checked = publicHttpUrl(raw);
  if (!checked.ok) return checked;
  return { ok: true, url: checked.url };
}

export async function fetchProductPicture(
  raw: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; bytes: Uint8Array; mime: ProductImageMime } | { ok: false; reason: string }> {
  const url = readableImageUrl(raw);
  if (!url.ok) return url;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetchImpl(url.url, { signal: controller.signal, credentials: "omit", redirect: "follow" });
    if (!response.ok) return { ok: false, reason: "That picture could not be fetched." };
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > MAX_BYTES) return { ok: false, reason: "That picture is over 1.5 MB." };
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_BYTES) return { ok: false, reason: "That picture is over 1.5 MB." };
    const mime = imageMagic(bytes);
    if (!mime) return { ok: false, reason: "The link did not return a JPEG, PNG, or WebP." };
    return { ok: true, bytes, mime };
  } catch {
    return { ok: false, reason: "The picture link did not answer." };
  } finally {
    clearTimeout(timer);
  }
}
