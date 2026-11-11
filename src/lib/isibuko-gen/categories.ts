/** What Isibuko may advertise. A catalogue button is not model support. */

export type CompositeState = "house-photo" | "placement-only" | "none";

export type CategoryCapability = {
  category: string;
  composite: CompositeState;
  generativeStill: false;
  generativeVideo: false;
  note: string;
};

export const CATEGORY_CAPABILITIES: readonly CategoryCapability[] = [
  { category: "shirt", composite: "house-photo", generativeStill: false, generativeVideo: false, note: "Photographic torso replacement. No generative shirt is installed." },
  { category: "jacket", composite: "house-photo", generativeStill: false, generativeVideo: false, note: "Photographic torso and sleeve replacement. Not a drape model." },
  { category: "dress", composite: "house-photo", generativeStill: false, generativeVideo: false, note: "Photographic body replacement. Not cloth simulation." },
  { category: "trousers", composite: "house-photo", generativeStill: false, generativeVideo: false, note: "Needs the legs in frame. Not validated on a walking person." },
  { category: "skirt", composite: "placement-only", generativeStill: false, generativeVideo: false, note: "Geometry exists. No house photograph and no generative model." },
  { category: "wig", composite: "house-photo", generativeStill: false, generativeVideo: false, note: "Plate plus cleared hair class. Not a new hair mesh." },
  { category: "glasses", composite: "house-photo", generativeStill: false, generativeVideo: false, note: "Landmark sprite. Not a scan." },
  { category: "hat", composite: "house-photo", generativeStill: false, generativeVideo: false, note: "Landmark sprite." },
  { category: "jewellery", composite: "house-photo", generativeStill: false, generativeVideo: false, note: "Earrings and necklaces are plates. Bracelets are placement-only." },
  { category: "watch", composite: "house-photo", generativeStill: false, generativeVideo: false, note: "Wrist sprite. Needs the wrist in frame." },
  { category: "ring", composite: "house-photo", generativeStill: false, generativeVideo: false, note: "Needs a visible hand." },
  { category: "nails", composite: "house-photo", generativeStill: false, generativeVideo: false, note: "Polish tint from finger landmarks. Not a nail-art generator." },
];

export function capabilityFor(category: string): CategoryCapability | undefined {
  return CATEGORY_CAPABILITIES.find((row) => row.category === category);
}

/** Generative support must not be advertised until a verified model declares it. */
export function generativeAdvertised(category: string): boolean {
  const row = capabilityFor(category);
  if (!row) return false;
  return row.generativeStill || row.generativeVideo;
}
