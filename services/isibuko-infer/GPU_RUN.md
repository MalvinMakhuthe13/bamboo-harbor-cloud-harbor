# GPU run for one still image

Not executed. Do not run this until the weights download, a CUDA GPU, and a rights-cleared pair are approved. Do not point it at the live camera.

The service listens on `127.0.0.1` only. A success is a file named `tryon.png` written by `TryOnModel`. A refusal has `generated: false` and `image: null`.

## What to install

Do not `pip install fashn-human-parser`. Do not `pip install -e` the FASHN repository as published: its package import loads the parser.

```bash
git clone https://github.com/fashn-AI/fashn-vton-1.5.git third_party/fashn-vton-1.5
```

`third_party/` is gitignored. The clone is Apache-2.0 code. Leave it outside Isibuko's commits.

Python 3.10 or newer, plus the libraries that clone imports: `torch`, `torchvision`, `safetensors`, `einops`, `opencv-python`, `pillow`, `numpy`, `onnxruntime-gpu`, `huggingface_hub`. Install them into a virtual environment on the GPU machine. This sandbox did not install them.

Download only these three files, after approval. The card tags are Apache-2.0 as read on 11 November 2026:

```bash
huggingface-cli download fashn-ai/fashn-vton-1.5 model.safetensors --local-dir "$ISIBUKO_WEIGHTS"
huggingface-cli download fashn-ai/DWPose yolox_l.onnx dw-ll_ucoco_384.onnx --local-dir "$ISIBUKO_WEIGHTS/dwpose"
```

Do not run `scripts/download_weights.py`. It also constructs `FashnHumanParser`, which downloads the non-commercial SegFormer weights.

## Inputs

Put two files in the inputs directory, and keep the rights note beside them, outside Git:

- `person.png` — one photograph Isibuko has the right to process. Not a customer camera frame.
- `garment.png` — the exact merchant shirt, flat on a plain background, not a photo of a person wearing it.

## Run

```bash
cd services/isibuko-infer
export ISIBUKO_ALLOW_FASHN=1
export ISIBUKO_WEIGHTS=/absolute/path/weights
export ISIBUKO_FASHN_SRC=/absolute/path/third_party/fashn-vton-1.5
export ISIBUKO_INPUTS=/absolute/path/inputs
export ISIBUKO_OUTPUTS=/absolute/path/outputs
python3 server.py
```

In another shell:

```bash
curl -s -X POST http://127.0.0.1:8099/v1/tryon \
  -H 'Content-Type: application/json' \
  -d '{"person":"person.png","garment":"garment.png","category":"tops","garmentPhotoType":"flat-lay","segmentationFree":true,"parserId":"none"}'
```

Expect HTTP 200 and `"generated": true` only if `outputs/tryon.png` was written by the model. Any other code, including `NO_GPU`, `CHECKOUT_MISSING`, `WEIGHTS_MISSING`, and `PARSER_NON_COMMERCIAL`, is a refusal.

FASHN's own unmeasured figures: about 8 GB of VRAM and about 5 seconds on an H100, 30 steps, guidance 1.5. Isibuko has not measured them. If CUDA is missing the runner stops. It does not fall back to the photographic composite.

## Check the refusal here, where there is no GPU

```bash
cd services/isibuko-infer
python3 test_server.py
```
