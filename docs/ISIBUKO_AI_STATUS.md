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

`isibuko.video-diffusion` is registered and inactive. No weights, no training run, no GPU session.

## Cost

Measured downloads, cached after the first visit: face 3.6 MB, pose 5.5 MB, hands 7.5 MB, segmenter 15.6 MB, wasm runtime 13.9 MB. After that, inference is on the shopper's device. Camera frames are not uploaded. There is no per-session GPU bill because no generative model is running.

## Measured on this build

Headless Chromium, software WebGL, 10 Nov 2026. These are not phone numbers and not a Decart comparison.

The GPU delegate was tried. A segmentation pass took about 3.6 s and stalled the picture, because it uses the same WebGL device as the mirror. The live path therefore uses the CPU delegate inside classic workers, so drawing is not waiting on that device.

Studio photograph, CPU, landmarks at 192 px, segmentation near 144 px:

- Picture about 8 fps. Composite about 0 ms after the still is uploaded once. The headless display callback itself was about 8 Hz.
- Tracking about 6–9 fps while pose, face and segmentation share the machine.
- Face about 30–180 ms after the first frame (one steady reading was 56 ms). Pose about 28–190 ms. Segmentation about 690–860 ms.
- Hands: 0 on the bundled chest-up plate.

Live camera, Chromium’s fake device (a moving test pattern, not a person):

- The gate asks before opening the camera. The status was “Looking for a face. Face the mirror.” It was not labelled as the studio photograph.
- Picture about 9 fps. Composite about 33 ms while copying that camera frame onto the mirror texture on software WebGL.
- Face step about 12 ms. The test pattern is not a person; a hit there is not a try-on. Two frames 700 ms apart were not identical.

## Not done

- No owned generative video weights, so this is photographic compositing, not Lucy-style synthesis. Identity and cloth motion are not synthesised.
- A shirt or coat replaces segmented torso and arm pixels and follows the arm bones. The shoulder join is still a hard seam, not a drape.
- A wig is the merchant plate, aligned to the head with the face left in the plate’s opening. It does not change the shopper’s hair silhouette the way a generative model would. A short style will not remove long hair outside the plate.
- Trousers, watches, rings and nails need that body part in frame. The bundled studio plate is chest-up, so those reads are limited. Hats, glasses, earrings and necklaces are landmark-anchored plates.
- Depth is an assumed ellipse, not a depth camera. The fit screen says so.
