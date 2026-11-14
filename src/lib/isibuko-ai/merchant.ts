import { publicHttpUrl, assertProductImage, dataUrlMime, parseProductDataUrl } from "./privacy.ts";
import { validateProductFittingAnchors } from "./anchors.ts";
import type {
  Category,
  Product,
  ProductAnchorPoint,
  ProductFittingAnchors,
  SizeRow,
  Swatch,
} from "./types.ts";

export const CUSTOM_CAP = 24;

const shirt: SizeRow[] = [
  { label: "S", chest: [82, 90], waist: [66, 74], shoulder: [38, 42] },
  { label: "M", chest: [90, 98], waist: [74, 82], shoulder: [42, 45] },
  { label: "L", chest: [98, 106], waist: [82, 92], shoulder: [45, 48] },
];

const lower: SizeRow[] = [
  { label: "S", waist: [66, 74], hip: [88, 96] },
  { label: "M", waist: [74, 82], hip: [96, 104] },
  { label: "L", waist: [82, 92], hip: [104, 112] },
];

export function sizeChart(category: Category): SizeRow[] {
  if (category === "pants" || category === "skirt") return lower.map((row) => ({ ...row }));
  if (category === "shirt" || category === "jacket" || category === "dress")
    return shirt.map((row) => ({ ...row }));
  if (category === "wig" || category === "hat") return [{ label: "Average", head: [54, 57] }];
  if (category === "glasses") return [{ label: "Medium", face: [13, 14.4] }];
  if (category === "watch" || category === "bracelet") return [{ label: "M", wrist: [15.5, 17.5] }];
  if (category === "ring") return [{ label: "R", finger: [1.6, 1.75] }];
  return [];
}

export function hexTint(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match?.[1]) return null;
  const n = Number.parseInt(match[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function tintToHex(tint: [number, number, number] | null | undefined): string {
  if (!tint) return "";
  const byte = (value: number) =>
    Math.round(Math.min(1, Math.max(0, value)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${byte(tint[0])}${byte(tint[1])}${byte(tint[2])}`;
}

export type ProductDraft = {
  name: string;
  category: Category;
  priceZar?: number | null;
  fabric: string;
  colourName: string;
  colourHex: string;
  merchantUrl: string;
  /** Optional. Stored only. There is no checkout. */
  purchaseUrl?: string;
  image: string | null;
  imageType: string | null;
  imageBytes: number;
  fittingAnchors?: ProductFittingAnchors | null;
  /** Stated cut. Not read from the photograph. */
  sleeve?: "sleeveless" | "short" | "long";
  neckline?: "closed" | "open" | "strapless";
};

export function canAddCustom(count: number, replacing: boolean): boolean {
  return replacing || count < CUSTOM_CAP;
}

export function buildCustomProduct(
  draft: ProductDraft,
  id: string,
): { ok: true; product: Product } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const name = draft.name.trim();
  if (name.length < 2) errors.push("Name the piece.");
  if (
    draft.priceZar !== undefined &&
    draft.priceZar !== null &&
    (!Number.isFinite(draft.priceZar) || draft.priceZar < 0 || draft.priceZar > 1_000_000)
  ) {
    errors.push("Price must be a rand amount.");
  }
  if (draft.image) {
    const declaredType = (draft.imageType ?? "").toLowerCase();
    const image = assertProductImage({ type: declaredType, size: draft.imageBytes });
    if (!image.ok) errors.push(image.reason);
    const urlMime = dataUrlMime(draft.image);
    if (!urlMime) {
      errors.push("The photograph must stay a local JPEG, PNG, or WebP.");
    } else if (declaredType && urlMime !== declaredType) {
      errors.push(`The photograph MIME type (${urlMime}) does not match ${declaredType}.`);
    }
  } else if (draft.category !== "nails") {
    errors.push("Add a photograph. A name alone is not a garment.");
  }
  if (draft.purchaseUrl?.trim()) {
    const purchase = publicHttpUrl(draft.purchaseUrl);
    if (!purchase.ok) errors.push(purchase.reason.replace("merchant link", "purchase link"));
  }
  let merchantUrl: string | undefined;
  if (draft.merchantUrl.trim()) {
    const link = publicHttpUrl(draft.merchantUrl);
    if (!link.ok) errors.push(link.reason);
    else merchantUrl = link.url;
  }
  const swatches: Swatch[] = [{ id: "natural", name: "As photographed", tint: null }];
  if (draft.colourHex.trim() || draft.colourName.trim()) {
    const tint = hexTint(draft.colourHex);
    if (!tint) errors.push("Colour must be a 6-digit hex, such as #1c1a17.");
    else swatches.push({ id: "colour", name: draft.colourName.trim() || "Colour", tint });
  }
  if (errors.length) return { ok: false, errors };
  const fabric = draft.fabric.trim();
  const validAnchors =
    draft.fittingAnchors && validateProductFittingAnchors(draft.fittingAnchors)
      ? draft.fittingAnchors
      : undefined;
  const priceZar =
    draft.priceZar !== undefined && draft.priceZar !== null
      ? Math.round(draft.priceZar)
      : undefined;
  const originNote = priceZar !== undefined ? "Added in the studio." : "Added locally.";
  return {
    ok: true,
    product: {
      id,
      name,
      category: draft.category,
      blurb: fabric
        ? `${fabric}. ${originNote} The photograph is not a measurement.`
        : `${originNote} The photograph is not a measurement.`,
      image: draft.image,
      ...(priceZar !== undefined ? { priceZar } : {}),
      sizes: sizeChart(draft.category),
      swatches,
      nail: "almond",
      custom: true,
      merchantUrl,
      purchaseUrl: statedPurchase(draft),
      fabric: fabric || undefined,
      fittingAnchors: validAnchors,
      ...(statedSleeve(draft) ? { sleeve: statedSleeve(draft) } : {}),
      ...(statedNeckline(draft) ? { neckline: statedNeckline(draft) } : {}),
    },
  };
}

function statedPurchase(draft: ProductDraft): string | undefined {
  const raw = draft.purchaseUrl?.trim() ?? "";
  if (!raw) return undefined;
  const link = publicHttpUrl(raw);
  return link.ok ? link.url : undefined;
}

function statedSleeve(draft: ProductDraft): Product["sleeve"] {
  if (draft.category !== "shirt" && draft.category !== "jacket" && draft.category !== "dress") return undefined;
  if (draft.sleeve === "sleeveless" || draft.sleeve === "short" || draft.sleeve === "long") return draft.sleeve;
  return undefined;
}

function statedNeckline(draft: ProductDraft): Product["neckline"] {
  if (draft.category !== "shirt" && draft.category !== "jacket" && draft.category !== "dress") return undefined;
  if (draft.neckline === "closed" || draft.neckline === "open" || draft.neckline === "strapless") return draft.neckline;
  return undefined;
}

function cloneFittingAnchors(
  anchors: ProductFittingAnchors | undefined,
): ProductFittingAnchors | null {
  if (!anchors || !validateProductFittingAnchors(anchors)) return null;
  const points: Record<string, ProductAnchorPoint> | undefined = anchors.points
    ? Object.fromEntries(
        Object.entries(anchors.points).map(([key, pt]) => [
          key,
          {
            x: pt.x,
            y: pt.y,
            ...(pt.confidence !== undefined ? { confidence: pt.confidence } : {}),
          },
        ]),
      )
    : undefined;
  return {
    version: "isibuko.anchors/1",
    ...(points ? { points } : {}),
    ...(anchors.parameters ? { parameters: { ...anchors.parameters } } : {}),
  };
}

export function productToEditDraft(product: Product): ProductDraft & {
  priceZar: number | null;
  fittingAnchors: ProductFittingAnchors | null;
} {
  let imageType: string | null = null;
  let imageBytes = 0;
  if (product.image) {
    const parsed = parseProductDataUrl(product.image);
    if (parsed.ok) {
      imageType = parsed.mime;
      imageBytes = parsed.size;
    } else {
      imageType = dataUrlMime(product.image);
      imageBytes = 0;
    }
  }
  return {
    name: product.name,
    category: product.category,
    priceZar: product.priceZar ?? null,
    fabric: product.fabric ?? "",
    colourName: product.swatches[1]?.name ?? "",
    colourHex: tintToHex(product.swatches[1]?.tint),
    merchantUrl: product.merchantUrl ?? "",
    purchaseUrl: product.purchaseUrl ?? "",
    image: product.image,
    imageType,
    imageBytes,
    fittingAnchors: cloneFittingAnchors(product.fittingAnchors),
    sleeve: product.sleeve,
    neckline: product.neckline,
  };
}
