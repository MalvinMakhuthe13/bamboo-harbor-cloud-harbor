import type { Category, Material, Product, SizeRow } from "@/lib/tryon/types";

const wigSizes: SizeRow[] = [
  { label: "Petite", head: [51, 54] },
  { label: "Average", head: [54, 57] },
  { label: "Large", head: [57, 60] },
];

const slimSizes: SizeRow[] = [
  { label: "S", chest: [78, 84], waist: [62, 70], shoulder: [37, 41] },
  { label: "M", chest: [84, 90], waist: [70, 76], shoulder: [41, 44] },
  { label: "L", chest: [90, 96], waist: [76, 84], shoulder: [44, 47] },
  { label: "XL", chest: [96, 102], waist: [84, 92], shoulder: [47, 50] },
];

const boxySizes: SizeRow[] = [
  { label: "S", chest: [96, 108], waist: [90, 102], shoulder: [46, 52] },
  { label: "M", chest: [108, 118], waist: [102, 114], shoulder: [52, 56] },
  { label: "L", chest: [118, 128], waist: [114, 126], shoulder: [56, 60] },
  { label: "XL", chest: [128, 140], waist: [126, 138], shoulder: [60, 64] },
];

const shirtSizes: SizeRow[] = [
  { label: "S", chest: [82, 90], waist: [66, 74], shoulder: [38, 42] },
  { label: "M", chest: [90, 98], waist: [74, 82], shoulder: [42, 45] },
  { label: "L", chest: [98, 106], waist: [82, 92], shoulder: [45, 48] },
  { label: "XL", chest: [106, 116], waist: [92, 104], shoulder: [48, 52] },
];

const pantSizes: SizeRow[] = [
  { label: "S", waist: [66, 74], hip: [88, 96] },
  { label: "M", waist: [74, 82], hip: [96, 104] },
  { label: "L", waist: [82, 92], hip: [104, 112] },
  { label: "XL", waist: [92, 104], hip: [112, 122] },
];

const watchSizes: SizeRow[] = [
  { label: "S", wrist: [13, 15.5] },
  { label: "M", wrist: [15.5, 17.5] },
  { label: "L", wrist: [17.5, 20] },
];

const glassSizes: SizeRow[] = [
  { label: "Narrow", face: [11.5, 13] },
  { label: "Medium", face: [13, 14.4] },
  { label: "Wide", face: [14.4, 16.2] },
];

const ringSizes: SizeRow[] = [
  { label: "P", finger: [1.45, 1.6] },
  { label: "R", finger: [1.6, 1.75] },
  { label: "T", finger: [1.75, 1.95] },
];

export const CATEGORY_ORDER: Category[] = [
  "wig",
  "hat",
  "nails",
  "glasses",
  "earrings",
  "necklace",
  "ring",
  "watch",
  "shirt",
  "pants",
];

export const CATEGORY_LABEL: Record<Category, string> = {
  wig: "Wig",
  hat: "Hat",
  nails: "Nails",
  glasses: "Glasses",
  earrings: "Earrings",
  necklace: "Necklace",
  ring: "Ring",
  watch: "Watch",
  shirt: "Shirt",
  pants: "Pants",
};

export const MATERIAL_LABEL: Record<Material, string> = {
  silky: "Silky hair",
  curly: "Curly hair",
  cotton: "Cotton",
  satin: "Satin",
  metal: "Metal",
  gloss: "Gloss",
};

export function defaultSizes(category: Category): SizeRow[] {
  if (category === "wig" || category === "hat") return wigSizes.map(cloneRow);
  if (category === "shirt") return shirtSizes.map(cloneRow);
  if (category === "pants") return pantSizes.map(cloneRow);
  if (category === "watch") return watchSizes.map(cloneRow);
  if (category === "glasses") return glassSizes.map(cloneRow);
  if (category === "ring") return ringSizes.map(cloneRow);
  return [];
}

export function primaryMeasure(category: Category): keyof SizeRow | null {
  if (category === "wig" || category === "hat") return "head";
  if (category === "shirt") return "chest";
  if (category === "pants") return "waist";
  if (category === "watch") return "wrist";
  if (category === "ring") return "finger";
  if (category === "glasses") return "face";
  return null;
}

export const DEFAULT_PRODUCTS: Product[] = [
  {
    id: "wig-straight",
    name: "Long straight",
    category: "wig",
    material: "silky",
    color: "#1a1210",
    style: "straight",
    image: "/look/wig-straight.jpg",
    blurb: "A long straight photograph. Tap it and the hair is put onto the shopper. The face stays.",
    sizes: wigSizes,
  },
  {
    id: "wig-bob",
    name: "Blunt bob",
    category: "wig",
    material: "silky",
    color: "#2a160f",
    style: "bob",
    image: "/look/wig-bob.jpg",
    blurb: "Jaw-length bob. The photograph replaces the hair, not the face.",
    sizes: wigSizes,
  },
  {
    id: "wig-braids",
    name: "Box braids",
    category: "wig",
    material: "curly",
    color: "#140e0c",
    style: "braids",
    image: "/look/wig-braids.jpg",
    blurb: "Box braids as a photograph. They replace the hair and leave the face.",
    sizes: wigSizes,
  },
  {
    id: "hat-beret",
    name: "Cotton cap",
    category: "hat",
    material: "cotton",
    color: "#c2ad8a",
    image: "/look/hat-cap.jpg",
    blurb: "A cotton cap. Tap it and it sits on the head in the photograph.",
    sizes: wigSizes,
  },
  {
    id: "nails-french",
    name: "French almond",
    category: "nails",
    material: "gloss",
    color: "#f4ece4",
    nailShape: "almond",
    image: "/look/nails-french.jpg",
    blurb: "French almond nails. Only the fingernails change.",
    sizes: [],
  },
  {
    id: "nails-wine",
    name: "Wine square",
    category: "nails",
    material: "gloss",
    color: "#6e2430",
    nailShape: "square",
    image: "/look/nails-wine.jpg",
    blurb: "Wine square nails, taken from the photograph of the hand.",
    sizes: [],
  },
  {
    id: "nails-stiletto",
    name: "Chrome stiletto",
    category: "nails",
    material: "metal",
    color: "#d5d0c8",
    nailShape: "stiletto",
    image: "/look/nails-stiletto.jpg",
    blurb: "Chrome stilettos. The manicure is copied onto the shopper's nails.",
    sizes: [],
  },
  {
    id: "glasses-round",
    name: "Round wire",
    category: "glasses",
    material: "metal",
    color: "#c4a574",
    image: "/look/glasses-round.jpg",
    blurb: "Round wire glasses, placed on the eyes in the photograph.",
    sizes: glassSizes,
  },
  {
    id: "glasses-cateye",
    name: "Cat-eye",
    category: "glasses",
    material: "gloss",
    color: "#1c1614",
    blurb: "Same head lock as the round pair. The outer corner lifts.",
    sizes: glassSizes,
  },
  {
    id: "earrings-drop",
    name: "Drop earrings",
    category: "earrings",
    material: "metal",
    color: "#c4a574",
    blurb: "Hung at the ear and given a short pendulum so they trail a fast head turn.",
    sizes: [],
  },
  {
    id: "necklace-chain",
    name: "Fine chain",
    category: "necklace",
    material: "metal",
    color: "#e0c48a",
    blurb: "A short chain off the neck. Pinch grabs a bead; letting go drops it back to the collarbone.",
    sizes: [],
  },
  {
    id: "ring-signet",
    name: "Signet ring",
    category: "ring",
    material: "metal",
    color: "#c4a574",
    blurb: "Sits on the index finger. The size letter is an estimate from finger breadth, not a jeweller's mandrel.",
    sizes: ringSizes,
  },
  {
    id: "watch-round",
    name: "Round watch",
    category: "watch",
    material: "metal",
    color: "#1c1816",
    blurb: "Strap follows the wrist. Circumference is estimated from palm breadth.",
    sizes: watchSizes,
  },
  {
    id: "shirt-linen",
    name: "Linen shirt",
    category: "shirt",
    material: "cotton",
    color: "#e7d7c3",
    blurb: "Regular cut. The side seams sit a few centimetres off the body, and the folds follow the turn.",
    priceZar: 749,
    image: "/rail/linen.jpg",
    sizes: shirtSizes,
  },
  {
    id: "shirt-slim",
    name: "Slim poplin",
    category: "shirt",
    material: "cotton",
    color: "#f4f1ea",
    blurb: "Cut close. If the chest is under the size, the cloth goes taut and the folds almost disappear.",
    priceZar: 649,
    sizes: slimSizes,
  },
  {
    id: "shirt-boxy",
    name: "Oversized tee",
    category: "shirt",
    material: "cotton",
    color: "#b7b2aa",
    blurb: "A lot of ease. The hem hangs, the side seams flare, and a pinch pulls one fold instead of the whole shirt.",
    priceZar: 399,
    image: "/rail/tee.jpg",
    sizes: boxySizes,
  },
  {
    id: "shirt-satin",
    name: "Satin shirt",
    category: "shirt",
    material: "satin",
    color: "#8f3040",
    blurb: "Same torso as the linen shirt, with a smaller fold. Satin does not rumple the way cotton does.",
    priceZar: 899,
    image: "/rail/satin.jpg",
    sizes: shirtSizes,
  },
  {
    id: "pants-tailored",
    name: "Tailored trousers",
    category: "pants",
    material: "cotton",
    color: "#2a2622",
    blurb: "The leg follows hip, knee and ankle. A bent knee creases. The thigh width is the hip ease, not a fixed tube.",
    priceZar: 1299,
    image: "/rail/trousers.jpg",
    sizes: pantSizes,
  },
];

export function findProduct(products: Product[], id: string | undefined): Product {
  return products.find((p) => p.id === id) ?? products[0] ?? DEFAULT_PRODUCTS[0];
}

function cloneRow(row: SizeRow): SizeRow {
  return {
    label: row.label,
    chest: row.chest ? [row.chest[0], row.chest[1]] : undefined,
    waist: row.waist ? [row.waist[0], row.waist[1]] : undefined,
    shoulder: row.shoulder ? [row.shoulder[0], row.shoulder[1]] : undefined,
    head: row.head ? [row.head[0], row.head[1]] : undefined,
    wrist: row.wrist ? [row.wrist[0], row.wrist[1]] : undefined,
    finger: row.finger ? [row.finger[0], row.finger[1]] : undefined,
    face: row.face ? [row.face[0], row.face[1]] : undefined,
    hip: row.hip ? [row.hip[0], row.hip[1]] : undefined,
  };
}
