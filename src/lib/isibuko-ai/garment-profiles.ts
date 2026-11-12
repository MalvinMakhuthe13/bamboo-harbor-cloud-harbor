import type { Category } from "@/lib/isibuko-ai/types";

export type FitFamily = "upper-garment" | "full-body-garment" | "lower-garment" | "headwear" | "face-accessory" | "jewellery" | "hand-accessory" | "nail";
export type GeometryStrategy = "torso-panels" | "full-body-panels" | "leg-panels" | "skirt-panels" | "head-pose-sprite" | "face-landmark-sprite" | "landmark-sprite" | "hand-landmark-sprite" | "nail-surface";

export type GarmentFitProfile = {
  category: Category;
  family: FitFamily;
  geometry: GeometryStrategy;
  requiredAnchors: readonly string[];
  optionalAnchors: readonly string[];
  segmentation: "required" | "preferred" | "not-required";
  /** Whether this product family has sleeves as a physical garment feature. */
  sleeves: "yes" | "no" | "product-dependent";
};

/**
 * Single source of truth for Isibuko's category-to-fitting contract.
 *
 * A profile describes the data and geometry a category needs; it does not
 * imply that every strategy has already been implemented in the live renderer.
 * New categories must get an explicit profile before they are routed to a mesh.
 */
const profiles: Record<Category, GarmentFitProfile> = {
  shirt: {
    category: "shirt", family: "upper-garment", geometry: "torso-panels",
    requiredAnchors: ["shoulderL", "shoulderR", "hipL", "hipR"],
    optionalAnchors: ["elbowL", "elbowR", "wristL", "wristR"],
    segmentation: "required", sleeves: "product-dependent",
  },
  jacket: {
    category: "jacket", family: "upper-garment", geometry: "torso-panels",
    requiredAnchors: ["shoulderL", "shoulderR", "hipL", "hipR"],
    optionalAnchors: ["elbowL", "elbowR", "wristL", "wristR"],
    segmentation: "required", sleeves: "yes",
  },
  dress: {
    category: "dress", family: "full-body-garment", geometry: "full-body-panels",
    requiredAnchors: ["shoulderL", "shoulderR", "hipL", "hipR"],
    optionalAnchors: ["kneeL", "kneeR", "ankleL", "ankleR"],
    segmentation: "required", sleeves: "product-dependent",
  },
  pants: {
    category: "pants", family: "lower-garment", geometry: "leg-panels",
    requiredAnchors: ["hipL", "hipR", "kneeL", "kneeR"],
    optionalAnchors: ["ankleL", "ankleR"],
    segmentation: "required", sleeves: "no",
  },
  skirt: {
    category: "skirt", family: "lower-garment", geometry: "skirt-panels",
    requiredAnchors: ["hipL", "hipR"],
    optionalAnchors: ["kneeL", "kneeR", "ankleL", "ankleR"],
    segmentation: "required", sleeves: "no",
  },
  wig: {
    category: "wig", family: "headwear", geometry: "head-pose-sprite",
    requiredAnchors: ["forehead", "chin", "cheekL", "cheekR"],
    optionalAnchors: ["headPose"],
    segmentation: "required", sleeves: "no",
  },
  hat: {
    category: "hat", family: "headwear", geometry: "head-pose-sprite",
    requiredAnchors: ["forehead", "cheekL", "cheekR"],
    optionalAnchors: ["headPose"],
    segmentation: "preferred", sleeves: "no",
  },
  glasses: {
    category: "glasses", family: "face-accessory", geometry: "face-landmark-sprite",
    requiredAnchors: ["eyeL", "eyeR"],
    optionalAnchors: ["noseBridge", "temples", "headPose"],
    segmentation: "preferred", sleeves: "no",
  },
  earrings: {
    category: "earrings", family: "jewellery", geometry: "landmark-sprite",
    requiredAnchors: ["earL", "earR"],
    optionalAnchors: ["jawL", "jawR", "headPose"],
    segmentation: "preferred", sleeves: "no",
  },
  necklace: {
    category: "necklace", family: "jewellery", geometry: "landmark-sprite",
    requiredAnchors: ["neckBase", "shoulderL", "shoulderR"],
    optionalAnchors: ["chin"],
    segmentation: "preferred", sleeves: "no",
  },
  watch: {
    category: "watch", family: "hand-accessory", geometry: "hand-landmark-sprite",
    requiredAnchors: ["wrist", "elbow"],
    optionalAnchors: ["palm", "handPose"],
    segmentation: "preferred", sleeves: "no",
  },
  bracelet: {
    category: "bracelet", family: "hand-accessory", geometry: "hand-landmark-sprite",
    requiredAnchors: ["wrist", "elbow"],
    optionalAnchors: ["palm", "handPose"],
    segmentation: "preferred", sleeves: "no",
  },
  ring: {
    category: "ring", family: "hand-accessory", geometry: "hand-landmark-sprite",
    requiredAnchors: ["fingerBase", "fingerTip"],
    optionalAnchors: ["handPose"],
    segmentation: "preferred", sleeves: "no",
  },
  nails: {
    category: "nails", family: "nail", geometry: "nail-surface",
    requiredAnchors: ["fingerBase", "fingerTip"],
    optionalAnchors: ["nailPlate", "handPose"],
    segmentation: "preferred", sleeves: "no",
  },
};

export function getGarmentFitProfile(category: Category | null | undefined): GarmentFitProfile | null {
  return category ? profiles[category] ?? null : null;
}

export function getGarmentFitProfiles(): readonly GarmentFitProfile[] {
  return Object.values(profiles);
}

export function isGarmentCategory(category: Category | null | undefined): boolean {
  const family = getGarmentFitProfile(category)?.family;
  return family === "upper-garment" || family === "full-body-garment" || family === "lower-garment";
}
