import { reviewConsent, type CaptureConsent, type CapturePurpose, type StoredSample } from "./capture.ts";
import { rightsProblems } from "./rights.ts";

/** Manifest for a later training run. This file format holds numbers, not weights. */
export const MANIFEST_VERSION = "isibuko.train/1" as const;

export type ManifestRow = {
  id: string;
  task: CapturePurpose;
  category: string;
  consent: CaptureConsent;
  /** True only when pixel consent was separate and a blob lives outside this row. */
  pixelBlob: boolean;
  samples: StoredSample[];
  purchaseUrl?: string;
};

export type TrainManifest = {
  version: typeof MANIFEST_VERSION;
  trainable: boolean;
  rows: ManifestRow[];
};

const TASK_LANDMARKS: Record<CapturePurpose, readonly string[]> = {
  "hair-motion": ["forehead", "cheekL", "cheekR"],
  "garment-drape": ["shoulderL", "shoulderR", "hipL", "hipR"],
  jewellery: ["anchor"],
  nails: ["tip", "base"],
  "product-cutout": ["box"],
};

export function validateManifest(manifest: TrainManifest): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (manifest.version !== MANIFEST_VERSION) errors.push("The manifest version is not isibuko.train/1.");
  if (!manifest.rows.length) errors.push("The manifest has no rows.");
  manifest.rows.forEach((row, index) => {
    const consent = reviewConsent(row.consent);
    if (!consent.ok) consent.reasons.forEach((reason) => errors.push(`Row ${index}: ${reason}`));
    if (row.consent.purpose !== row.task) errors.push(`Row ${index}: consent purpose does not match the task.`);
    if (row.pixelBlob && row.consent.pixels !== true) {
      errors.push(`Row ${index}: a pixel blob is named without separate pixel consent.`);
    }
    if (manifest.trainable && row.consent.rights.recordKind === "synthetic-fixture") {
      errors.push(`Row ${index}: a synthetic fixture cannot be marked trainable.`);
    }
    if (manifest.trainable && rightsProblems(row.consent.rights).length) {
      errors.push(`Row ${index}: trainable rows need a complete rights record.`);
    }
    const needed = TASK_LANDMARKS[row.task];
    if (!row.samples.length) errors.push(`Row ${index}: no samples.`);
    row.samples.forEach((sample, sampleIndex) => {
      const names = new Set(sample.landmarks.map((mark) => mark.name));
      for (const name of needed) {
        if (!names.has(name)) errors.push(`Row ${index} sample ${sampleIndex} is missing ${name}.`);
      }
      if (row.task === "product-cutout" && row.purchaseUrl && !/^https?:\/\//.test(row.purchaseUrl)) {
        errors.push(`Row ${index}: the purchase link is not http(s). It is not a checkout.`);
      }
    });
  });
  return { ok: errors.length === 0, errors };
}

/** Mean absolute error between a recorded offset and a replay. Not a trained score. */
export function replayMae(recorded: readonly number[], replayed: readonly number[]): number | null {
  if (!recorded.length || recorded.length !== replayed.length) return null;
  let total = 0;
  for (let i = 0; i < recorded.length; i++) total += Math.abs((recorded[i] ?? 0) - (replayed[i] ?? 0));
  return total / recorded.length;
}
