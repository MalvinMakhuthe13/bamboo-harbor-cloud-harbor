import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { defaultSizes } from "@/lib/tryon/catalog";
import type { Category, Material, SizeRow } from "@/lib/tryon/types";

export type ShopRead = {
  id: string;
  name: string;
  category: Category;
  material: Material;
  color: string;
  blurb: string;
  image: string | null;
  priceZar: number | null;
  sourceUrl: string;
  sizes: SizeRow[];
  host: string;
};

const LABELS = ["XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL"];

export const readShopLink = createServerFn({ method: "POST" })
  .validator(z.object({ url: z.string().min(4).max(2000) }))
  .handler(async ({ data }): Promise<ShopRead> => {
    const page = await pullHtml(data.url);
    return readProduct(page.finalUrl, page.html);
  });

function readProduct(finalUrl: string, html: string): ShopRead {
  const ld = productLd(html);
  const title = cleanTitle(
    asString(ld?.name) || meta(html, "og:title") || titleTag(html) || "Shop piece",
  );
  const description = asString(ld?.description) || meta(html, "og:description") || "";
  const image = httpsUrl(firstImage(ld) || meta(html, "og:image"));
  const price = priceOf(ld, meta(html, "og:price:amount"));
  const host = new URL(finalUrl).host.replace(/^www\./, "");
  const blob = `${title} ${description} ${finalUrl}`;
  const category = inferCategory(blob);
  if (!category) {
    throw new Error("That page does not look like a shirt, pair of trousers, or other wearable.");
  }
  const decoded = decodeEscapes(html);
  const chest = rangesAfter(decoded, "CHEST");
  const waist = rangesAfter(decoded, "WAIST");
  const hip = rangesAfter(decoded, "HIP");
  const sizes = rowsFor(category, chest, waist, hip);
  const material = inferMaterial(blob, category);
  return {
    id: idFromUrl(finalUrl),
    name: title.slice(0, 80),
    category,
    material,
    color: colorFrom(blob, category),
    blurb: blurbFor(host, description, sizes.length > 0 && (chest.length > 0 || waist.length > 0)),
    image,
    priceZar: price,
    sourceUrl: finalUrl,
    sizes,
    host,
  };
}

async function pullHtml(raw: string): Promise<{ finalUrl: string; html: string }> {
  let current = normalise(raw);
  for (let hop = 0; hop < 4; hop++) {
    assertPublic(current);
    const res = await fetch(current, {
      redirect: "manual",
      headers: {
        accept: "text/html",
        "user-agent": "Isibuko/1.0 (try-on; product title only)",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error("The shop redirected without a destination.");
      current = new URL(loc, current).toString();
      continue;
    }
    if (!res.ok) throw new Error(`The shop returned ${res.status}.`);
    const type = res.headers.get("content-type") ?? "";
    if (!/html|xml|text/i.test(type)) throw new Error("That link is not a product page.");
    const buf = await res.arrayBuffer();
    if (buf.byteLength > 2_000_000) throw new Error("That page is too large to read.");
    return { finalUrl: current, html: new TextDecoder().decode(buf) };
  }
  throw new Error("The shop redirected too many times.");
}

function normalise(raw: string): string {
  const trimmed = raw.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error("Paste a full product link.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("The link has to be http or https.");
  if (url.port && url.port !== "80" && url.port !== "443") throw new Error("That link uses a port we will not open.");
  return url.toString();
}

function assertPublic(raw: string) {
  const host = new URL(raw).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host === "169.254.169.254"
  ) {
    throw new Error("That link points at a private address.");
  }
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return;
  const n = ipv4.slice(1).map(Number);
  if (n.some((part) => part > 255)) throw new Error("That link is not a public page.");
  const [a, b] = n;
  if (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    a === 0
  ) {
    throw new Error("That link points at a private address.");
  }
}

function productLd(html: string): Record<string, unknown> | null {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    try {
      const data = JSON.parse(match[1]) as unknown;
      const nodes = Array.isArray(data)
        ? data
        : data && typeof data === "object" && Array.isArray((data as { "@graph"?: unknown })["@graph"])
          ? ((data as { "@graph": unknown[] })["@graph"])
          : [data];
      for (const node of nodes) {
        if (!node || typeof node !== "object") continue;
        const kind = (node as { "@type"?: unknown })["@type"];
        const types = Array.isArray(kind) ? kind : [kind];
        if (types.includes("Product")) return node as Record<string, unknown>;
      }
    } catch {
      /* a shop can ship broken JSON-LD; the meta tags still work */
    }
  }
  return null;
}

function meta(html: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["']`,
    "i",
  );
  const match = html.match(re);
  const value = match?.[1] || match?.[2];
  return value ? decodeBasic(value) : null;
}

function titleTag(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match ? decodeBasic(match[1]).trim() : null;
}

function firstImage(ld: Record<string, unknown> | null): string | null {
  const image = ld?.image;
  if (typeof image === "string") return image;
  if (Array.isArray(image) && typeof image[0] === "string") return image[0];
  if (image && typeof image === "object" && typeof (image as { url?: unknown }).url === "string") {
    return (image as { url: string }).url;
  }
  return null;
}

function priceOf(ld: Record<string, unknown> | null, og: string | null): number | null {
  const offers = ld?.offers;
  const offer = Array.isArray(offers) ? offers[0] : offers;
  const raw =
    offer && typeof offer === "object" && "price" in offer ? (offer as { price?: unknown }).price : og;
  const num = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.replace(/[^\d.]/g, "")) : Number.NaN;
  if (!Number.isFinite(num) || num <= 0 || num > 1_000_000) return null;
  return Math.round(num);
}

function inferCategory(text: string): Category | null {
  const t = text.toLowerCase();
  if (/earring/.test(t)) return "earrings";
  if (/necklace|pendant|\bchain\b/.test(t)) return "necklace";
  if (/sunglass|glasses|optical|spectacle/.test(t)) return "glasses";
  if (/\bwatch\b/.test(t)) return "watch";
  if (/\bring\b/.test(t)) return "ring";
  if (/nail polish|press-on|manicure/.test(t)) return "nails";
  if (/\bwig\b|hairpiece|lace front/.test(t)) return "wig";
  if (/\bhat\b|\bcap\b|beanie|beret/.test(t)) return "hat";
  if (/trouser|chino|\bjean|pant\b|shorts/.test(t)) return "pants";
  if (/shirt|t-shirt|\btee\b|blouse|\btop\b|hoodie|polo|knitwear|jersey/.test(t)) return "shirt";
  return null;
}

function inferMaterial(text: string, category: Category): Material {
  const t = text.toLowerCase();
  if (category === "shirt" || category === "pants" || category === "hat") {
    if (/satin|silk/.test(t)) return "satin";
    return "cotton";
  }
  if (category === "wig") return /curl|afro|coil/.test(t) ? "curly" : "silky";
  if (category === "nails") return "gloss";
  return "metal";
}

function colorFrom(text: string, category: Category): string {
  const t = text.toLowerCase();
  const pairs: [RegExp, string][] = [
    [/white|ivory|cream/, "#f3efe6"],
    [/black/, "#1c1917"],
    [/navy|indigo/, "#1e2a44"],
    [/olive|khaki/, "#5c6842"],
    [/green/, "#2f4f3e"],
    [/burgundy|maroon|wine/, "#8f3040"],
    [/red/, "#8d3a32"],
    [/pink|blush/, "#e4b7b2"],
    [/grey|gray|stone|charcoal/, "#8a8680"],
    [/brown|tan|camel|beige|oatmeal|sand|linen/, "#c4a882"],
    [/blue/, "#3d5a80"],
    [/yellow|mustard/, "#d4b483"],
  ];
  for (const [re, color] of pairs) if (re.test(t)) return color;
  return category === "pants" ? "#2a2622" : "#e7d7c3";
}

function rowsFor(category: Category, chest: [number, number][], waist: [number, number][], hip: [number, number][]): SizeRow[] {
  if (category === "shirt" && chest.length >= 2) {
    return chest.map((range, i) => ({ label: LABELS[i] ?? `${i + 1}`, chest: range }));
  }
  if (category === "pants" && (waist.length >= 2 || hip.length >= 2)) {
    const n = Math.max(waist.length, hip.length);
    return Array.from({ length: n }, (_, i) => ({
      label: LABELS[i] ?? `${i + 1}`,
      waist: waist[i],
      hip: hip[i],
    }));
  }
  return defaultSizes(category);
}

function rangesAfter(text: string, label: string): [number, number][] {
  const at = text.toUpperCase().indexOf(label);
  if (at < 0) return [];
  const slice = text.slice(at, at + 900);
  const out: [number, number][] = [];
  const re = /(\d{2,3}(?:\.\d)?)\s*[-–]\s*(\d{2,3}(?:\.\d)?)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(slice)) && out.length < 8) {
    const a = Number(match[1]);
    const b = Number(match[2]);
    if (b > a && a >= 40 && b <= 170) out.push([a, b]);
  }
  return out;
}

function blurbFor(host: string, description: string, hadChart: boolean): string {
  const sentence = description.replace(/\s+/g, " ").trim().slice(0, 140);
  const chart = hadChart ? " The size chart on the page is the one being worn." : " No size chart was on the page, so a standard chart is used.";
  const lead = sentence ? `${sentence}${sentence.endsWith(".") ? "" : "."}` : `From ${host}.`;
  return `${lead} Folds follow the body. Ease comes from the size you pick.${chart}`;
}

function cleanTitle(title: string): string {
  return decodeBasic(title)
    .replace(/\s+[|–-]\s+Superbalist.*$/i, "")
    .replace(/\s+-\s+\d{6,}$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function idFromUrl(url: string): string {
  let hash = 0;
  for (const char of url) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `shop-${hash.toString(16)}`;
}

function httpsUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function decodeBasic(value: string): string {
  return value
    .replace(/&/g, "&")
    .replace(/"/g, '"')
    .replace(/&#39;|'/g, "'")
    .replace(/</g, "<")
    .replace(/>/g, ">");
}

function decodeEscapes(html: string): string {
  return html.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
}
