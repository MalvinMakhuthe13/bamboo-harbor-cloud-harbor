import { SHIRT_ARCHITECTURE } from "./architecture.ts";
import type { ShirtPacket } from "./packet.ts";

export type ConditionPlan = {
  modelId: typeof SHIRT_ARCHITECTURE.id;
  frame: { width: number; height: number };
  garmentId: string;
  poseSlots: ["left_shoulder", "right_shoulder", "left_elbow", "right_elbow", "left_wrist", "right_wrist"];
  temporalWindow: number;
  weightsPresent: false;
};

export type Preflight = {
  generated: false;
  weightsPresent: false;
  usedComposite: false;
  conditioningValid: boolean;
  steps: string[];
  plan: ConditionPlan | null;
  blocker: string;
};

const POSE_SLOTS = ["left_shoulder", "right_shoulder", "left_elbow", "right_elbow", "left_wrist", "right_wrist"] as const;

export function assembleConditioning(packet: ShirtPacket): { ok: true; plan: ConditionPlan } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (packet.category !== "shirt") errors.push("Only a shirt can be conditioned on this model.");
  if (!packet.garmentId || !packet.garmentUrl) errors.push("The merchant shirt id and photograph are required.");
  if (packet.frameWidth < 64 || packet.frameHeight < 64) errors.push("The camera frame is below 64px.");
  if (!packet.poseTracked) errors.push("Pose is required. Shoulders, elbows and wrists must be tracked before a frame is conditioned.");
  if (!packet.clothesMask) errors.push("A clothes mask is required so the shirt replaces cloth instead of the face.");
  if (packet.modelId !== SHIRT_ARCHITECTURE.id) errors.push("The packet names a different model.");
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    plan: {
      modelId: SHIRT_ARCHITECTURE.id,
      frame: { width: packet.frameWidth, height: packet.frameHeight },
      garmentId: packet.garmentId,
      poseSlots: [...POSE_SLOTS],
      temporalWindow: SHIRT_ARCHITECTURE.frames,
      weightsPresent: false,
    },
  };
}

/**
 * Runs the real preflight. It never samples a network and never calls the composite.
 * Generation stays refused until an approved checkpoint exists.
 */
export function preflightShirt(packet: ShirtPacket): Preflight {
  const built = assembleConditioning(packet);
  if (!built.ok) {
    return {
      generated: false,
      weightsPresent: false,
      usedComposite: false,
      conditioningValid: false,
      steps: ["packet-read", "conditioning-rejected"],
      plan: null,
      blocker: built.errors.join(" "),
    };
  }
  return {
    generated: false,
    weightsPresent: false,
    usedComposite: false,
    conditioningValid: true,
    steps: ["packet-read", "conditioning-assembled", "generation-refused"],
    plan: built.plan,
    blocker:
      "Conditioning is valid and weights are not installed. No frame was generated. The photographic mirror was not used as a stand-in.",
  };
}

export type AcceptanceInput = {
  source: "camera" | "studio" | "none";
  measuredOnPerson: boolean;
  continuousVideo: boolean;
  productIdStable: boolean;
  armsMoved: boolean;
  turned: boolean;
  colorDrift: number | null;
  flicker: number | null;
  identityDrift: number | null;
};

/** The shirt milestone. A gap list is the result. An empty list would be a pass, which this build cannot claim. */
export function acceptanceGaps(input: AcceptanceInput): string[] {
  const gaps: string[] = [];
  if (!input.measuredOnPerson || input.source !== "camera") {
    gaps.push("Not measured on a real person's camera. A studio still does not pass.");
  }
  if (!input.continuousVideo) gaps.push("The result is not a continuous video.");
  if (!input.productIdStable) gaps.push("The merchant shirt id did not stay constant through the clip.");
  if (!input.armsMoved) gaps.push("Arms were not seen moving inside the clip.");
  if (!input.turned) gaps.push("A turn was not seen.");
  if (input.colorDrift === null || input.colorDrift > 12) gaps.push("Shirt colour has not been scored against the merchant asset.");
  if (input.flicker === null || input.flicker > 8) gaps.push("Temporal flicker inside the garment has not been scored.");
  if (input.identityDrift === null || input.identityDrift > 6) gaps.push("Identity outside the garment has not been scored.");
  return gaps;
}

export const UNMEASURED_ACCEPTANCE: AcceptanceInput = {
  source: "none",
  measuredOnPerson: false,
  continuousVideo: false,
  productIdStable: false,
  armsMoved: false,
  turned: false,
  colorDrift: null,
  flicker: null,
  identityDrift: null,
};
