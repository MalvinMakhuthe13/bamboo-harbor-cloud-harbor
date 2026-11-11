# Live generative roadmap

**Date:** 11 November 2026. Branch `ai/isibuko-generative-foundation` only. No weights downloaded. No GPU used. No image or video generated.

The shopper product is continuous live try-on. The FASHN still-image route stays a separate gated experiment. It is not a prerequisite for the work below. The camera the shopper sees is still the photographic composite.

## What the foundation does now

These modules run as ordinary TypeScript. They do not call a network and they do not load a checkpoint.

| Piece | Module | What it does | What it refuses |
| --- | --- | --- | --- |
| Perception | `src/lib/isibuko-gen/perception.ts` | Holds face, pose, hands, and silhouette between frames. TTLs match the camera cadence: face 200 ms, pose 160 ms, hands 240 ms, silhouette 700 ms. Shoulders, torso, arms, occlusion, and motion come from the cached pose. | It does not run MediaPipe and it does not paint. |
| Product lock | `src/lib/isibuko-gen/product-lock.ts` | Binds brand, sku, image, mask, geometry, colours, texture, pattern, logos, material, size, and measurements to a sha256. | A missing hash is not a product. A new hash is a different garment. |
| Temporal engine | `src/lib/isibuko-gen/temporal.ts` | Keeps 24 frames and 24 pose snapshots. Schedules a keyframe every 8 frames. Marks tracking, recovering, then lost after five lost samples, and returns to tracking only on the second good sample. | Display stays `photographic-fallback`. A path is recorded only if the file exists. No latent is stored. Appearance consistency stays false. |
| Conditioning | `src/lib/isibuko-gen/conditioning.ts` | Names the packet a future Isibuko model must see: person pose, exact product lock, geometry, previous frame kind. | `readyForModel` is false. The missing list always includes "no video model" and "no previous latent". |
| Laboratory | `src/lib/isibuko-gen/live-lab.ts` | Eighteen synthetic numeric frames. One camera session, two product locks, one timing gap, five lost samples, then recovery. | `personTested` is false. `generatedFrames` is 0. |

The camera loop in `src/lib/isibuko-ai/engine.ts` now also calls `notePerception` next to the existing photographic journal. Both calls are inside the existing try/catch. A log failure cannot stop the composite. The receipt passed to the journal is still `null`.

MediaPipe itself is unchanged. Face, pose, hands, and the selfie mask were already scheduled in `src/lib/isibuko-ai/schedule.ts` and held on the last good landmarks. This phase adds the generative-side cache. It does not replace that tracker and it does not remove the photographic fallback.

## Streaming models that were studied, not run

| System | What it actually accepts | Licence | Try-on |
| --- | --- | --- | --- |
| `Wan-AI/Wan2.1-T2V-1.3B` | Text prompt, optional negative prompt, 480p size, sampler settings. Flow-matching DiT, T5 cross-attention, 30 layers, hidden size 1536, 12 heads. | Hugging Face tag `apache-2.0` on 11 November 2026. Training-data rights were not separately granted. Weights were not downloaded. | No. No sku, garment image, mask, pose, or occlusion input. |
| StreamDiffusionV2 | Text prompt to `prepare()`, a source video path, the `wan_causal_dmd_v2v` checkpoint, height, width, fps, step count. README also downloads Wan2.1-T2V weights. | Code repository and `jerryfeng/StreamDiffusionV2` card are tagged Apache-2.0. The paper says the system is built on Wan 2.1 and CausVid. CausVid `LICENSE.md` is CC BY-NC-SA 4.0. | No. `merchantTryOnReady()` is false. The causal stack is not commercially cleared. |

Author speed figures (first frame within 0.5 s, about 64 FPS on four H100s) are not Isibuko measurements and are not for a merchant garment.

What Isibuko still has to build before either system could serve a shopper:

- A garment encoder bound to the product lock, including mask, geometry, texture, pattern, and logos.
- Pose and occlusion conditioning.
- An identity constraint on the person outside the garment.
- A temporal feature that is carried between keyframes. A text prompt cannot name an exact sku.
- For StreamDiffusionV2, a replacement or a cleared licence for the CausVid-derived causal weights. Until that exists, the stack stays not cleared.

## A. CPU, now

- The photographic camera, MediaPipe cadence, and composite.
- The perception cache, product lock, temporal schedule, conditioning packet, and synthetic laboratory.
- The still-image gate: registry empty, `baselineCanRun()` false, NVIDIA parser refused, flat-lay runner not executed.

No claim in this section is a generated try-on.

## B. Free GPU, no new spend and no large download

This sandbox has no CUDA device, and none was probed for a result. A machine the user already has can answer only "is a GPU visible". That answer does not validate try-on.

Wan 1.3B, StreamDiffusionV2, and FASHN `model.safetensors` are large downloads. They are not approved. A free GPU cannot run those models without the weights. Do not start a Colab session, a pull, or a rental under this heading.

## C. Approved GPU, later and separate

Nothing here is requested.

- The FASHN flat-lay still, only after the user approves the download and the compute. Parser id stays `none`. That experiment does not unblock the camera.
- A latency measurement of Wan or a cleared streaming sampler, only after the weights and the licence are approved. The number would be theirs to measure. It would still not be merchant try-on.

## D. Original training, not started

A wrapped video generator is not the product. Training has not started and no dataset has been downloaded.

Required before a live generative claim:

- Product-conditioned generation: the exact locked sku, not a prompt.
- Pose, silhouette, and occlusion as controls.
- Identity held outside the garment region.
- A temporal loss and a real keyframe feature. The cache in this phase stores `featureRef: null`.
- Rights-cleared person and garment video. Research-only sets stay out of a commercial train.
- A commercially cleared causal sampler if the runtime is StreamDiffusion-style. CausVid's non-commercial licence blocks that path today.

## Still blocked

- No commercial open video-try-on weights.
- StreamDiffusionV2 is not cleared while it depends on CausVid.
- No approved GPU and no weight download.
- No rights-cleared benchmark pair.
- No `tryon.png` and no generated video frame.
- This environment has no webcam. The laboratory subject is numeric. It is not a person test.
