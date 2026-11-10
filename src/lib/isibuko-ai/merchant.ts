import { publicHttpUrl, assertProductImage } from "./privacy.ts";
import type { Category, Product, SizeRow, Swatch } from "./types.ts";

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
  if (category === "shirt" || category === "jacket" || category === "dress") return shirt.map((row) => ({ ...row }));
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
  const byte = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 255).toString(16).padStart(2, "0");
  return `#${byte(tint[0])}${byte(tint[1])}${byte(tint[2])}`;
}

export type ProductDraft = {
  name: string;
  category: Category;
  priceZar: number;
  fabric: string;
  colourName: string;
  colourHex: string;
  merchantUrl: string;
  image: string | null;
  imageType: string | null;
  imageBytes: number;
};

export function canAddCustom(count: number, replacing: boolean): boolean {
  return replacing || count < CUSTOM_CAP;
}

export function buildCustomProduct(draft: ProductDraft, id: string): { ok: true; product: Product } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const name = draft.name.trim();
  if (name.length < 2) errors.push("Name the piece.");
  if (!Number.isFinite(draft.priceZar) || draft.priceZar < 0 || draft.priceZar > 1_000_000) errors.push("Price must be a rand amount.");
  if (draft.image) {
    const image = assertProductImage({ type: draft.imageType ?? "", size: draft.imageBytes });
    if (!image.ok) errors.push(image.reason);
    if (!draft.image.startsWith("data:image/jpeg") && !draft.image.startsWith("data:image/png") && !draft.image.startsWith("data:image/webp")) {
      errors.push("The photograph must stay a local JPEG, PNG, or WebP.");
    }
  } else if (draft.category !== "nails") {
    errors.push("Add a photograph. A name alone is not a garment.");
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
  return {
    ok: true,
    product: {
      id,
      name,
      category: draft.category,
      blurb: fabric ? `${fabric}. Added in the studio. The photograph is not a measurement.` : "Added in the studio. The photograph is not a measurement.",
      image: draft.image,
      priceZar: Math.round(draft.priceZar),
      sizes: sizeChart(draft.category),
      swatches,
      nail: "almond",
      custom: true,
      merchantUrl,
      fabric: fabric || undefined,
    },
  };
}
