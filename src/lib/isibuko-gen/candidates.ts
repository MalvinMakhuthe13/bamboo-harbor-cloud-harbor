/**
 * Research notes for a shirt video model. These are not running.
 * Latency figures are cited from the named source. Isibuko did not measure them.
 */

export type TryOnCandidate = {
  id: string;
  name: string;
  kind: "image" | "video";
  code: string;
  license: string;
  commercial: false;
  live: false;
  whyNotLive: string;
  source: string;
};

export const SHIRT_CANDIDATES: TryOnCandidate[] = [
  {
    id: "vivid",
    name: "ViViD",
    kind: "video",
    code: "Apache-2.0 repository. Diffusion backbone weights are separate and are not in this repo.",
    license: "Apache-2.0 (code)",
    commercial: false,
    live: false,
    whyNotLive: "Offline PyTorch script (torch, diffusers). It writes a video file. It is not a camera loop and the checkpoints are not shipped here.",
    source: "https://github.com/alibaba-yuanjing-aigclab/ViViD",
  },
  {
    id: "catv2ton",
    name: "CatV2TON",
    kind: "video",
    code: "DiT try-on for images and video, temporal concatenation.",
    license: "CC BY-NC-SA 4.0 (paper). Weight card reported as non-commercial.",
    commercial: false,
    live: false,
    whyNotLive: "GPU batch inference, not a browser camera. A later paper's table lists about 1.04 s per iteration and 1.34B parameters. That is not an Isibuko measurement, and the licence blocks shipping it.",
    source: "https://github.com/Zheng-Chong/CatV2TON",
  },
  {
    id: "magic-tryon",
    name: "MagicTryOn",
    kind: "video",
    code: "Video try-on with 14B and 1.3B public weights.",
    license: "CC BY-NC-SA 4.0",
    commercial: false,
    live: false,
    whyNotLive: "Same class of GPU video diffusion. The OIE paper's table lists about 13.7 s per iteration for the large setup. Not measured here. Non-commercial.",
    source: "https://github.com/vivoCameraResearch/Magic-TryOn",
  },
  {
    id: "idm-vton",
    name: "IDM-VTON",
    kind: "image",
    code: "SDXL-based image try-on. Strong fabric detail, one still at a time.",
    license: "CC BY-NC-SA 4.0",
    commercial: false,
    live: false,
    whyNotLive: "Image only. A June 2025 third-party demo comparison reported about 17 seconds a picture on an A100. No temporal model, so a live turn would flicker.",
    source: "https://github.com/yisol/IDM-VTON",
  },
  {
    id: "catvton",
    name: "CatVTON",
    kind: "image",
    code: "Lighter image try-on. Authors describe under 8 GB at 1024×768.",
    license: "CC BY-NC-SA 4.0",
    commercial: false,
    live: false,
    whyNotLive: "Image only. The same demo comparison reported about 11 seconds a picture on an A100. A CPU report was minutes per picture. Not a live video model.",
    source: "https://github.com/Zheng-Chong/CatVTON",
  },
];

export const OWNED_SHIRT_MODEL = {
  id: "isibuko.shirt-diffusion",
  name: "Isibuko shirt video",
  status: "not-installed" as const,
  weights: "None. No checkpoint is downloaded or trained.",
  license: "Not trained. Will be original Isibuko weights once a licensed dataset exists.",
};
