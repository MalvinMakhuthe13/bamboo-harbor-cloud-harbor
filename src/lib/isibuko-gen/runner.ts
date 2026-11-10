import { OWNED_SHIRT_MODEL } from "./candidates.ts";
import type { ShirtPacket } from "./packet.ts";

export type ShirtExperimentResult = {
  modelId: typeof OWNED_SHIRT_MODEL.id;
  state: "not-installed";
  running: false;
  live: false;
  usedComposite: false;
  output: null;
  weightsPresent: false;
  reason: string;
};

/**
 * The only entry a future camera hook may call.
 * It never paints a garment and never calls the photographic composite.
 * Weights are intentionally absent until a licensed training run is approved.
 */
export function runShirtExperiment(packet: ShirtPacket): ShirtExperimentResult {
  return {
    modelId: packet.modelId,
    state: "not-installed",
    running: false,
    live: false,
    usedComposite: false,
    output: null,
    weightsPresent: false,
    reason:
      "No Isibuko shirt checkpoint is installed. No image was generated. The photographic mirror was not used as a stand-in.",
  };
}
