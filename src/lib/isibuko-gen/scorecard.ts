/** Quality checks. A single number is not photorealism. */

export const QUALITY_CHECKS = [
  { id: "shape", group: "clothing" },
  { id: "colour", group: "clothing" },
  { id: "print", group: "clothing" },
  { id: "texture", group: "clothing" },
  { id: "alignment", group: "clothing" },
  { id: "occlusion", group: "clothing" },
  { id: "identity", group: "person" },
  { id: "temporal", group: "video" },
] as const;

export type AutomatedMeasures = {
  colorDrift: number;
  identityDrift: number;
  flicker: number | null;
};

export type Scorecard = {
  outputPath: string | null;
  automated: AutomatedMeasures | null;
  humanReviewer: string | null;
  humanNotes: string | null;
};

export function acceptScorecard(card: Scorecard): { ok: boolean; errors: string[]; singleScore: null } {
  const errors: string[] = [];
  if (!card.outputPath?.trim()) errors.push("A scorecard needs the generated file it judged.");
  if (!card.automated) errors.push("Automated colour and identity measures are missing.");
  if (!card.humanReviewer?.trim() || !card.humanNotes?.trim()) {
    errors.push("A person must review the image. An automatic score is not enough.");
  }
  return { ok: errors.length === 0, errors, singleScore: null };
}
