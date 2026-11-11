/** Isibuko conditioning packet. It names the inputs a future model must see. It does not run one. */

import type { PerceptionState } from "./perception.ts";
import type { ProductLock } from "./product-lock.ts";
import type { TemporalStep } from "./temporal.ts";

export type ConditionPacket = {
  productLockId: string;
  imageRef: string;
  maskRef: string | null;
  geometryRef: string | null;
  material: string;
  colours: string[];
  patternRef: string | null;
  textureRef: string | null;
  logoRefs: string[];
  sizeLabel: string | null;
  measurementsCm: ProductLock["measurementsCm"];
  pose: Pick<PerceptionState, "shoulders" | "torso" | "arms" | "hands" | "occlusion" | "motion">;
  previousKind: TemporalStep["display"];
  previousFeatureRef: null;
  readyForModel: false;
  missing: string[];
};

export function buildCondition(input: {
  lock: ProductLock;
  perception: PerceptionState;
  temporal: TemporalStep;
}): ConditionPacket {
  const missing: string[] = ["No video model is attached."];
  if (!input.lock.maskRef) missing.push("The garment mask reference is missing.");
  if (!input.lock.geometryRef) missing.push("The garment geometry reference is missing.");
  if (!input.lock.measurementsComplete) missing.push("Garment measurements are incomplete.");
  if (input.perception.occlusion === "lost") missing.push("Body tracking is lost.");
  if (input.perception.occlusion === "partial") missing.push("Occlusion or silhouette is only partial.");
  missing.push("No previous generated latent exists.");
  return {
    productLockId: input.lock.lockId,
    imageRef: input.lock.imageRef,
    maskRef: input.lock.maskRef,
    geometryRef: input.lock.geometryRef,
    material: input.lock.material,
    colours: input.lock.colours,
    patternRef: input.lock.patternRef,
    textureRef: input.lock.textureRef,
    logoRefs: input.lock.logoRefs,
    sizeLabel: input.lock.sizeLabel,
    measurementsCm: input.lock.measurementsCm,
    pose: {
      shoulders: input.perception.shoulders,
      torso: input.perception.torso,
      arms: input.perception.arms,
      hands: input.perception.hands,
      occlusion: input.perception.occlusion,
      motion: input.perception.motion,
    },
    previousKind: input.temporal.display,
    previousFeatureRef: null,
    readyForModel: false,
    missing,
  };
}
