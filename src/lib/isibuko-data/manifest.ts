/** Dataset registry row. The files themselves stay outside Git. */

export type DatasetManifest = {
  id: string;
  source: string;
  licence: string;
  consentStatus: "training-opt-in" | "evaluation-only" | "missing";
  category: string;
  version: string;
  annotationStatus: "none" | "partial" | "complete";
  sampleCount: number;
  retentionPolicy: string;
};

export function acceptManifest(manifest: DatasetManifest): { ok: boolean; trainingEligible: boolean; errors: string[] } {
  const errors: string[] = [];
  for (const [key, value] of [
    ["id", manifest.id],
    ["source", manifest.source],
    ["licence", manifest.licence],
    ["category", manifest.category],
    ["version", manifest.version],
    ["retentionPolicy", manifest.retentionPolicy],
  ] as const) {
    if (!value.trim()) errors.push(`${key} is required.`);
  }
  if (manifest.sampleCount < 1) errors.push("A dataset needs at least one sample record.");
  if (manifest.consentStatus === "missing") errors.push("Consent status is missing.");
  const trainingEligible =
    errors.length === 0 &&
    manifest.consentStatus === "training-opt-in" &&
    manifest.annotationStatus === "complete" &&
    manifest.licence !== "research-only" &&
    manifest.licence !== "unknown";
  if (!trainingEligible && errors.length === 0 && manifest.consentStatus !== "training-opt-in") {
    errors.push("Evaluation consent is not training consent.");
  }
  return { ok: trainingEligible, trainingEligible, errors };
}
