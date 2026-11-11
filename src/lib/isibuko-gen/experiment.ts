/** An experiment is accepted only with a reproducible record. Scores without an output are rejected. */

export type ExperimentRecord = {
  id: string;
  modelId: string;
  modelVersion: string;
  codeVersion: string;
  datasetVersion: string;
  hardware: string;
  generated: boolean;
  outputPath: string | null;
  failureCode: string | null;
  metrics: Record<string, number> | null;
  conclusion: string;
};

export function acceptExperiment(record: ExperimentRecord): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  for (const [key, value] of [
    ["id", record.id],
    ["modelId", record.modelId],
    ["modelVersion", record.modelVersion],
    ["codeVersion", record.codeVersion],
    ["datasetVersion", record.datasetVersion],
    ["hardware", record.hardware],
    ["conclusion", record.conclusion],
  ] as const) {
    if (!value.trim()) errors.push(`${key} is required.`);
  }
  if (record.generated) {
    if (!record.outputPath?.trim()) errors.push("A generated experiment needs an output file.");
    if (!record.metrics || Object.keys(record.metrics).length === 0) errors.push("A generated experiment needs measured metrics.");
    if (record.failureCode) errors.push("A generated experiment cannot also carry a failure code.");
  } else {
    if (record.outputPath) errors.push("A failed experiment must not point at a generated image.");
    if (record.metrics) errors.push("Do not attach quality scores when no image was generated.");
    if (!record.failureCode?.trim()) errors.push("A failed experiment needs a failure code.");
  }
  return { ok: errors.length === 0, errors };
}
