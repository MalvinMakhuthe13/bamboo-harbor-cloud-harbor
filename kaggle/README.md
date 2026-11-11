# Kaggle GPU session

Notebook: [kaggle/isibuko-gpu-setup.ipynb](isibuko-gpu-setup.ipynb)

This does not connect Kaggle by itself. On kaggle.com create a notebook, enable Internet and a GPU accelerator, then upload this file or import it from the GitHub branch `ai/isibuko-generative-foundation`. Run all cells from the top. Each run deletes `/kaggle/working/isibuko` and clones the branch again, so a restarted session does not reuse an old checkout.

The notebook stops if CUDA is missing. That is a refusal, not a CPU performance result. It does not download DINOv2 and it does not train. The prepared experiment is a frozen feature extractor plus a small prediction head. It is not a generative try-on model. The first hardware preflight, run on Kaggle and not repeated in this commit, measured a Tesla T4, 14,911 MB of VRAM, PyTorch 2.11.0+cu130, and CUDA 13.0.

The preflight uses Kaggle's existing notebook Python and leaves that environment untouched. It does not create a virtual environment and it does not run pip or ensurepip. If numpy, Pillow, or torch cannot be imported, the notebook stops with the import error. A missing package is not installed.

The first real experiment stays closed until a reviewed manifest has at least 40 train and 10 val rows, and you set `ISIBUKO_APPROVE_DINOV2_DOWNLOAD=1` and `ISIBUKO_APPROVE_GPU_RUN=1` yourself. Then, from the clone, using the same interpreter:

```bash
export ISIBUKO_MANIFEST=/kaggle/working/garments.jsonl
export ISIBUKO_WEIGHTS=/kaggle/working/weights
export ISIBUKO_CHECKPOINT=/kaggle/working/isibuko-runs/head.npz
python3 services/isibuko-infer/dinov2_experiment.py
```

Do not install `huggingface_hub` or `transformers` from this notebook. That remains a separate approval.

The separate download command is not run by the notebook. It fetches only `config.json`, `preprocessor_config.json`, and `model.safetensors` from `facebook/dinov2-small` at revision `ed25f3a31f01632728cabb09d1542f84ab7b0056`, using the existing Python and no extra packages. It does not train.

```bash
python3 services/isibuko-infer/download_dinov2.py --download-only --dest /kaggle/working/isibuko-weights/dinov2-small
```

Checkpoints in `/kaggle/working` disappear when the session ends. Download one you care about. Do not commit it. An untrained checkpoint is not a garment model. The synthetic drawing run is not this experiment.
