# Isibuko AI status

This is the live path on branch `build/isibuko-decart-inspired-live-experience`. It does not call Decart and it does not run a generative video model.

## What runs

The shopper mirror (`/mirror`) keeps one camera session. Changing product, colour, or size does not restart it. When a camera is unavailable, a labelled studio photograph feeds the same pipeline. That photograph is not claimed as live video.

On device, in the browser:

| Piece | Owner | Licence | Role |
| --- | --- | --- | --- |
| Frame orchestrator, composite shader, size fit | Isibuko | Original code in this repository | Schedules tracking and wears the merchant photograph |
| MediaPipe Face Landmarker | Google | Apache-2.0 | Face landmarks |
| MediaPipe Pose Landmarker lite | Google | Apache-2.0 | Body landmarks and a size estimate |
| MediaPipe Hand Landmarker | Google | Apache-2.0 | Nails and rings |
| MediaPipe selfie multiclass segmenter | Google | Apache-2.0 | Background, hair, body, face, clothes, other |

Weights are the upstream files in `public/models`. They are not fine-tuned. The older Three.js try-on remains in `src/lib/tryon` and is no longer the mirror route.

MediaPipe’s wasm loader is the classic script `public/mediapipe/vision_wasm_internal.js`. A module worker has no `importScripts`, so the library falls through to `import()`, and Vite rewrites that to `vision_wasm_internal.js?import`, which fails in development. The tracker is a classic worker (`public/isibuko/tracker.js`) that re-evaluates the loader for each model, because `importScripts` will not run a classic script twice and each task consumes `ModuleFactory`. The same files are static in the production build.

`isibuko.video-diffusion` is registered and inactive. The shirt path now has a real contract: dataset validation, a conditioning preflight, a pixel scorer, and a training-memory estimate. It still does not generate frames. No weights, no training run, no paid GPU.

## Camera test

The mirror shows a camera test panel: picture fps separate from face, pose, hand and segmentation rates, shoulders, elbows, wrists, mask age, motion, and the camera session number. Switching product must not change that session. This machine still has no webcam (`NotFoundError` on an earlier probe). The panel is for a person's own browser. Real-person tracking is not signed off.

GPU tracking is optional. CPU is the default, on three workers (face, body, segmentation) so a slow model does not sit on the picture loop. A GPU pass over 1.8 s reverts to CPU. An earlier software-GL try stalled at about 3.6 s and is not the default.

## Measured after the scheduler change

Headless Chromium, software WebGL, CPU, studio photograph, 10 Nov 2026. Not a phone, not a turning person. The still does not move.

Picture 8 fps. Composite 0 ms because the still is uploaded once. Face found at 2 Hz, 781 ms. Pose 1 Hz, latest pass 56 ms on a body crop, with a full frame on a fixed beat. Both shoulders and both elbows found. Wrists 0 of 2. Hands 0. This plate is chest-up, so wrists were not in frame before either. Segmentation 1 Hz, 854 ms, mask age 258 ms, long edge 128 px because the previous pass was slow, full frame not cropped. Motion read "still". Session stayed 1 when the shirt changed from Sand linen to Black silk. Status stayed "Studio photograph for testing only." No Vite overlay. Three `tracker.js` loads and the wasm files returned HTTP 200. No `?import` request.

These numbers are not a claim that a live camera is smooth. Display fps and inference rate are now separate. Fit was not reduced to chase the pose time: segmentation is never cropped, and pose returns to the full frame every fourth pass.

## Commercial model notes

Checked November 2026 from the cited cards. None is installed. None is in the camera loop. Latency figures are theirs, not measured here.

| Model | Kind | Code | Weights | Commercial | Why it is not the live shirt |
| --- | --- | --- | --- | --- | --- |
| FASHN VTON v1.5 | Image | Apache-2.0 | Apache-2.0 on the model card | Yes for the released weights | One still. Card says about 5 s on an H100 and about 8 GB. Not a video. Training corpus not separately licensed on the card. |
| Qwen-Image-Edit-2509 | Image | Apache-2.0 | Apache-2.0 on the model card | Yes | General editor. Not a garment-locked video model. |
| Wan2.1 | Video | Apache-2.0 | Apache-2.0 on Wan-AI/Wan2.1-T2V-14B | Yes | Video prior, not product-conditioned try-on. A 2025 report put the 1.3B clip at minutes, not a camera rate. |
| LTX-2.5 | Video | Code reported Apache-2.0 | LTX community licence, not Apache | Conditional, reported free under about $10M revenue | Not a try-on model. Fine-tune transfer may need a paid licence. |
| Leffa | Image | MIT | Weights exist | Not cleared | Trained on VITON-HD / DressCode. MIT on the code does not clear those sets. |

ViViD, CatV2TON, MagicTryOn, IDM-VTON and CatVTON remain non-commercial research references and are not installed.

## Owned shirt design

The designed model is 420 million parameters, 8 frames, 384×512. Stages: identity, garment, pose, mask, temporal backbone, decoder. The dataset validator accepts only `isibuko-owned` or `commercially-licensed` clips with masks and wrists. The scorer computes colour drift, flicker, identity drift and occlusion drift on buffers it is given. A 2×2 numeric fixture is not a generated shirt. The acceptance list stays failed until a real camera measurement exists.

Training memory is arithmetic, not a benchmark: about 5.9 GB checkpointed (bf16 weights, fp32 Adam and gradients, batch 1) and about 20 GB if every attention score is stored. No training job has been approved or started.

## Shirt experiment

`/lab` runs that validator, the architecture card, the scorer, and `runShirtExperiment`. The preflight can assemble a conditioning plan and then refuses to generate. It does not call the photographic composite.


## Cost

Measured downloads, cached after the first visit: face 3.6 MB, pose 5.5 MB, hands 7.5 MB, segmenter 15.6 MB, wasm runtime 13.9 MB. After that, inference is on the shopper's device. Camera frames are not uploaded. There is no per-session GPU bill because no generative model is running.

## Measured on this build

Headless Chromium, software WebGL, CPU delegate, 10 Nov 2026, after a clean development-server restart. These are not phone numbers and not a Decart comparison. There is no webcam on this machine (`getUserMedia` returns `NotFoundError: Requested device not found`), so a turning person was not tested. The readings below are the bundled studio photograph, a still of a person, chest-up. It does not move.

MediaPipe after that restart: no Vite error overlay, no page error, and no request for `vision_wasm_internal.js?import`. Both classic workers loaded `tracker.js`, `vision_bundle.js`, and `vision_wasm_internal.js` with HTTP 200.

Cold sample, just as the face appeared: picture 3 fps, tracking 2 fps, face found 1404 ms, pose found 776 ms, segment mask 917 ms, hands 0, composite 0 ms.

Eight seconds later, then two seconds after that:

- Picture 10 fps, then 5 fps. The still is uploaded once, so composite stays 0 ms. The headless display callback itself is only a few hertz.
- Tracking 3 fps.
- Face found, 399 ms then 506 ms. Pose found, 530 ms then 646 ms. Segmentation mask, 615 ms then 826 ms.
- Hands 0. Wrists are not in this plate, so nails, rings and watches cannot be checked on it.
- Switching from Sand linen to Black silk left the status “Studio photograph for testing only. This is not your camera.” The source was not restarted.

The GPU delegate stays off. An earlier try on this software GL took about 3.6 s for one segmentation pass and stalled the picture.

## Shirt experiment

`/lab` is a separate page. It can build a shirt-only packet (garment id, frame size, whether pose and a clothes mask exist, camera or studio). `runShirtExperiment` then returns `not-installed`. It does not generate a frame and it does not call the photographic composite. No external checkpoint is downloaded. ViViD, CatV2TON, MagicTryOn, IDM-VTON and CatVTON were compared from their public papers and repos. None is live, and none is cleared for commercial shipping here. An owned shirt model would need licensed training pairs and an approved GPU run. That has not started.

The release-candidate record is `docs/ISIBUKO_RELEASE_CANDIDATE.md`.

## Not done

- No owned generative video weights, so this is photographic compositing, not Lucy-style synthesis. Identity and cloth motion are not synthesised.
- A shirt or coat replaces segmented torso and arm pixels and follows the arm bones. A tracked hand is left as the camera where it crosses the garment. The shoulder join is still a hard seam, not a drape.
- A wig clears segmented hair outside the protected face, then draws the merchant plate. Cleared pixels take a sampled backdrop colour. That is not a new hair mesh.
- Trousers, watches, rings and nails need that body part in frame. The bundled studio plate is chest-up, so those reads are limited. Hats, glasses, earrings and necklaces are landmark-anchored plates.
- Depth is an assumed ellipse, not a depth camera. The fit screen says so.
- Skirts and bracelets have geometry and a merchant upload, and no house photograph.
