# Still-image model selection

**Date:** 11 November 2026  
**Decision:** FASHN VTON v1.5 is the first still-image shirt candidate. It is not installed, not owned by Isibuko, and not a live video model.

## Compared

| Candidate | Still try-on | Weight licence seen this review | Why it is not the baseline |
| --- | --- | --- | --- |
| FASHN VTON v1.5 | Yes. Person + garment. Tops, bottoms, one-pieces. | Try-on card tagged Apache-2.0. | Pipeline also needs FASHN Human Parser. |
| IDM-VTON | Yes. Image only. | Repository states CC BY-NC-SA 4.0 for codes and checkpoints. | Non-commercial. |
| CatVTON | Yes. Image only. | CC BY-NC-SA 4.0. | Non-commercial. |
| OOTDiffusion | Yes. Half-body and full-body checkpoints. | Hugging Face `levihsu/OOTDiffusion` tag `cc-by-nc-sa-4.0`. | Released checkpoints are non-commercial. |
| StableVITON | Yes. | GitHub licence section: CC BY-NC-SA 4.0. | Non-commercial. |
| HR-VITON / VITON-HD | Older image try-on and the research dataset. | CC BY-NC 4.0. Dataset collected for research. | Not a commercial base. |
| Leffa | Yes. Image only. | MIT on the code repository. Weights trained on VITON-HD and DressCode. | Code licence does not clear the data. |
| Qwen-Image-Edit-2509 | General edit, not a try-on loss. | Earlier card read recorded Apache-2.0. Not re-downloaded. | No garment-identity objective. Large. |
| Wan2.1 / LTX | Video generators. | Wan card previously recorded Apache-2.0. LTX weights are a community licence, not Apache. | Not product-conditioned try-on. |
| Lucy VTON 3.6 | Hosted video try-on. | No public weights. | Paid API. Not a dependency. |

## Why FASHN is still the candidate

It is the only still try-on in this set whose own try-on repository and try-on weight card are both Apache-2.0, and whose public interface is person image + garment image + category. That matches the first milestone: one shirt still, not a camera loop.

## Why it is not approved to run

1. `model.safetensors` is not on disk. The project README describes about 2 GB via `scripts/download_weights.py`, plus a human parser of about 244 MB. This machine has about 45 GB free (measured 11 November 2026). Storage is not the blocker. Approval is.
2. [FASHN Human Parser](https://huggingface.co/fashn-ai/fashn-human-parser) is tagged `nvidia-segformer`. The card says the model inherits the NVIDIA Source Code License for SegFormer. That is not Apache-2.0. The try-on licence does not clear the parser.
3. No GPU is approved. FASHN’s own page says about 5 seconds on an H100 and about 8 GB. Isibuko has not measured that.
4. There is no rights-cleared person photograph and merchant garment pair in this repository.

`STILL_BASELINE.blockedBy` in `src/lib/isibuko-gen/baseline.ts` lists those four blockers. `baselineCanRun()` returns false.

## Not selected for video

No open video try-on in this review is both commercially usable and fast enough to be a camera. Lucy VTON is the quality reference and stays outside the build. Wan and LTX are video priors, not shirt models.
