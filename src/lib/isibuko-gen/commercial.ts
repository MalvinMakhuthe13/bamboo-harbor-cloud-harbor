/**
 * Commercial-path notes. None of these models is installed.
 * Latency and memory figures are quoted from the cited card or page.
 * Isibuko did not run them and did not measure them.
 * A code licence is not treated as a weight licence.
 */

export type CommercialUse = "yes" | "conditional" | "not-cleared";

export type CommercialPath = {
  id: string;
  name: string;
  kind: "image" | "video";
  codeLicense: string;
  weightLicense: string;
  trainingData: string;
  commercial: CommercialUse;
  /** Always false. Nothing here is in the camera loop. */
  live: false;
  installed: false;
  size: string;
  gpu: string;
  temporal: string;
  latency: string;
  finetune: string;
  productConditioning: string;
  whyNotInstalled: string;
  source: string;
};

export const COMMERCIAL_PATHS: CommercialPath[] = [
  {
    id: "fashn-vton-1.5",
    name: "FASHN VTON v1.5",
    kind: "image",
    codeLicense: "Apache-2.0 (GitHub repository LICENSE).",
    weightLicense: "Apache-2.0 on the Hugging Face model card for fashn-ai/fashn-vton-1.5.",
    trainingData:
      "The card does not publish a separate corpus licence. Apache-2.0 on the weights is not proof that every training photo was commercially licensed.",
    commercial: "yes",
    live: false,
    installed: false,
    size: "972M parameters, about 1B on the card. Output 576×864. Weights about 2 GB.",
    gpu: "The model card says about 8 GB for inference and bfloat16 on Ampere or newer. Not measured here.",
    temporal: "None. One still per call. A turn would be unrelated frames.",
    latency: "The model card says about 5 seconds on an NVIDIA H100. Not an Isibuko measurement.",
    finetune: "Apache-2.0 allows adaptation. No Isibuko fine-tune exists, and none is started.",
    productConditioning: "Yes. Person image plus garment image, category tops. That matches a shirt still, not a video.",
    whyNotInstalled:
      "Image model. It cannot keep a shirt coherent while someone turns. Downloading it would not make the mirror generative, and it has not been downloaded.",
    source: "https://huggingface.co/fashn-ai/fashn-vton-1.5",
  },
  {
    id: "qwen-image-edit-2509",
    name: "Qwen-Image-Edit-2509",
    kind: "image",
    codeLicense: "Apache-2.0 stated on the model card.",
    weightLicense: "Apache-2.0 stated on the model card (Qwen/Qwen-Image-Edit-2509).",
    trainingData: "Not itemised as a public dataset licence on the card read here.",
    commercial: "yes",
    live: false,
    installed: false,
    size: "Qwen-Image edit model. Community notes discuss 24 GB cards. Parameter count was not copied from an unverified table.",
    gpu: "Not measured. A community thread shows a 24 GB offload path. That is not an Isibuko benchmark.",
    temporal: "None. Image edit.",
    latency: "Not published as a camera budget, and not measured here.",
    finetune: "Apache-2.0 allows it. Third-party LoRAs carry their own licences and are not assumed Apache.",
    productConditioning:
      "The card describes person-plus-product edits. It is a general editor, not a try-on model with a garment-identity loss.",
    whyNotInstalled: "Too large for this browser, image only, and not an owned shirt checkpoint.",
    source: "https://huggingface.co/Qwen/Qwen-Image-Edit-2509",
  },
  {
    id: "wan2.1",
    name: "Wan2.1",
    kind: "video",
    codeLicense: "Apache-2.0.",
    weightLicense:
      "Apache-2.0 on the Wan-AI/Wan2.1-T2V-14B model card. The card says the authors claim no rights over generated content and that use must follow the licence and the law. Wan2.2 is also reported Apache-2.0 by the same project; Wan 3.0 weights were not public as of early November 2026.",
    trainingData: "Not a fashion corpus. Training-data rights are not separately licensed for try-on pairs.",
    commercial: "yes",
    live: false,
    installed: false,
    size: "1.3B and 14B public text-to-video variants, plus a 14B image-to-video variant.",
    gpu: "A February 2025 report said the 1.3B model used about 8.19 GB for a 5-second 480p clip on an RTX 4090, in about 4 minutes. Not measured here.",
    temporal: "Yes, as a video generator. It is not trained to hold a merchant shirt's print through a turn.",
    latency: "Minutes per clip in the cited 1.3B report. Not a live camera rate.",
    finetune: "Apache-2.0 allows fine-tuning. A try-on fine-tune would be a new training run and is not approved.",
    productConditioning: "No. Text or a first frame, not a product id plus garment mask plus pose stream.",
    whyNotInstalled:
      "Commercially usable video prior, but not a try-on model. Installing it would not make a shirt stay on a moving person, and it needs a GPU this project has not been approved to rent.",
    source: "https://huggingface.co/Wan-AI/Wan2.1-T2V-14B",
  },
  {
    id: "ltx-2.5",
    name: "LTX-2.5",
    kind: "video",
    codeLicense: "Inference code is reported Apache-2.0. That does not license the weights.",
    weightLicense:
      "LTX-2.x Community License, not Apache. Reports of the licence (checked November 2026) say production use is free under about $10M annual revenue, a paid licence is required above that, and transferring fine-tunes may need a paid licence.",
    trainingData: "Not published here as a try-on corpus.",
    commercial: "conditional",
    live: false,
    installed: false,
    size: "22B in 2026 reports.",
    gpu: "Not measured. Earlier LTX cards discuss consumer-GPU distilled variants; 22B is not a browser model.",
    temporal: "Video, and some builds include audio. Not garment-locked.",
    latency: "Not measured. Not a per-frame camera model.",
    finetune: "LoRA training is offered by the vendor. Sharing the fine-tune may require a paid licence. Not started.",
    productConditioning: "No native merchant-shirt conditioning.",
    whyNotInstalled: "Conditional commercial rights and no try-on objective. Weights were not downloaded.",
    source: "https://github.com/Lightricks/LTX-Video",
  },
  {
    id: "leffa",
    name: "Leffa",
    kind: "image",
    codeLicense: "MIT on the franciszzj/Leffa code repository.",
    weightLicense: "Weights are published. MIT on the code does not by itself license the weights or the training set.",
    trainingData:
      "The project states a try-on model trained on VITON-HD and a DressCode model. VITON-HD is a research dataset. Those weights are not cleared for this commercial product.",
    commercial: "not-cleared",
    live: false,
    installed: false,
    size: "Try-on checkpoint plus Stable Diffusion inpainting weights. A port describes about 12 GB VRAM for try-on.",
    gpu: "About 12 GB cited by a third-party port. Not measured here.",
    temporal: "None.",
    latency: "Not measured.",
    finetune: "Would inherit the research-data restriction. Not permitted for the commercial set.",
    productConditioning: "Person plus garment, image only.",
    whyNotInstalled: "Code licence and weight rights diverge. Not installed.",
    source: "https://github.com/franciszzj/Leffa",
  },
];

export function commercialSummary(paths: CommercialPath[] = COMMERCIAL_PATHS): {
  installed: number;
  live: number;
  clearedImage: string[];
  clearedVideo: string[];
} {
  return {
    installed: paths.filter((path) => path.installed).length,
    live: paths.filter((path) => path.live).length,
    clearedImage: paths.filter((path) => path.commercial === "yes" && path.kind === "image").map((path) => path.id),
    clearedVideo: paths.filter((path) => path.commercial === "yes" && path.kind === "video").map((path) => path.id),
  };
}
