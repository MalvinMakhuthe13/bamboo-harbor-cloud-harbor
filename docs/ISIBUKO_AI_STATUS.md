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

`isibuko.video-diffusion` is registered and inactive. The shirt experiment is the first concrete hook (`isibuko.shirt-diffusion`). No weights, no training run, no GPU session.

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

## Not done

- No owned generative video weights, so this is photographic compositing, not Lucy-style synthesis. Identity and cloth motion are not synthesised.
- A shirt or coat replaces segmented torso and arm pixels and follows the arm bones. The shoulder join is still a hard seam, not a drape.
- A wig is the merchant plate, aligned to the head with the face left in the plate’s opening. It does not change the shopper’s hair silhouette the way a generative model would. A short style will not remove long hair outside the plate.
- Trousers, watches, rings and nails need that body part in frame. The bundled studio plate is chest-up, so those reads are limited. Hats, glasses, earrings and necklaces are landmark-anchored plates.
- Depth is an assumed ellipse, not a depth camera. The fit screen says so.
