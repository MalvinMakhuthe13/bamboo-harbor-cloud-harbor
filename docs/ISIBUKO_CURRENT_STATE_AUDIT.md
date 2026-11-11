# Isibuko current-state audit

**Branch:** `ai/isibuko-generative-foundation`  
**Base commit reviewed:** `6368765` (shared with `build/isibuko-decart-inspired-live-experience`)  
**Date:** 11 November 2026  
**This sprint did not re-run the browser mirror and did not open a camera.**

## What actually works

The shopper mirror on this branch is the photographic composite already on the build branch. It is original Isibuko code plus MediaPipe (Apache-2.0) for face, pose, hands, and selfie segmentation. Changing product is designed not to restart the camera session. When no camera exists, a labelled studio photograph is the input. That photograph is not live video and not a generated try-on.

`docs/ISIBUKO_AI_STATUS.md` records an earlier headless Chromium pass on 10 November 2026 (software WebGL, CPU, studio still, no webcam). Those numbers were not re-measured in this sprint. Do not treat them as a new result.

## What is a design, a gate, or a refusal

| Piece | State |
| --- | --- |
| `src/lib/isibuko-gen/contracts.ts` | Typed request, consent, and error contract. Try-on consent cannot also be training consent. |
| `src/lib/isibuko-gen/registry.ts` | Registry starts empty. It refuses a model unless weights, runtime, and `verified-commercial` are all set. |
| `src/lib/isibuko-gen/architecture.ts`, `runner.ts`, `inference.ts` | Designed shirt video model. Runner returns no image. No weights. No training. |
| `src/lib/isibuko-gen/dataset.ts` | Metadata check for an 8-frame shirt pair. Stores no photographs. |
| `src/lib/isibuko-gen/evaluate.ts` | Pixel arithmetic on buffers the caller already has. The 2×2 fixture is not a photograph. |
| `src/lib/isibuko-gen/candidates.ts` | Research cards. Every `live` and `commercial` flag is false. |
| `src/lib/isibuko-gen/commercial.ts` | Licence notes. `installed` and `live` are false for every row. |
| `/lab` shirt experiment | Assembles a conditioning plan and then refuses. It does not call the composite. |
| Older `src/lib/tryon` Three.js path | Still in the tree. It is not the mirror route. |

Nothing in that table is a generated image.

## What this sprint added

- Category capability registry. Every generative flag is false.
- In-memory brand directory that throws if one brand reads another.
- Dataset sample validator and a dataset manifest record. Files stay out of Git.
- Experiment record that rejects scores when nothing was generated.
- Agent claim check that rejects the word “success” as evidence.
- Still-image baseline card for FASHN VTON v1.5 with `baselineCanRun()` hard-coded false.
- Python service `services/isibuko-infer`. With no weights it returns HTTP 409, `generated: false`, `image: null`.
- Adapter `routeRender`. A generative miss is `refused`, not relabelled as the composite.
- Scorecard that will not accept one automatic number as photorealism.
- Camera-report checker. `not-found` is not a person test.

The React mirror was not pointed at the Python service. There is no image to show, and the service is bound to `127.0.0.1`.

## Mocks

There is no mock that returns a success image. Refusals are explicit. The studio photograph and the WebGL composite are real pixels, but they are not model outputs.

## Reuse

Keep the mirror, MediaPipe workers, consent rules, empty model registry, and the shirt metadata validator. Do not start a second registry. Do not replace the composite until a generated file exists and a scorecard names that file.
