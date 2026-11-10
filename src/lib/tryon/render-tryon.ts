import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Category } from "@/lib/tryon/types";

const CATEGORIES = [
  "wig",
  "hat",
  "nails",
  "glasses",
  "earrings",
  "necklace",
  "watch",
  "ring",
  "shirt",
  "pants",
] as const satisfies readonly Category[];

const dataUrl = z
  .string()
  .max(1_800_000)
  .refine((value) => /^data:image\/(?:jpeg|jpg|png|webp);base64,[a-z0-9+/=\s]+$/i.test(value), {
    message: "The picture has to be a photo.",
  });

const cache = new Map<string, string>();
const hits: number[] = [];
const WINDOW_MS = 10 * 60 * 1000;
const MAX_CALLS = 12;

export type TryOnPicture =
  | { ok: true; image: string }
  | { ok: false; error: string };

export const renderTryOn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      person: dataUrl,
      productName: z.string().trim().min(1).max(80),
      category: z.enum(CATEGORIES),
      productData: dataUrl.optional(),
      productUrl: z.string().max(2000).optional(),
    }),
  )
  .handler(async ({ data }): Promise<TryOnPicture> => {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false, error: "Photographs cannot be made in this preview yet." };

    const productRef = data.productData ?? publicProductUrl(data.productUrl);
    if (!productRef) return { ok: false, error: "That piece has no photograph." };

    const key = await digest(data.category + "\0" + data.productName + "\0" + data.person + "\0" + productRef);
    const cached = cache.get(key);
    if (cached) return { ok: true, image: cached };

    if (!allowCall()) {
      return { ok: false, error: "Too many photographs in a short time. Wait a few minutes and try one piece." };
    }

    const prompt = promptFor(data.category, data.productName);
    const made = await editOnce(apiKey, prompt, data.person, productRef);
    if (!made.ok) return made;
    cache.set(key, made.image);
    if (cache.size > 24) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }
    return made;
  });

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

function allowCall(): boolean {
  const now = Date.now();
  while (hits.length > 0 && now - hits[0] > WINDOW_MS) hits.shift();
  if (hits.length >= MAX_CALLS) return false;
  hits.push(now);
  return true;
}

function publicProductUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "0.0.0.0" ||
    host === "169.254.169.254"
  ) {
    return null;
  }
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const n = ipv4.slice(1).map(Number);
    const [a, b] = n;
    if (n.some((part) => part > 255)) return null;
    if (a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)) {
      return null;
    }
  }
  return url.toString();
}

function promptFor(category: Category, name: string): string {
  const job: Record<Category, string> = {
    wig: "Replace only the shopper's hair with that wig. The hairline sits on the scalp. Keep the face, ears, skin and identity.",
    hat: "Put that hat on the shopper's head. Keep the face and the clothes.",
    nails: "Change only the fingernails so they match that manicure. Keep the hands, skin and everything else.",
    glasses: "Put those glasses on the face, lined up with the eyes. Change nothing else.",
    earrings: "Add those earrings to the ears. Change nothing else.",
    necklace: "Add that necklace. Change nothing else.",
    ring: "Add that ring on a visible finger. Change nothing else.",
    watch: "Put that watch on a wrist. Change nothing else.",
    shirt: "Replace the top with that garment. Wrinkles follow the body. Keep the face, hair, pose and background.",
    pants: "Replace the trousers with that pair. Keep the top, face and pose.",
  };
  return `The first image is a real shopper. The second image is a product photograph of ${name}. ${job[category]} Photoreal photograph, not a cartoon, not a 3D render, not an illustration. No text, no logo, no extra people.`;
}

async function editOnce(apiKey: string, prompt: string, person: string, product: string): Promise<TryOnPicture> {
  const models = ["grok-imagine-image", "grok-imagine-image-2.0"];
  let last = "The photograph could not be made.";
  for (const model of models) {
    const res = await fetch("https://api.x.ai/v1/images/edits", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        prompt,
        images: [
          { type: "image_url", url: person },
          { type: "image_url", url: product },
        ],
        aspect_ratio: "3:4",
        response_format: "b64_json",
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (res.ok) return readImage(await res.json());
    const detail = (await res.text()).slice(0, 240);
    last = `The photograph could not be made (${res.status}).`;
    const modelRejected = res.status === 400 || res.status === 404;
    if (!modelRejected || !/model/i.test(detail)) break;
  }
  return { ok: false, error: last };
}

function readImage(body: unknown): TryOnPicture {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const data = Array.isArray(record.data) ? record.data[0] : record;
  const item = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const b64 = typeof item.b64_json === "string" ? item.b64_json : "";
  const url = typeof item.url === "string" ? item.url : "";
  if (b64) return { ok: true, image: `data:image/jpeg;base64,${b64}` };
  if (url.startsWith("https://")) return { ok: true, image: url };
  return { ok: false, error: "The photograph came back empty." };
}
