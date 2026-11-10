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

`isibuko.video-diffusion` is registered and inactive. No weights, no training run, no GPU session.

## Cost

Measured downloads, cached after the first visit: face 3.6 MB, pose 5.5 MB, hands 7.5 MB, segmenter 15.6 MB, wasm runtime 13.9 MB. After that, inference is on the shopper's device. Camera frames are not uploaded. There is no per-session GPU bill because no generative model is running.

## Measured on this build

CPU delegate, software WebGL, studio photograph, inference edge 256 px:

- Accessories (face only): about 6–7 fps, face step about 160–280 ms.
- Clothing (face, pose, and the segmenter): about 3 fps. The segmenter step is about 480–590 ms and dominates.

These numbers are from the preview browser, not a phone lab. Do not treat them as a Decart comparison.

## Not done

- No owned generative video weights, so this is photographic compositing, not Lucy-style synthesis.
- Sleeves do not follow a raised arm. The torso uses the front product photograph.
- Wig plates are placed on the head. The transparent face opening still shows the shopper's hair.
- Trousers, watches, and nails need the relevant body part in frame. The bundled studio plate is chest-up, so those reads are limited.
- Depth is an assumed ellipse, not a depth camera. The fit screen says so.
