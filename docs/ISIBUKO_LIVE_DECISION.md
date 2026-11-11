# Decision: still benchmark and live generative try-on

**Date:** 11 November 2026. No weights downloaded. No model executed. No paid API called. Commit `39097cb` is kept.

The product is continuous camera try-on. A still image is a research gate, not the product.

## A. First still-image benchmark

### What was verified on the FASHN source

A depth-1 clone of [fashn-AI/fashn-vton-1.5](https://github.com/fashn-AI/fashn-vton-1.5) (808 KB of source, no weights) was audited with `services/isibuko-infer/dependency_audit.py`. The audit parses imports. It does not import the package.

| Check | Result |
| --- | --- |
| Parser named in | `pipeline.py`, `preprocessing/agnostic.py` only |
| `import fashn_vton` reaches the parser | Yes. `__init__.py` imports `pipeline.py`, which imports `fashn_human_parser` |
| Flat-lay runner modules reach the parser | No. 15 modules, including try-on, DWPose, and transforms |
| `pip install -e .` dependency | `fashn-human-parser>=0.1.1` is declared. Do not install the package that way |
| Modules executed | No. An import attempt stopped on missing `torch` and `cv2`. The parser was not loaded. That is not a successful dry run |

The diffusion forward still does not take a label map. That is not proof the whole published pipeline is parser-free. The published pipeline is not parser-free. Only the isolated flat-lay path, which skips `pipeline.py`, stays off the parser in the static graph.

Third-party imports on that path include `torch`, `torchvision`, `einops`, `safetensors`, `huggingface_hub`, `opencv` (`cv2`), `PIL`, `onnxruntime`, and `matplotlib`. None of those is the NVIDIA parser. `huggingface_hub` can download files if called. The runner must not call the upstream download script.

### Pose weights

`fashn-ai/DWPose` is tagged `apache-2.0`. The card attributes DWPose (Apache-2.0) and hosts `yolox_l.onnx` and `dw-ll_ucoco_384.onnx`. The FASHN source headers attribute YOLOX and DWPose as Apache-2.0. The card names COCO and UBody as datasets. That is not a licence to retrain on those datasets. The files themselves were not downloaded, so their bytes were not inspected.

### What is legally cleared for a later run

- FASHN try-on code and `model.safetensors` card: Apache-2.0.
- DWPose ONNX card: Apache-2.0.
- Flat-lay, unmasked person, `parserId: "none"`.
- Not cleared: FASHN Human Parser (NVIDIA SegFormer licence, research or evaluation only), any non-commercial try-on checkpoint, and a garment photo that still has a person in it.

### What it costs

No quote was requested and no GPU was priced. FASHN's own page says about 5 seconds and about 8 GB on an H100. That was not measured here. There is no Isibuko dollar figure.

### Still blocked

1. Approval to download the try-on file and the two ONNX files, and not the parser.
2. A CUDA machine. The runner returns `NO_GPU` without one.
3. One rights-cleared person photo and one exact flat-lay merchant garment.
4. A run that writes `tryon.png`. Until that file exists, the still benchmark has not happened.

Oxygen-TryOn's GitHub licence is Apache-2.0. The repository listing on 11 November 2026 is code, docs, and a readme. No weight file and no download link were in that listing. It is an image model, not a camera model, and it is not a replacement for this gate.

## B. Live generative try-on

### What is available

No open video-try-on checkpoint found in this pass is both commercially usable and a merchant-garment model.

| Project | What it is | Licence seen | Live try-on? |
| --- | --- | --- | --- |
| MagicTryOn, CatV2TON | Video try-on with public weights | MagicTryOn README: CC BY-NC-SA 4.0 for code, checkpoints, and demo. CatV2TON Hugging Face card: `cc-by-nc-nd-4.0`. No LICENSE file on the CatV2TON master branch | No. Non-commercial |
| ViViD | Video try-on code | Apache-2.0 code. Backbone weights are separate and were not cleared | No |
| Lucy VTON 3.6 | Hosted realtime try-on | No public weights. Paid API | Not a dependency |
| Lucy Edit Dev | Instruction video edit | Non-commercial weight licence | No |
| FASHN VTON v1.5 | One still | Apache try-on weights. Parser excluded only on the flat-lay route | No. Seconds per still, not a camera |
| Wan 2.1 T2V 1.3B and Wan 2.2 TI2V 5B | General video | Hugging Face cards tagged Apache-2.0 on 11 November 2026 | No garment identity |
| StreamDiffusionV2 | Streaming video-to-video. Checkpoint card `jerryfeng/StreamDiffusionV2` tagged Apache-2.0. Code repo Apache-2.0. Config name `wan_causal_dmd_v2v`. Depends on Wan2.1 T2V weights | Apache on the code and that card | Not try-on. Linux + NVIDIA GPU. The authors' paper (arXiv 2511.07399v2) claims a first frame within 0.5 s and about 64 FPS for the 1.3B model on four H100s. Isibuko did not measure that |
| StreamDiffusion | Real-time image pipeline, webcam demos | Apache-2.0 code | Not a garment model. Base Stable Diffusion licences are separate |
| Oxygen-TryOn | Image try-on code | Apache-2.0 code. Weights not in the repo | No |
| ID-V2V | Video restyle | Research / non-commercial, as described by a secondary write-up of the repo licence | No |

Their speed numbers are not copied here unless this pass read them. None were measured.

### What can be integrated now

The camera, MediaPipe pose, and photographic composite already keep one session across product changes. That is the perception and fallback path. It is not generation.

`LiveTrack` records each composite as `photographic-fallback` unless a receipt has `generated`, `weightsPresent`, and an output path. The mirror calls it with `receipt: null`, so the shopper path cannot become generative by itself. A product change uses the existing session rule and does not open a new camera. The same call keeps a temporal cache: product id and pose. That cache stays `valid: false` because no keyframe was ever written. `nextLiveAction` refuses a diffusion call on every frame and refuses a keyframe while no video model is attached. The journal also stores the camera's reported FPS, the composite milliseconds, and gaps wider than two 33 ms slots as dropped frames. Those numbers describe the photographic loop only.

This was not run in a browser in this pass. No webcam was used. The journal cannot show a generated frame until a model writes one. `summary().modelAttached` stays false.

### What needs original work

- A streaming sampler that reuses pose, product id, and appearance between keyframes.
- Merchant SKU conditioning. Wan and StreamDiffusionV2 do not take a product id.
- Identity and garment locks across motion, occlusion, and product changes.
- A commercially cleared 18-class parser, or a flat-lay-only still model that never becomes the camera loop.
- Rights-cleared video pairs before any fine-tune.

### Hardware

Not selected and not rented. A live model will be a GPU process beside the browser, not in the page. StreamDiffusionV2's README requires Linux, an NVIDIA GPU, and CUDA 12.4 or newer. Its paper's speed claim used four H100s. That is the authors' number, not an Isibuko measurement, and it is for prompt-conditioned video-to-video, not a merchant garment. FASHN's still figure is about 8 GB and is the wrong latency class for the camera. No rental is approved.

## Recommendation

Keep the photographic camera as the shopper-facing path. Do not describe it as generative.

The fastest credible route to the live product is:

1. Leave the still FASHN run gated. Use it later, if approved, only to learn shirt fidelity. Do not call it once per frame.
2. Do not integrate Lucy, and do not integrate the non-commercial video try-on weights.
3. Treat Apache Wan plus StreamDiffusionV2 as the streaming substrate to study, not as try-on. The missing piece is original product-and-identity conditioning on top of a stream, fed by the camera track that now exists.
4. Build that conditioning only after one real still exists and a GPU is approved. Until then the schedule stays on the photographic fallback.

No download, GPU, or API spend is requested by this note.
