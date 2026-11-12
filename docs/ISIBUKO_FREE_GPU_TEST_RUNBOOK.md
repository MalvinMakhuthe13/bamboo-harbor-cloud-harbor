# Isibuko free-GPU preflight runbook

**Purpose:** inspect an available Kaggle GPU before spending the limited session on one carefully selected garment-model experiment.

## Safety and cost

- This preflight does not download model weights.
- It does not run inference, upload photos, read API keys or start a paid GPU.
- Use a Kaggle notebook with the free GPU option only if available in your account.
- Do not overwrite or downgrade the existing FUMOCA environment.
- Do not upload a personal camera image to Kaggle or another service unless the person in the image has explicitly agreed to that transfer.
- Use a garment image and wearer image that Isibuko has permission to process.

## Step 1 — Open a Kaggle notebook

1. Create a new notebook.
2. Select the free GPU accelerator if your account offers it.
3. Do not enable paid compute.
4. Open a terminal/notebook cell and clone the Isibuko research branch:

```bash
!git clone --depth 1 --branch research/isibuko-full-force-vton-2026-11-12 https://github.com/MalvinMakhuthe13/bamboo-harbor-cloud-harbor.git
%cd bamboo-harbor-cloud-harbor
!python scripts/isibuko_gpu_preflight.py
```

## Step 2 — Save the output

The script reports:
- Python and PyTorch versions.
- CUDA version and whether CUDA is available.
- GPU name, compute capability and VRAM.
- BF16 support.
- Available disk space.
- Presence of optional packages.
- Whether model directories have been configured.

It does not print secrets or read any API keys.

Send the JSON output back before downloading anything. We will use it to choose a compatible test.

## Step 3 — Candidate order after preflight

1. **Design2GarmentCode pattern generation:** best first asset-conversion experiment. It has MIT code and can use the Apache-2.0 Qwen2-VL-2B base model locally. The external fine-tuned adapter's licence and training-data provenance have not been verified. Its optional NVIDIA Warp GarmentCode simulator is non-commercial under the fork's current licence and must not be used in Isibuko commercial work.
2. **FASHN VTON 1.5 still-image try-on:** separate benchmark. The published try-on code/weights state Apache-2.0, but training-corpus provenance still requires review. Use the parser-free flat-lay route only after the service preflight and legal review.
3. **Do not start with GarmentGPT:** its Hugging Face repository is approximately 96.5 GB and is not suitable for a one-hour free T4 session.

## Compatibility warning

Design2GarmentCode's published environment specifies Python 3.9.19 and PyTorch 2.4.0+cu121. FUMOCA environments in prior work used newer Python/PyTorch/CUDA versions. Do not force-install its requirements into an existing environment. First isolate the environment and verify compatibility.

A 16 GB T4 is a plausible benchmark target for the 2B Qwen model, but actual peak memory, adapter compatibility, and pattern quality have not been measured. A 4 GB RTX 3050 should not be assumed to run the full unquantized Qwen2-VL-2B weights.

## What counts as a successful experiment

A successful pattern-generation test must:
- Produce valid structured pattern JSON.
- Compile into a garment mesh without manual source-code edits.
- Preserve category-defining details (neckline, sleeve, hem, waist, pockets, seams).
- Be reviewable against the source product image and merchant measurements.
- Record GPU, software versions, peak VRAM and latency.
- Be clearly marked as an estimated pattern until a human validates it.

A successful FASHN test must:
- Complete one still-image try-on.
- Preserve the wearer's identity and the garment's colour/print/logo.
- Record GPU, precision, peak VRAM, latency and output.
- Never be presented as physical size measurement.

No model should be promoted to production solely because one sample looks good.
