/** Dataset eligibility. Unknown or research-only assets cannot enter commercial training. */

export type DatasetRights = "isibuko-owned" | "commercially-licensed" | "research-only" | "unknown";

export type SampleRecord = {
  id: string;
  datasetId: string;
  sha256: string;
  rights: DatasetRights;
  consentTraining: boolean;
  consentEvaluation: boolean;
  width: number;
  height: number;
  bytes: number;
  category: string;
};

export type SampleVerdict = {
  ok: boolean;
  trainingEligible: boolean;
  evaluationEligible: boolean;
  errors: string[];
};

const MIN_EDGE = 256;

export function validateSample(sample: SampleRecord, seenHashes: ReadonlySet<string>): SampleVerdict {
  const errors: string[] = [];
  if (!sample.id.trim() || !sample.datasetId.trim()) errors.push("A sample needs an id and a dataset id.");
  if (!/^[a-f0-9]{64}$/.test(sample.sha256)) errors.push("A sha256 hex digest is required.");
  if (seenHashes.has(sample.sha256)) errors.push("Duplicate sample.");
  if (sample.bytes <= 0) errors.push("The file is empty.");
  if (sample.width < MIN_EDGE || sample.height < MIN_EDGE) errors.push(`Both edges must be at least ${MIN_EDGE}px.`);
  if (!sample.category.trim()) errors.push("A category is required.");
  if (sample.rights === "unknown") errors.push("Unknown rights cannot be used.");

  const structuralOk = errors.length === 0;
  const commercialRights = sample.rights === "isibuko-owned" || sample.rights === "commercially-licensed";
  const trainingEligible = structuralOk && commercialRights && sample.consentTraining;
  const evaluationEligible = structuralOk && sample.rights !== "unknown" && sample.consentEvaluation;
  if (structuralOk && sample.rights === "research-only") {
    errors.push("Research-only assets are not eligible for commercial training.");
  }
  if (structuralOk && commercialRights && !sample.consentTraining) {
    errors.push("Training consent is separate from try-on consent and is missing.");
  }
  return { ok: trainingEligible, trainingEligible, evaluationEligible, errors };
}
