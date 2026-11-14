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
  { category: "skirt", composite: "house-photo", generativeStill: false, generativeVideo: false, note: "Studio sample drawing, not a merchant photograph and not a generative model. Needs the hips in frame. Not validated on a person." },
  { category: "wig", composite: "house-photo", generativeStill: false, generativeVideo: false, note: "Plate on the head. A damped spring swings the length with the head and a nearby hand. The hairline stays put. Not grown hair." },
  { category: "glasses", composite: "house-photo", generativeStill: false, generativeVideo: false, note: "Landmark sprite. Not a scan." },
  { category: "hat", composite: "house-photo", generativeStill: false, generativeVideo: false, note: "Landmark sprite." },
  { category: "jewellery", composite: "house-photo", generativeStill: false, generativeVideo: false, note: "Earrings and necklaces are plates. The bracelet is a studio sample band, narrower than the watch, and needs the wrist in frame." },
  { category: "watch", composite: "house-photo", generativeStill: false, generativeVideo: false, note: "Wrist sprite. Needs the wrist in frame." },
  { category: "ring", composite: "house-photo", generativeStill: false, generativeVideo: false, note: "Needs a visible hand." },
  { category: "nails", composite: "house-photo", generativeStill: false, generativeVideo: false, note: "Fingernails follow hand landmarks. Toenails use the pose foot-index point plus four spaced estimates. Not a nail detector and not a generative finish." },
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
