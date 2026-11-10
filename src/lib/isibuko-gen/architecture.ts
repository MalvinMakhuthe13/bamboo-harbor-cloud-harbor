/**
 * Design of the owned shirt model. This is not a trained network.
 * No checkpoint is produced by importing this file.
 */

export type StageSpec = {
  id: string;
  role: string;
  trains: string;
};

export type ShirtArchitecture = {
  id: "isibuko.shirt-diffusion";
  status: "designed-not-trained";
  weightsPresent: false;
  parameters: number;
  frames: number;
  width: number;
  height: number;
  hidden: number;
  blocks: number;
  heads: number;
  patch: number;
  stages: StageSpec[];
  strategy: string[];
  collection: string[];
};

export const SHIRT_ARCHITECTURE: ShirtArchitecture = {
  id: "isibuko.shirt-diffusion",
  status: "designed-not-trained",
  weightsPresent: false,
  parameters: 420_000_000,
  frames: 8,
  width: 384,
  height: 512,
  hidden: 768,
  blocks: 16,
  heads: 12,
  patch: 16,
  stages: [
    {
      id: "identity-encoder",
      role: "Encodes the face and uncovered body from the live frame so the person stays the same person.",
      trains: "Identity penalty outside the garment mask. The face crop must match the input.",
    },
    {
      id: "garment-encoder",
      role: "Encodes the merchant shirt photograph: colour, print, seams, and a product id embedding.",
      trains: "Product tokens are shared by every frame of a clip and by every person who wears that sku.",
    },
    {
      id: "pose-encoder",
      role: "Takes the on-device pose (shoulders, elbows, wrists, hips) already produced by the mirror.",
      trains: "The shirt has to follow those joints. Arms are not a flat overlay.",
    },
    {
      id: "mask-encoder",
      role: "Takes the clothes mask and a hand-occlusion mask.",
      trains: "Pixels marked as hands in front stay the shopper's hands. The shirt continues under them.",
    },
    {
      id: "temporal-backbone",
      role: "Latent video transformer over 8-frame clips, conditioned on the previous latent.",
      trains: "Flicker loss inside the garment and a warp consistency loss between neighbours.",
    },
    {
      id: "decoder",
      role: "Decodes a worn frame at 384×512. Display upscales. It does not replace the camera paint loop.",
      trains: "Reconstruction against the owned worn frame, plus the temporal losses.",
    },
  ],
  strategy: [
    "Stage A trains still pairs: neutral person, merchant shirt photo, worn frame. Rights must be owned or commercially licensed.",
    "Stage B trains 8-frame clips of the same person turning and moving their arms, with the same product id on every frame.",
    "The photographic composite is not a teacher and is not a stand-in output.",
    "Distillation toward a smaller student happens only after Stage B holds identity, print, and temporal scores on the eval set.",
    "No step runs until a training budget is approved.",
  ],
  collection: [
    "Each clip is one person, one shirt, at least 8 timestamps, pose marks, and a garment mask per frame.",
    "Include front, quarter-turn, and an arm raise. Label occlusion when a hand crosses the torso.",
    "Pair every clip with the merchant asset for that sku (photo, colour, fabric note).",
    "Do not ingest VITON-HD, DressCode, or any set marked research-only.",
    "Store consent and the rights tag with the clip. The validator rejects unknown and research-only.",
  ],
};

export type GpuEstimate = {
  weightsGb: number;
  adamGb: number;
  gradGb: number;
  activationGb: number;
  naiveAttentionGb: number;
  checkpointedGb: number;
  naiveGb: number;
  measured: false;
  note: string;
};

/** Lower-bound arithmetic. Not a benchmark and not a quote for a rented GPU. */
export function estimateTrainGpu(arch: ShirtArchitecture = SHIRT_ARCHITECTURE): GpuEstimate {
  const weightsGb = (arch.parameters * 2) / 1e9;
  const adamGb = (arch.parameters * 8) / 1e9;
  const gradGb = (arch.parameters * 4) / 1e9;
  const tokens = arch.frames * Math.ceil(arch.width / arch.patch) * Math.ceil(arch.height / arch.patch);
  const activationGb = (tokens * arch.hidden * 2) / 1e9;
  const naiveAttentionGb = (arch.blocks * arch.heads * tokens * tokens * 2) / 1e9;
  const checkpointedGb = weightsGb + adamGb + gradGb + activationGb;
  const naiveGb = checkpointedGb + naiveAttentionGb;
  return {
    weightsGb,
    adamGb,
    gradGb,
    activationGb,
    naiveAttentionGb,
    checkpointedGb,
    naiveGb,
    measured: false,
    note: "Batch size 1, bf16 weights, fp32 Adam state and gradients. Attention is the quadratic term if every score is stored. Checkpointing drops that term. This is arithmetic, not a measured training run.",
  };
}
