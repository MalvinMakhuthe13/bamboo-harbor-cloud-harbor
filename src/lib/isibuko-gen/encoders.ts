/**
 * Pretrained encoders that were checked and not downloaded.
 * None of these is a virtual try-on model.
 */

export type EncoderCandidate = {
  id: string;
  commercial: "cleared-weights" | "not-cleared";
  garmentSpecific: false;
  /** A retrieval embedding or a person parser does not return collar, sleeve, hem, or logo geometry. */
  emitsPartGeometry: false;
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
    emitsPartGeometry: false,
    downloaded: false,
    executed: false,
    licence: "Hugging Face card tagged apache-2.0 on 11 November 2026. Card lists 22.1M parameters.",
    use: "A frozen visual backbone. It was not run on the catalog photographs. It does not emit collar, sleeve, or hem geometry, and a head on top of it would still not be virtual try-on.",
  },
  {
    id: "Marqo/marqo-fashionSigLIP",
    commercial: "cleared-weights",
    garmentSpecific: false,
    emitsPartGeometry: false,
    downloaded: false,
    executed: false,
    licence: "Hugging Face card tagged apache-2.0 on 11 November 2026. Card lists 0.2B parameters. No non-commercial clause was stated.",
    use: "A fashion retrieval embedding. It was not run. It does not return sleeves, openings, a logo region, or a product-asset hash. Pairing it with a segmenter does not make it a try-on model.",
  },
  {
    id: "fashn-human-parser",
    commercial: "not-cleared",
    garmentSpecific: false,
    emitsPartGeometry: false,
    downloaded: false,
    executed: false,
    licence: "NVIDIA Source Code License for SegFormer, non-commercial research or evaluation only.",
    use: "Refused. It is a person parser, not a merchant garment encoder.",
  },
];

export function neuralEncoderReady(): false {
  return false;
}
