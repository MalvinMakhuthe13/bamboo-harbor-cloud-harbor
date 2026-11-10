import { preflightShirt } from "./inference.ts";
import { buildShirtPacket } from "./packet.ts";

/** A seam in front of the mirror. Calling an adapter never paints and never uploads a frame. */

export type AdapterInput = {
  category: string;
  productId: string;
  image: string | null;
  frameWidth: number;
  frameHeight: number;
  poseTracked: boolean;
  clothesMask: boolean;
  source: "camera" | "studio" | "off";
};

export type AdapterResult = {
  adapterId: string;
  kind: "composite" | "generative";
  trained: boolean;
  live: boolean;
  generated: false;
  output: null;
  usedComposite: false;
  reason: string;
};

export type TryOnAdapter = {
  id: string;
  kind: "composite" | "generative";
  owner: "isibuko";
  trained: boolean;
  /** True only for the on-device photographic mirror, which does not go through this call. */
  live: boolean;
  categories: readonly string[];
  run(input: AdapterInput): AdapterResult;
};

const refused = (adapter: Pick<TryOnAdapter, "id" | "kind" | "trained" | "live">, reason: string): AdapterResult => ({
  adapterId: adapter.id,
  kind: adapter.kind,
  trained: adapter.trained,
  live: adapter.live,
  generated: false,
  output: null,
  usedComposite: false,
  reason,
});

export const compositeAdapter: TryOnAdapter = {
  id: "isibuko.composite",
  kind: "composite",
  owner: "isibuko",
  trained: false,
  live: true,
  categories: ["shirt", "jacket", "dress", "pants", "skirt", "wig", "glasses", "hat", "earrings", "necklace", "watch", "bracelet", "ring", "nails"],
  run() {
    return refused(
      compositeAdapter,
      "The mirror fits the merchant photograph on the device. This call does not create a second image and does not upload the frame.",
    );
  },
};

export const shirtAdapter: TryOnAdapter = {
  id: "isibuko.shirt-diffusion",
  kind: "generative",
  owner: "isibuko",
  trained: false,
  live: false,
  categories: ["shirt"],
  run(input) {
    const built = buildShirtPacket({
      category: input.category,
      garmentId: input.productId,
      garmentUrl: input.image,
      frameWidth: input.frameWidth,
      frameHeight: input.frameHeight,
      timestampMs: 0,
      poseTracked: input.poseTracked,
      clothesMask: input.clothesMask,
      source: input.source,
    });
    if (!built.ok) return refused(shirtAdapter, built.reason);
    const ready = preflightShirt(built.packet);
    return refused(shirtAdapter, ready.blocker);
  },
};

export const ADAPTERS: readonly TryOnAdapter[] = [compositeAdapter, shirtAdapter];

export function adaptersFor(category: string): TryOnAdapter[] {
  return ADAPTERS.filter((adapter) => adapter.categories.includes(category));
}

export function liveAdapter(): TryOnAdapter {
  const live = ADAPTERS.find((adapter) => adapter.live);
  if (!live) throw new Error("The photographic mirror adapter is missing.");
  return live;
}
