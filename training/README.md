# Training folder

Nothing in this folder is a trained model. No weights and no shopper photographs are stored here.

| Path | What it is |
| --- | --- |
| `synthetic/*.jsonl` | Tiny numeric fixtures for the stubs |
| `kaggle/tune_motion.py` | Reads hair and cloth fixtures. Refuses to train |
| `kaggle/finetune_cutout.py` | Reads the cut-out fixture. Refuses to fine-tune |
| `kaggle/finetune_nails.py` | Reads the nail fixtures. Refuses to fine-tune |
| `kaggle/*.ipynb` | Kaggle notebooks that only call those stubs |
| `kaggle/gpu-estimates.json` | Planning hours for the free tier, not a measured run |

The live mirror does not read this folder. See `docs/ISIBUKO_TRAINING_PLAN.md`.
