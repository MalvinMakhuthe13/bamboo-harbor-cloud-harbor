import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getGarmentFitProfile, getGarmentFitProfiles, isGarmentCategory } from "./garment-profiles.ts";
import type { Category } from "./types.ts";

const categories: Category[] = [
  "shirt", "jacket", "dress", "pants", "skirt", "wig", "hat",
  "glasses", "earrings", "necklace", "watch", "ring", "bracelet", "nails",
];

describe("universal Isibuko fitting profiles", () => {
  it("defines an explicit fitting contract for every product category", () => {
    const profiles = getGarmentFitProfiles();
    assert.equal(profiles.length, categories.length);
    for (const category of categories) {
      const profile = getGarmentFitProfile(category);
      assert.ok(profile, `Missing fitting profile for ${category}`);
      assert.equal(profile?.category, category);
      assert.ok(profile?.requiredAnchors.length);
      assert.ok(profile?.geometry);
    }
  });

  it("routes garment families separately from face, head and hand accessories", () => {
    for (const category of ["shirt", "jacket", "dress", "pants", "skirt"] as const) {
      assert.equal(isGarmentCategory(category), true);
    }
    for (const category of ["wig", "hat", "glasses", "earrings", "necklace", "watch", "ring", "bracelet", "nails"] as const) {
      assert.equal(isGarmentCategory(category), false);
    }
    assert.equal(isGarmentCategory(null), false);
  });

  it("does not assign every garment to the shirt torso mesh", () => {
    assert.equal(getGarmentFitProfile("shirt")?.geometry, "torso-panels");
    assert.equal(getGarmentFitProfile("jacket")?.geometry, "torso-panels");
    assert.equal(getGarmentFitProfile("dress")?.geometry, "full-body-panels");
    assert.equal(getGarmentFitProfile("pants")?.geometry, "leg-panels");
    assert.equal(getGarmentFitProfile("skirt")?.geometry, "full-body-panels");
  });

  it("declares category-specific anchors and segmentation needs", () => {
    assert.ok(getGarmentFitProfile("pants")?.requiredAnchors.includes("kneeL"));
    assert.ok(getGarmentFitProfile("glasses")?.requiredAnchors.includes("eyeL"));
    assert.ok(getGarmentFitProfile("ring")?.requiredAnchors.includes("fingerBase"));
    assert.equal(getGarmentFitProfile("shirt")?.segmentation, "required");
    assert.equal(getGarmentFitProfile("hat")?.segmentation, "preferred");
  });

  it("returns null for missing category rather than silently selecting a default", () => {
    assert.equal(getGarmentFitProfile(null), null);
    assert.equal(getGarmentFitProfile(undefined), null);
  });
});
