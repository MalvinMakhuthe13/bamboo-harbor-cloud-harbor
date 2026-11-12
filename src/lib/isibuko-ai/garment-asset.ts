import type { Category } from "@/lib/isibuko-ai/types";
import type { AlphaGeometry } from "@/lib/isibuko-ai/anchors";
import { getGarmentFitProfile } from "./garment-profiles.ts";

export type NormalizedRect = { left: number; top: number; right: number; bottom: number };
export type GarmentUvRegion = { part: "torso" | "sleeve-left" | "sleeve-right" | "full" | "leg-left" | "leg-right"; rect: NormalizedRect };
export type AssetReviewItem = {
  anchor: string;
  required: boolean;
  status: "needs-review";
  reason: string;
};
export type GarmentAssetPlan = {
  version: "isibuko.asset-plan/1";
  category: Category;
  state: "blocked" | "review-required" | "ready-for-review";
  crop: NormalizedRect | null;
  alphaCoverage: number;
  alphaConfidence: number;
  silhouetteSamples: number;
  uvRegions: GarmentUvRegion[];
  review: AssetReviewItem[];
  warnings: string[];
};

const FULL: NormalizedRect = { left: 0, top: 0, right: 1, bottom: 1 };

function paddedCrop(bounds: NonNullable<AlphaGeometry["bounds"]>, padding: number): NormalizedRect {
  return {
    left: Math.max(0, bounds.left - padding),
    top: Math.max(0, bounds.top - padding),
    right: Math.min(1, bounds.right + padding),
    bottom: Math.min(1, bounds.bottom + padding),
  };
}

function uvRegions(category: Category): GarmentUvRegion[] {
  switch (category) {
    case "shirt":
    case "jacket":
      return [
        { part: "torso", rect: { left: 0.2, top: 0.02, right: 0.8, bottom: 0.98 } },
        { part: "sleeve-left", rect: { left: 0.02, top: 0.14, right: 0.28, bottom: 0.82 } },
        { part: "sleeve-right", rect: { left: 0.72, top: 0.14, right: 0.98, bottom: 0.82 } },
      ];
    case "dress":
    case "skirt":
      return [{ part: "full", rect: FULL }];
    case "pants":
      return [
        { part: "leg-left", rect: { left: 0.02, top: 0, right: 0.48, bottom: 1 } },
        { part: "leg-right", rect: { left: 0.52, top: 0, right: 0.98, bottom: 1 } },
      ];
    default:
      return [{ part: "full", rect: FULL }];
  }
}

/**
 * Creates a deterministic preparation checklist from a transparent product
 * cut-out. It proposes crop/UV conventions but deliberately does not infer
 * semantic garment landmarks from silhouette alone.
 */
export function prepareGarmentAsset(category: Category, alpha: AlphaGeometry | null): GarmentAssetPlan {
  const profile = getGarmentFitProfile(category);
  const warnings: string[] = [];
  const review: AssetReviewItem[] = [];
  if (!profile) {
    return {
      version: "isibuko.asset-plan/1", category, state: "blocked", crop: null,
      alphaCoverage: 0, alphaConfidence: 0, silhouetteSamples: 0, uvRegions: [],
      review: [], warnings: ["No fitting profile exists for this product category."],
    };
  }
  if (!alpha || !alpha.bounds) {
    return {
      version: "isibuko.asset-plan/1", category, state: "blocked", crop: null,
      alphaCoverage: alpha?.alphaCoverage ?? 0, alphaConfidence: 0,
      silhouetteSamples: alpha?.silhouette.length ?? 0, uvRegions: [],
      review: [], warnings: ["A valid transparent product cut-out is required before fitting preparation."],
    };
  }

  if (alpha.alphaCoverage < 0.02) warnings.push("The visible cut-out occupies very little of the image; inspect crop and source quality.");
  if (alpha.alphaCoverage > 0.98) warnings.push("The image is almost fully opaque; confirm the background was actually removed.");
  if (alpha.silhouette.length < 8) warnings.push("Too few silhouette rows are available for a stable outline review.");
  if (alpha.centralOpeningCandidate) warnings.push("A central transparent opening was detected; confirm whether it is a real product opening before use.");

  for (const anchor of profile.requiredAnchors) {
    review.push({
      anchor,
      required: true,
      status: "needs-review",
      reason: "This is a wearer/product fitting landmark; image alpha alone cannot identify it reliably.",
    });
  }
  for (const anchor of profile.optionalAnchors) {
    review.push({
      anchor,
      required: false,
      status: "needs-review",
      reason: "Confirm whether this optional landmark is useful for this product's actual construction.",
    });
  }

  const crop = paddedCrop(alpha.bounds, 0.025);
  const state = alpha.silhouette.length >= 8 && alpha.alphaCoverage >= 0.02 && alpha.alphaCoverage <= 0.98
    ? "ready-for-review"
    : "review-required";
  return {
    version: "isibuko.asset-plan/1",
    category,
    state,
    crop,
    alphaCoverage: alpha.alphaCoverage,
    alphaConfidence: alpha.confidence,
    silhouetteSamples: alpha.silhouette.length,
    uvRegions: uvRegions(category),
    review,
    warnings,
  };
}
