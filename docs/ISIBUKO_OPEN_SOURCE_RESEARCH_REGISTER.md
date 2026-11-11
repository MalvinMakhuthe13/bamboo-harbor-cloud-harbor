# Open-source research register

**Reviewed:** 11 November 2026, from public repository and model-card pages.  
**Nothing in this register is installed in Isibuko.** A permissive code licence is not clearance for weights, training data, or dependencies.

Status meanings:

- READY TO BENCHMARK — weights present here, licence cleared for a commercial test, inputs available.
- REQUIRES INTEGRATION — useful and legally plausible, but not wired or not downloaded.
- REQUIRES TRAINING — architecture or code only; no usable checkpoint for our task.
- RESEARCH ONLY — paper or demo, not a commercial component.
- COMMERCIAL LICENCE UNCLEAR — code, weights, data, or a required dependency disagree or were not fully read.
- NOT SUITABLE — non-commercial terms, or the wrong task.

No row is READY TO BENCHMARK. We have no rights-cleared image pair on disk.

## FASHN VTON v1.5

1. https://github.com/fashn-AI/fashn-vton-1.5 and https://huggingface.co/fashn-ai/fashn-vton-1.5
2. https://fashn.ai/research/vton-1-5 — no separate peer-reviewed paper was found.
3. Inference pipeline in the repository. Not run here.
4. Yes. Card publishes weights. README points at `scripts/download_weights.py` (about 2 GB: `model.safetensors` plus DWPose). Not downloaded.
5. Not run. Upstream describes person + garment stills.
6. No Isibuko training code. Upstream training set is described, not released as a corpus we can reuse.
7. Upstream: about 8 GB, about 5 s on an H100, 972M-parameter pixel-space MMDiT. Not measured here.
8. Tops, bottoms, one-pieces. Not hair, glasses, jewellery, or nails.
9. Image only.
10. Try-on code and the try-on weight card: Apache-2.0. The pipeline also downloads FASHN Human Parser (below). Do not treat Apache on the try-on repo as clearance for the stack.
11. Card describes training on masked try-on pairs and synthetic triplets. That description is not a dataset licence.
12. One still per call. A turn would be unrelated frames. Print fidelity is unmeasured.
13. PyTorch, DWPose, YOLOX, FASHN Human Parser. Third-party licences are separate.
14. Medium once a GPU and the parser terms are approved. The service skeleton is `services/isibuko-infer`.
15. Reuse as the first still-image benchmark only after the parser terms, a GPU, and a rights-cleared pair are approved. Do not ship it as Isibuko-owned.
**Status: COMMERCIAL LICENCE UNCLEAR** (parser and training-data provenance).

## FASHN Human Parser

1. https://huggingface.co/fashn-ai/fashn-human-parser and https://github.com/fashn-AI/fashn-human-parser
2. None beyond the model card.
3. Inference package. Not run here.
4. Yes. About 64M parameters, about 244 MB, auto-downloaded on first use.
5. Not run.
6. Fine-tune of SegFormer-B4. Training code for our use was not taken.
7. Small relative to the try-on model. Not measured.
8. 18 parsing classes, including top, dress, skirt, pants, hat, glasses, jewelry. Not a try-on generator.
9. Image.
10. Card tag `nvidia-segformer`. Text: inherits the NVIDIA Source Code License for SegFormer.
11. Training images for the fine-tune were not licensed to Isibuko on the card.
12. Input resized to 384×576. Not a garment synthesizer.
13. Transformers, SegFormer.
14. Easy to call, not cleared to ship.
15. Do not bundle it until counsel accepts the NVIDIA terms. MediaPipe remains the on-device parser.
**Status: COMMERCIAL LICENCE UNCLEAR**

## IDM-VTON

1. https://github.com/yisol/IDM-VTON
2. Image-based virtual try-on paper (the repo README). Not re-quoted here as a benchmark.
3. Inference and checkpoints exist upstream.
4. Yes, upstream. Not downloaded.
5. Not run.
6. Training code exists upstream. Not used.
7. A third-party note of about 17 s per still on an A100 was recorded earlier. Not measured here.
8. Upper-body try-on pairs. Not accessories.
9. Image only.
10. README: codes and checkpoints CC BY-NC-SA 4.0.
11. Typical VITON-HD-style research pairs. Not commercially cleared.
12. No temporal model.
13. SDXL stack. Heavy.
14. Not worth integrating for a commercial product.
15. Reject for deployment. Useful only as a visual reference in papers.
**Status: NOT SUITABLE**

## CatVTON

1. https://github.com/Zheng-Chong/CatVTON
2. Project paper linked from the repository.
3. Inference, checkpoints, and a demo.
4. Yes, upstream. Not downloaded.
5. Not run.
6. Upstream training code. Not used.
7. Authors describe under 8 GB at 1024×768. Not measured here.
8. Image try-on for garments in their training sets. Not hair or jewellery.
9. Image only.
10. Code, checkpoints, and demo: CC BY-NC-SA 4.0.
11. Research try-on sets. Not cleared.
12. No video.
13. Diffusion stack.
14. Reject.
15. Do not ship.
**Status: NOT SUITABLE**

## OOTDiffusion

1. https://github.com/levihsu/OOTDiffusion and https://huggingface.co/levihsu/OOTDiffusion
2. arXiv 2403.01779
3. Inference code and released checkpoints (VITON-HD half-body and Dress Code full-body, per the model card).
4. Yes, on Hugging Face. Not downloaded.
5. Not run.
6. Not taken.
7. Not measured. The card mentions an A100 demo via ZeroGPU. That is their hardware, not ours.
8. Half-body and full-body garments in those checkpoints. Not accessories.
9. Image.
10. Hugging Face licence tag read this pass: `cc-by-nc-sa-4.0`. The raw GitHub LICENSE file did not load in this pass. Issue 198 says some code text mentions Apache-2.0. The released checkpoint tag is the one that governs those weights, and it is non-commercial.
11. Card says the checkpoints were trained on VITON-HD and Dress Code.
12. Image only. Research datasets.
13. Diffusion, OpenPose, human parsing. Those extra weights have their own terms.
14. Reject for commercial use.
15. Do not benchmark inside the product.
**Status: NOT SUITABLE**

## StableVITON

1. https://github.com/rlawjdghek/StableVITON
2. arXiv 2312.01725, CVPR 2024.
3. README lists inference code, weights, and training code as released upstream.
4. Yes, upstream. Not downloaded.
5. Not run.
6. Yes, upstream. Not used.
7. Not measured. Environment pins an older CUDA torch stack.
8. Clothing try-on. Not accessories.
9. Image.
10. Repository licence section: CC BY-NC-SA 4.0.
11. Papers evaluate on VITON-HD and DressCode. Research only.
12. Not commercial. Not video.
13. Latent diffusion, several pinned packages.
14. Reject.
15. Paper reference only.
**Status: NOT SUITABLE**

## VITON-HD

1. https://github.com/shadow2496/VITON-HD
2. CVPR 2021.
3. Official training and test code, plus a dataset.
4. Pretrained networks are offered upstream. Not downloaded.
5. Not run.
6. Yes. Not used.
7. Not measured.
8. 1024×768 frontal woman and top pairs. 11,647 train and 2,032 test, per the README. Not a general catalogue.
9. Image.
10. CC BY-NC 4.0. README: non-commercial, cite the paper.
11. README: collected for research purposes only.
12. Narrow population and category. Using it to train a commercial model would breach the stated purpose.
13. Older PyTorch GAN stack.
14. Reject as training data.
15. Do not ingest.
**Status: NOT SUITABLE**

## HR-VITON

1. https://github.com/sangyun884/HR-VITON
2. ECCV 2022, arXiv 2206.14180.
3. Official implementation.
4. Upstream checkpoints exist. Not downloaded.
5. Not run.
6. Yes. README mentions a multi-day 2×3090 training stage. Not started.
7. Their figure, not ours.
8. High-resolution clothing try-on.
9. Image.
10. CC BY-NC 4.0.
11. Research dataset lineage.
12. Non-commercial. Superseded in quality by later diffusion models that are also non-commercial.
13. PyTorch, optional APEX.
14. Reject.
15. Do not ingest.
**Status: NOT SUITABLE**

## Leffa

1. https://github.com/franciszzj/Leffa
2. Project paper linked from the repo. Not re-read line by line this pass.
3. Inference code.
4. Weights are published. Not downloaded.
5. Not run.
6. Not used.
7. A third-party port has said about 12 GB. Not measured here.
8. Try-on and pose-guided person transfer, depending on checkpoint.
9. Image.
10. Code repository is presented as MIT. MIT on the code does not license the weights.
11. Project states a try-on model trained on VITON-HD and a DressCode model. Those sets are research-only.
12. Data rights block commercial fine-tunes of the published checkpoint.
13. Stable Diffusion inpainting weights, which have their own licence.
14. Do not integrate until a weight licence that is not inherited from VITON-HD is written down.
15. Leave it out.
**Status: COMMERCIAL LICENCE UNCLEAR**

## MagicTryOn

1. https://github.com/vivoCameraResearch/Magic-TryOn
2. Project paper. A later table has been cited for about 13.7 s per iteration on the large setup. Not measured here.
3. Video try-on implementation.
4. 14B and 1.3B public weights, per the project. Not downloaded.
5. Not run.
6. Not used.
7. Large GPU. Not approved.
8. Video garments. Not a full accessory suite.
9. Video, offline, not a browser camera.
10. CC BY-NC-SA 4.0 in the project notes already in this repo.
11. Not a commercial corpus.
12. Non-commercial and far too slow to be the live mirror.
13. Large video diffusion stack.
14. Reject.
15. Research reference for temporal failure modes only.
**Status: NOT SUITABLE**

## CatV2TON

1. https://github.com/Zheng-Chong/CatV2TON
2. DiT image-and-video try-on paper.
3. Research implementation.
4. Weight card previously recorded as non-commercial. Not downloaded.
5. Not run.
6. Not used.
7. A paper table lists about 1.04 s per iteration and 1.34B parameters. Not an Isibuko measurement.
8. Garments in their sets.
9. Image and video, batch, not live.
10. CC BY-NC-SA 4.0 on the paper; weight card non-commercial.
11. Research sets.
12. Cannot ship.
13. DiT stack.
14. Reject.
15. Do not install.
**Status: NOT SUITABLE**

## ViViD

1. https://github.com/alibaba-yuanjing-aigclab/ViViD
2. Video try-on paper from that lab.
3. Offline PyTorch script.
4. The repository is Apache-2.0 code. Diffusion backbone weights are separate and are not in this repo.
5. Not run. It writes a video file, not a camera loop.
6. Not used.
7. Not measured.
8. Video garments.
9. Video, offline.
10. Code Apache-2.0 does not license the backbone checkpoint.
11. Unknown for the backbone.
12. Not a live model until the backbone licence is read and a GPU exists.
13. torch, diffusers, an external checkpoint.
14. Do not integrate yet.
15. Revisit only if the backbone weight licence is commercial and a still baseline already exists.
**Status: COMMERCIAL LICENCE UNCLEAR**

## Qwen-Image-Edit-2509

1. https://huggingface.co/Qwen/Qwen-Image-Edit-2509
2. Model card. Not a try-on paper.
3. Image-edit weights.
4. Yes, upstream. Not downloaded.
5. Not run.
6. Apache-2.0 would allow a fine-tune. None started. Third-party LoRAs are not assumed Apache.
7. Community notes discuss 24 GB cards. Not measured. Parameter count was not copied from an unverified table.
8. General person-plus-product edits. No SKU loss.
9. Image.
10. Earlier card read in this repository recorded Apache-2.0 for code and weights. Not re-fetched as a file this pass.
11. Training corpus not itemised as a public dataset licence.
12. It can redraw a product instead of preserving one.
13. Large diffusion editor.
14. Too big for a first baseline, and the wrong objective.
15. Not the shirt benchmark.
**Status: RESEARCH ONLY**

## Wan2.1

1. https://huggingface.co/Wan-AI/Wan2.1-T2V-14B
2. Wan technical report, not a try-on paper.
3. Text-to-video and image-to-video weights.
4. Yes. 1.3B and 14B public variants. Not downloaded.
5. Not run.
6. A try-on fine-tune would be a new training run. Not approved.
7. A February 2025 report said the 1.3B model used about 8.19 GB and about 4 minutes for a 5-second 480p clip on an RTX 4090. Not measured here.
8. None for merchant SKUs.
9. Video.
10. Apache-2.0 on the Wan-AI/Wan2.1-T2V-14B card, as previously recorded. Generated-content rights still follow the licence and the law.
11. Not a fashion try-on corpus.
12. Will not hold a shirt print through a turn without training we have not done.
13. Large video stack.
14. Possible later prior. Not now.
15. Do not install for the first milestone.
**Status: RESEARCH ONLY**

## LTX-2.5

1. https://github.com/Lightricks/LTX-Video
2. Vendor model cards.
3. Video inference code.
4. Weights exist upstream. Not downloaded.
5. Not run.
6. Vendor LoRA training exists. Not started. Sharing a fine-tune may need a paid licence.
7. Not measured. Reports describe a 22B model.
8. None for SKUs.
9. Video.
10. Inference code has been reported Apache-2.0. Weights are the LTX-2.x Community License, not Apache. Reports of that licence say production use is free under about $10M annual revenue and paid above that. The licence PDF was not re-read word for word this pass.
11. Not a try-on corpus.
12. Conditional commercial rights and no garment lock.
13. Vendor runtime.
14. Leave out until counsel reads the current community licence.
15. Not a try-on baseline.
**Status: COMMERCIAL LICENCE UNCLEAR**

## MediaPipe (already in the mirror)

1. https://github.com/google-ai-edge/mediapipe — tasks already under `public/models` and `public/mediapipe`.
2. Google task documentation. Not a try-on paper.
3. Running in the browser on the build branch as face, pose, hand, and selfie multiclass segmenter.
4. Yes, the task files already shipped with the mirror. Not fine-tuned.
5. Yes, as perception, on device. This sprint did not re-run it.
6. No training.
7. Earlier headless numbers are in `docs/ISIBUKO_AI_STATUS.md`. Not re-measured here.
8. Body, face, hair, clothes classes, hands. Not a worn-garment generator.
9. Live camera or a still. Perception only.
10. Apache-2.0.
11. Not a training set.
12. Segmentation edges are hard. Hands fail when wrists are out of frame. It does not invent cloth.
13. Wasm runtime, classic worker. Already integrated.
14. Done for perception. Do not pretend it is generation.
15. Keep. Do not advertise it as the generative model.
**Status: NOT SUITABLE** as a try-on generator. It stays as the perception layer.

## SAM 2

1. https://github.com/facebookresearch/sam2
2. Meta SAM 2 blog and paper, July 2024, with a February 2025 SAM 2.1 note.
3. Code and weights published by Meta.
4. Yes, upstream. Not downloaded.
5. Not run.
6. Not used.
7. Not measured. Meta describes promptable image and video segmentation.
8. Objects and regions, not garments-as-products.
9. Image and video masks.
10. Apache-2.0 for the model, per Meta’s release note. SA-V dataset is CC BY 4.0 and is a segmentation corpus, not try-on pairs.
11. SA-V is not a merchant try-on set.
12. Masks only. No product identity.
13. PyTorch, GPU-oriented.
14. Possible later mask tool on the server. Not required to refuse a missing try-on.
15. Do not download until a mask task is specified.
**Status: REQUIRES INTEGRATION** only as a mask tool, and not until needed.

## DWPose and garment specialists

FASHN’s try-on README names DWPose and YOLOX. Their licence files were not opened in this pass, so they are not marked commercial just because FASHN is Apache-2.0.

No open model reviewed here is a commercially cleared generator for wigs, glasses, hats, watches, rings, or nails. Those categories stay on the photographic composite, with generative flags false (`src/lib/isibuko-gen/categories.ts`).

## Lucy Edit Dev (open weights, not a candidate)

1. https://huggingface.co/decart-ai/Lucy-Edit-Dev
2. Card cites a Decart Lucy Edit paper PDF. Not a try-on methods paper we can train from.
3. Video edit weights, about 5B, Wan 2.2 based.
4. Yes. Not downloaded.
5. Not run.
6. Training set not released.
7. Not measured.
8. Text-prompted clothing changes, not an exact SKU.
9. Video.
10. Licence name `lucy-edit-dev-model-non-commercial-license`.
11. Not released.
12. Non-commercial, and it does not lock a merchant asset.
13. Video diffusion stack.
14. Reject.
15. Out.
**Status: NOT SUITABLE**

## Decision

The only still try-on whose own weights are Apache-2.0 is FASHN VTON v1.5, and even that stack is blocked by the parser licence, missing weights, missing GPU approval, and missing evaluation images. Every non-commercial checkpoint stays out. Detail is in `docs/ISIBUKO_MODEL_SELECTION.md`.
