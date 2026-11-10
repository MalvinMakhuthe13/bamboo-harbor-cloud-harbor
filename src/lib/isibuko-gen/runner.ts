import { OWNED_SHIRT_MODEL } from "./candidates.ts";
import { preflightShirt, type Preflight } from "./inference.ts";
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
  preflight: Preflight;
};

/**
 * Camera hook. Validates the shirt packet and assembles a conditioning plan.
 * It never paints a garment and never calls the photographic composite.
 * Weights are absent until a licensed training run is approved.
 */
export function runShirtExperiment(packet: ShirtPacket): ShirtExperimentResult {
  const preflight = preflightShirt(packet);
  return {
    modelId: packet.modelId,
    state: "not-installed",
    running: false,
    live: false,
    usedComposite: false,
    output: null,
    weightsPresent: false,
    reason: preflight.blocker,
    preflight,
  };
}
