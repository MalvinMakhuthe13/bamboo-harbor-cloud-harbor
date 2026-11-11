# Kaggle GPU session

Notebook: [kaggle/isibuko-gpu-setup.ipynb](isibuko-gpu-setup.ipynb)

This does not connect Kaggle by itself. On kaggle.com create a notebook, enable Internet and a GPU accelerator, then upload this file or import it from the GitHub branch `ai/isibuko-generative-foundation`. Run all cells from the top. Each run deletes `/kaggle/working/isibuko` and clones the branch again, so a restarted session does not reuse an old checkout.

The notebook stops if CUDA is missing. That is a refusal, not a CPU performance result. It does not download DINOv2 and it does not train. The prepared experiment is a frozen feature extractor plus a small prediction head. It is not a generative try-on model.

The first real experiment stays closed until a reviewed manifest has at least 40 train and 10 val rows, and you set `ISIBUKO_APPROVE_DINOV2_DOWNLOAD=1` and `ISIBUKO_APPROVE_GPU_RUN=1` yourself. Then, from the clone:

```bash
pip install huggingface_hub transformers
export ISIBUKO_MANIFEST=/kaggle/working/garments.jsonl
export ISIBUKO_WEIGHTS=/kaggle/working/weights
export ISIBUKO_CHECKPOINT=/kaggle/working/isibuko-runs/head.npz
python3 services/isibuko-infer/dinov2_experiment.py
```

Checkpoints in `/kaggle/working` disappear when the session ends. Download one you care about. Do not commit it. An untrained checkpoint is not a garment model. The synthetic drawing run is not this experiment.
