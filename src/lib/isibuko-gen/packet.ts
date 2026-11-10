import { OWNED_SHIRT_MODEL } from "./candidates.ts";

/** What the camera loop can hand a future shirt model. No pixels are stored. */
export type ShirtPacket = {
  modelId: typeof OWNED_SHIRT_MODEL.id;
  category: "shirt";
  garmentId: string;
  garmentUrl: string;
  frameWidth: number;
  frameHeight: number;
  timestampMs: number;
  poseTracked: boolean;
  clothesMask: boolean;
  source: "camera" | "studio" | "off";
};

export type PacketResult = { ok: true; packet: ShirtPacket } | { ok: false; reason: string };

export function buildShirtPacket(input: {
  category: string | null;
  garmentId: string;
  garmentUrl: string | null;
  frameWidth: number;
  frameHeight: number;
  timestampMs: number;
  poseTracked: boolean;
  clothesMask: boolean;
  source: "camera" | "studio" | "off";
}): PacketResult {
  if (input.category !== "shirt") {
    return { ok: false, reason: "This experiment is shirts only. Other categories stay on the photographic mirror." };
  }
  if (!input.garmentUrl) return { ok: false, reason: "The shirt photograph is missing." };
  if (input.frameWidth < 2 || input.frameHeight < 2) return { ok: false, reason: "There is no camera frame yet." };
  return {
    ok: true,
    packet: {
      modelId: OWNED_SHIRT_MODEL.id,
      category: "shirt",
      garmentId: input.garmentId,
      garmentUrl: input.garmentUrl,
      frameWidth: input.frameWidth,
      frameHeight: input.frameHeight,
      timestampMs: input.timestampMs,
      poseTracked: input.poseTracked,
      clothesMask: input.clothesMask,
      source: input.source,
    },
  };
}
