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

1. `model.safetensors` is not on disk, and neither are the DWPose ONNX files (`yolox_l.onnx`, `dw-ll_ucoco_384.onnx`) from `fashn-ai/DWPose`, whose card is tagged Apache-2.0. The try-on file is about 2 GB. This machine had about 45 GB free on 11 November 2026. Storage is not the blocker. Approval is.
2. The stock `TryOnPipeline` always imports FASHN Human Parser. That package's LICENSE says the weights inherit the NVIDIA Source Code License for SegFormer. Section 3.3 of that licence says the work may be used only non-commercially, meaning research or evaluation. Isibuko does not use it.
3. Reading `pipeline.py` on 11 November 2026: the diffusion call receives the person image, garment image, two pose images, and a category id. It does not receive the label map. The map is discarded when `segmentation_free` is true and the garment photo type is `flat-lay`. A model-worn garment photo still needs the map. MediaPipe's six selfie classes and SAM 2's prompted masks do not emit the 18 class ids, so they are not substitutes. No other commercially cleared try-on checkpoint in the register is a better first still.
4. No GPU is approved. FASHN's own page says about 5 seconds on an H100 and about 8 GB. Isibuko has not measured that.
5. There is no rights-cleared person photograph and exact merchant garment pair in this repository.

`baselineCanRun()` still returns false. The first legal route is documented in `docs/ISIBUKO_PARSER_DECISION.md` and `services/isibuko-infer/GPU_RUN.md`. It has not been executed.

## Not selected for video

No open video try-on in this review is both commercially usable and fast enough to be a camera. Lucy VTON is the quality reference and stays outside the build. Wan and LTX are video priors, not shirt models.
