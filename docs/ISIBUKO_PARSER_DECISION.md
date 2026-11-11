# Human parser decision

**Date:** 11 November 2026. Source was read. Nothing was downloaded. No image was generated.

## What the network actually consumes

`TryOnPipeline.__call__` in [fashn-vton-1.5 pipeline.py](https://github.com/fashn-AI/fashn-vton-1.5/blob/main/src/fashn_vton/pipeline.py) builds five tensors for `TryOnModel`:

| Tensor | Source |
| --- | --- |
| `ca_images` | Person image. Unchanged when `segmentation_free` is true. |
| `garment_images` | Garment image. Unchanged when `garment_photo_type` is `flat-lay`. Otherwise pixels outside the garment labels are filled with 127. |
| `person_poses` | DWPose drawing. |
| `garment_poses` | DWPose, or a dummy pose for a flat-lay. |
| `garment_categories` | 1 tops, 2 bottoms, 3 one-pieces. |

The label map is not an input to the diffusion forward. It is only used to paint those images.

The 18 class ids the masked route expects, from `fashn-human-parser` `labels.py`: background, face, hair, top, dress, skirt, pants, belt, bag, hat, scarf, glasses, arms, hands, legs, feet, torso, jewelry.

For tops the garment labels are top, dress, scarf. Upper-body masking also uses arms and torso, and it preserves face, hair, jewelry, bag, glasses, hat, plus legs. That logic lives in their `create_clothing_agnostic_image`. Isibuko did not copy it.

## Can another parser be swapped in?

Not inside the stock class. `__init__` always constructs `FashnHumanParser`, and `import fashn_vton` imports `pipeline.py`, which imports `fashn_human_parser` at the top of the file. `pyproject.toml` depends on `fashn-human-parser>=0.1.1`.

A replacement can supply an integer map with those 18 ids before the mask is painted. That is a preprocessing swap, and the try-on weights were trained with this parser's maps, so a different map is a distribution change. It is not drop-in until compared on a real pair.

| Provider | Emits the 18 ids? | Commercial position checked | Usable now |
| --- | --- | --- | --- |
| FASHN Human Parser | Yes | NVIDIA SegFormer licence, section 3.3: research or evaluation only. Hugging Face tag `nvidia-segformer`. | No |
| MediaPipe selfie multiclass | No. Six classes: background, hair, body-skin, face-skin, clothes, others. | Apache-2.0, already in the mirror as pose and segmentation. | No as this parser |
| SAM 2 | No. Prompted masks, not garment classes. | Meta's public post says Apache-2.0. The LICENSE file was not re-opened, so it is not approved to download. | No |
| Cleared 18-class parser | Required | None registered | No |

## First route that does not need a parser

Official arguments `segmentation_free=True` and `garment_photo_type="flat-lay"` make both mask functions return the original images. The published class still runs the parser and throws the result away. Isibuko's runner does not import it.

That route is the right one for a merchant flat-lay shirt. It is the wrong route for a garment photographed on a person. Those requests return `PARSER_REQUIRED`.

No other open try-on checkpoint in the selection note is commercially cleared and a better still-image baseline. IDM-VTON, CatVTON, OOTDiffusion, StableVITON, and HR-VITON are non-commercial. Leffa's data is not cleared. Qwen-Image-Edit is a general editor. Kolors commercial use needs a separate Kuaishou registration, which was not requested.

## What was implemented

- `services/isibuko-infer/parser_adapter.py` refuses the NVIDIA parser and refuses to register any parser that is not commercially cleared and complete.
- `services/isibuko-infer/isolated_runner.py` will load only `tryon_mmdit`, `utils`, `dwpose`, and `preprocessing/transforms` from a local Apache checkout, after a text scan. It does not vendor that code.
- The service never calls `TryOnPipeline`.
- The camera composite is not involved.

`tryon.png` does not exist. The runner was not executed.
