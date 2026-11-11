/** Still-image baseline decision. Selection is not installation. */

export const STILL_BASELINE = {
  id: "fashn-vton-1.5",
  version: "1.5",
  selectedFor: "still-image-shirt",
  installed: false,
  weightsPresent: false,
  downloadApproved: false,
  ownedByIsibuko: false,
  liveVideo: false,
  codeLicense: "Apache-2.0 (repository LICENSE and Hugging Face model card, reviewed 11 Nov 2026)",
  parserLicense: "FASHN Human Parser inherits the NVIDIA Source Code License for SegFormer. Not cleared.",
  blockedBy: [
    "weights-not-downloaded",
    "parser-licence-not-cleared",
    "no-approved-gpu",
    "no-rights-cleared-benchmark-pair",
  ],
} as const;

export function baselineCanRun(): false {
  return false;
}
