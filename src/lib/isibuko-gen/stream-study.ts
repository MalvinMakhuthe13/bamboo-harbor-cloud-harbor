/**
 * What Wan2.1 and StreamDiffusionV2 actually accept.
 * Neither is a merchant try-on model. Nothing here is installed.
 */

export type StreamStudy = {
  id: string;
  providesMerchantTryOn: false;
  weightsDownloaded: false;
  inputs: string[];
  absentInputs: string[];
  licence: string;
  commercial: "cleared-weights" | "not-cleared";
  isibukoMustAdd: string[];
};

export const WAN_T2V_1_3B: StreamStudy = {
  id: "wan2.1-t2v-1.3b",
  providesMerchantTryOn: false,
  weightsDownloaded: false,
  inputs: [
    "Text prompt, English or Chinese.",
    "Optional negative prompt.",
    "480p size. The 1.3B card does not list 720p for this checkpoint.",
    "Sampling settings. The card describes a flow-matching DiT with T5 text cross-attention, 30 layers, hidden size 1536.",
  ],
  absentInputs: ["Merchant sku", "Garment image", "Garment mask", "Body pose", "Occlusion mask", "Previous try-on latent"],
  licence: "Hugging Face card Wan-AI/Wan2.1-T2V-1.3B tagged apache-2.0 on 11 November 2026. Training-data rights are not a separate grant.",
  commercial: "cleared-weights",
  isibukoMustAdd: [
    "A garment encoder bound to a product lock.",
    "Pose and occlusion conditioning.",
    "An identity constraint outside the garment.",
    "A temporal loss that is not a text prompt.",
  ],
};

export const STREAM_DIFFUSION_V2: StreamStudy = {
  id: "streamdiffusionv2",
  providesMerchantTryOn: false,
  weightsDownloaded: false,
  inputs: [
    "Text prompt passed to prepare().",
    "A source video path for video-to-video.",
    "Checkpoint folder wan_causal_dmd_v2v, which the README downloads beside Wan2.1-T2V weights.",
    "Height, width, fps, and a denoising step count.",
  ],
  absentInputs: ["Merchant sku", "Garment image", "Pose landmarks", "Product geometry", "Logo or print lock"],
  licence:
    "The code repository is Apache-2.0 and the jerryfeng/StreamDiffusionV2 card is tagged apache-2.0. The paper says the system is built on Wan 2.1 and CausVid. CausVid LICENSE.md is Creative Commons Attribution-NonCommercial-ShareAlike 4.0. That dependency is not cleared.",
  commercial: "not-cleared",
  isibukoMustAdd: [
    "Replace or relicense the CausVid-derived causal weights before any commercial use.",
    "Add product-lock conditioning. A prompt cannot name an exact sku.",
    "Keep the camera stream outside the model until that conditioning exists.",
  ],
};

export function merchantTryOnReady(study: StreamStudy = STREAM_DIFFUSION_V2): false {
  void study;
  return false;
}
