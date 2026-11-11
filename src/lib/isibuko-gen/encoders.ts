/**
 * Pretrained encoders that were checked and not downloaded.
 * None of these is a virtual try-on model.
 */

export type EncoderCandidate = {
  id: string;
  commercial: "cleared-weights" | "not-cleared";
  garmentSpecific: false;
  downloaded: false;
  executed: false;
  licence: string;
  use: string;
};

export const ENCODER_CANDIDATES: EncoderCandidate[] = [
  {
    id: "facebook/dinov2-small",
    commercial: "cleared-weights",
    garmentSpecific: false,
    downloaded: false,
    executed: false,
    licence: "Hugging Face card tagged apache-2.0 on 11 November 2026. Card lists 22.1M parameters.",
    use: "A frozen visual backbone. It does not know a sku, a collar, a hem, or a logo until a separate head is trained.",
  },
  {
    id: "Marqo/marqo-fashionSigLIP",
    commercial: "cleared-weights",
    garmentSpecific: false,
    downloaded: false,
    executed: false,
    licence: "Hugging Face card tagged apache-2.0 on 11 November 2026. Card lists 0.2B parameters. No non-commercial clause was stated.",
    use: "A fashion embedding for retrieval. It does not return sleeves, openings, or a product-asset hash.",
  },
  {
    id: "fashn-human-parser",
    commercial: "not-cleared",
    garmentSpecific: false,
    downloaded: false,
    executed: false,
    licence: "NVIDIA Source Code License for SegFormer, non-commercial research or evaluation only.",
    use: "Refused. It is a person parser, not a merchant garment encoder.",
  },
];

export function neuralEncoderReady(): false {
  return false;
}
