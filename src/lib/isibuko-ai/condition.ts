import type { Category, Product } from "./types.ts";

export type ProductCondition = {
  productId: string;
  name: string;
  category: Category;
  image: string | null;
  tint: [number, number, number] | null;
  /** How the mirror is allowed to place this photograph. Not a cloth simulation. */
  cut: "sleeved" | "sleeveless-torso" | "skirt" | "trousers" | "hair" | "face" | "head" | "wrist" | "finger" | "nails" | "neck";
  photographIsNotAMeasurement: true;
  missing: string[];
};

const MISSING = [
  "The photograph is not a garment measurement.",
  "There is no side or back view unless the merchant supplied one.",
  "Cloth is not simulated. The photograph is fitted to the tracked body.",
];

export function conditionProduct(product: Product, tint: [number, number, number] | null): ProductCondition {
  const cut = cutFor(product);
  const missing = [...MISSING];
  if (!product.image && product.category !== "nails") missing.push("This piece has no photograph, so only a colour can be applied.");
  if (!product.sizes.length) missing.push("No size chart was supplied.");
  if (product.category === "wig") missing.push("The wig is a plate on the head. It does not grow a new hair silhouette.");
  if (product.category === "skirt" || product.category === "pants") missing.push("The legs must be in frame. A chest-up picture cannot show this piece.");
  if (product.category === "bracelet" || product.category === "watch" || product.category === "ring") {
    missing.push("The wrist or hand must be visible.");
  }
  if (product.category === "nails" && product.nailSite === "toes") {
    missing.push("Only the foot-index point is tracked. The other four toenail plates are a spacing estimate, not detected toes.");
  } else if (product.category === "nails") {
    missing.push("Each fingernail follows a hand landmark. The hand must be visible.");
  }
  return {
    productId: product.id,
    name: product.name,
    category: product.category,
    image: product.image,
    tint,
    cut,
    photographIsNotAMeasurement: true,
    missing,
  };
}

function cutFor(product: Product): ProductCondition["cut"] {
  const category = product.category;
  if (category === "shirt" || category === "jacket") {
    return product.sleeve === "sleeveless" ? "sleeveless-torso" : "sleeved";
  }
  if (category === "dress") {
    return product.sleeve === "short" || product.sleeve === "long" ? "sleeved" : "sleeveless-torso";
  }
  if (category === "skirt") return "skirt";
  if (category === "pants") return "trousers";
  if (category === "wig") return "hair";
  if (category === "glasses") return "face";
  if (category === "hat") return "head";
  if (category === "bracelet" || category === "watch") return "wrist";
  if (category === "ring") return "finger";
  if (category === "nails") return "nails";
  return "neck";
}
