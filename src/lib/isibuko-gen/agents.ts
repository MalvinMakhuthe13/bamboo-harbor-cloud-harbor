/** Specialist roles. A claim is not evidence. */

export type AgentId =
  | "discovery"
  | "perception"
  | "garment"
  | "tryon"
  | "dataset"
  | "temporal"
  | "evaluation"
  | "integration"
  | "coordination";

export type AgentSpec = {
  id: AgentId;
  responsibility: string;
  output: string;
};

export const AGENT_SPECS: readonly AgentSpec[] = [
  { id: "discovery", responsibility: "Find public models, weights, and licences.", output: "Research register entries with primary URLs." },
  { id: "perception", responsibility: "Pose, parsing, hands, and occlusion condition data.", output: "Landmarks and masks tied to a frame id." },
  { id: "garment", responsibility: "Category, mask, colour, and print identity of a merchant asset.", output: "A garment condition bound to a sku." },
  { id: "tryon", responsibility: "Run isolated still-image benchmarks. Do not invent pixels.", output: "An experiment record and, only on success, an output file." },
  { id: "dataset", responsibility: "Rights, consent, duplicates, and training eligibility.", output: "A versioned dataset manifest outside Git." },
  { id: "temporal", responsibility: "Video consistency after a still baseline exists.", output: "Clip metrics. Not a live-camera claim." },
  { id: "evaluation", responsibility: "Identity, colour, and detail checks on real outputs.", output: "Metrics that name the output file they scored." },
  { id: "integration", responsibility: "Adapters and deployment. Refuse unregistered models.", output: "A service response that cannot be mistaken for the composite." },
  { id: "coordination", responsibility: "Reject claims that have no logs, files, or tests.", output: "A decision that cites evidence ids." },
];

export type AgentClaim = {
  agent: AgentId;
  claim: string;
  evidence: string[];
};

export function acceptClaim(claim: AgentClaim): { ok: boolean; reason: string } {
  const known = AGENT_SPECS.some((spec) => spec.id === claim.agent);
  if (!known) return { ok: false, reason: "Unknown agent." };
  if (!claim.claim.trim()) return { ok: false, reason: "An empty claim is not a result." };
  const evidence = claim.evidence.map((item) => item.trim()).filter(Boolean);
  if (evidence.length === 0) return { ok: false, reason: "A claim needs a test, log, or output path." };
  if (evidence.every((item) => /^(success|done|pass)$/i.test(item))) {
    return { ok: false, reason: "The word success is not evidence." };
  }
  return { ok: true, reason: "Evidence ids are present. They still have to be checked." };
}
