# Isibuko Full-Force Virtual Try-On Research & Engineering Decision

**Research date:** 12 November 2026  
**Repository:** `MalvinMakhuthe13/bamboo-harbor-cloud-harbor`  
**Research branch:** `research/isibuko-full-force-vton-2026-11-12`  
**Base:** `build/isibuko-full-force-2026-11-11` at `72168ae7084ef79e2cfc1d5fb81febba131d69c0`  
**Product decision:** unified live fitting + AI Studio, commercial-first  
**Evidence rule:** a repository, model card, or paper is not proof that Isibuko has installed, run, or validated that model.

---

## 1. Executive decision

Isibuko should be built as a **hybrid virtual try-on platform with two separate rendering modes and one shared body/garment representation**:

1. **Live Fit:** on-device body tracking, segmentation, a body-relative garment mesh, deformation, occlusion and real-time rendering.
2. **AI Studio:** server-side still-image generation for photorealistic previews, initially benchmarking FASHN VTON v1.5 behind the existing inference gate.

Do not run a still-image diffusion model on every camera frame. It is too slow for a continuous camera experience, creates temporal flicker when independently sampled, and is not a reliable substitute for tracking a real garment surface.

Do not attempt to solve live fit by continually enlarging the existing 2D garment photograph. The current mirror's central limitation is geometric: a product photograph is being mapped to a simple body-shaped region, not reconstructed as a garment surface that can bend around a torso and sleeves.

The best next live-engine design is a staged **2.5D-to-3D garment surface**:

- Preserve the current camera and MediaPipe path.
- Use pose landmarks plus a body segmentation mask to build a lightweight body proxy.
- Replace the single torso quad and arm strips with a triangulated garment surface and category-specific topology.
- Pin the garment at stable body anchors.
- Add depth-aware foreground occlusion.
- Test a coarse cloth solver only after the mesh is stable.
- Keep WebGL2 as the baseline renderer and WebGPU as an optional capability, never a hard dependency.

For garment templates, investigate GarmentCode and GarmentCodeData. For soft-body simulation, prototype Rapier's JavaScript/WASM soft-body API. Snap's documented external-body-mesh and cloth-simulation architecture is the most useful public reference for how these pieces fit together, but its tracking runtime is proprietary and its web performance has documented limitations.

For AI Studio, FASHN VTON v1.5 is the strongest initial open-weight still-image candidate found. Its code and model card state Apache-2.0. Its published card describes a 972M-parameter model, 576×864 output, approximately 2 GB weights, approximately 8 GB inference memory and approximately five seconds on an H100. It is **not a live video model**. Its training data is described as 18M masked try-on pairs plus 4M synthetic triplets, but the card does not publish a separate corpus licence/provenance statement. Therefore it is a conditional candidate pending legal review, not yet a production-cleared dependency.

No research-only model or dataset should enter a commercial training or production path.

## 2. What the repository actually contains

The current full-force branch is not a blank slate. The code audit found:

- A working browser camera path and a live mirror route.
- MediaPipe-based face, pose, hand and segmentation work.
- Camera-session continuity as an explicit product requirement.
- A custom WebGL compositing shader and garment placement logic.
- Pose/geometry safeguards and tests.
- Motion, wearer tracking and product segmentation code in the repository.
- Frame-budget telemetry and head-pose diagnostics on the full-force branch.
- A garment-photo measurement utility and a garment-part annotation/training gate.
- A separate Python inference service for FASHN VTON v1.5.
- A parser adapter and an isolated flat-lay runner designed to avoid importing the separately licensed FASHN human parser.
- A model registry and explicit refusal states when weights/runtime are absent.
- Rights and dataset admission contracts that distinguish product-use permission from AI-training permission.

### 2.1 What is not yet proven

The current mirror is still a **live photographic composite**, not a trained video try-on model or a full cloth simulation.

The existing product condition code explicitly records that a product photograph is not a garment measurement and that cloth is not simulated. The garment-photo and garment-part modules are currently handcrafted or annotation-oriented; their own code marks the relevant learned models as not trained/not downloaded.

The FASHN service is not evidence of a working generative path. It is a gated inference service. Its status route refuses if weights or the approved runtime are absent. Its flat-lay runner is a proposed isolated route, not a completed Isibuko camera feature.

The user's 12 November mobile test confirms that the camera opens and the live feed renders on a phone. The user also observed that the garment appears patchy, does not cover the intended body region, and does not wrap naturally. This is the key live-fit acceptance failure to fix.

### 2.2 Branch and validation safety

The full-force branch head audited was `72168ae`. PR #1 remains an open draft from the full-force branch to `integration/isibuko-unified`. PR #3 (wig/nail corrections) and PR #5 (measurement-only frame telemetry) are recorded as merged into the full-force development line. The head-pose diagnostics were added after the telemetry merge.

PR #1's description reports 270 tests, typecheck and lint passing on an earlier commit (`2ecacb6`). That is not proof that every later commit or the current phone experience passes. Real-camera fitting tests remain necessary. Do not merge the research branch automatically or deploy it to production.

## 3. Root cause: why the garment looks pasted on

A realistic try-on must solve three distinct problems:

1. **Placement:** where the garment belongs relative to the wearer.
2. **Geometry:** how the garment surface changes shape as the body moves and turns.
3. **Appearance:** how the garment's actual colour, print, seams, folds, lighting and texture are rendered.

The current live path is strongest at placement. It does not yet have the full geometry and appearance representation.

A front product photograph has no intrinsic knowledge of the wearer's depth, the garment's back, its side panels, sleeve volume, thickness, fabric stiffness or how the material folds. Mapping that photograph into a trapezoid and narrow arm regions cannot reproduce those things. The result can look like a flat image, leave parts of the torso uncovered, stretch the print, or expose hard seams.

The existing body-size estimates are also not measured 3D circumferences. A single front camera view and a set of pose landmarks cannot reliably recover chest, waist and hip circumference without calibration, depth information or a body model. Those estimates must not be marketed as a size guarantee.

### 3.1 Immediate live-engine change

Move from a single garment quad to a category-aware mesh:

- Shirt/top: neckline, left/right shoulder, left/right sleeve, side seams, waist/hem and intermediate cloth vertices.
- Jacket/coat: shirt topology plus open-front panels, lapels, longer hem and front overlap.
- Dress: upper-body topology connected to a skirt surface with waist and hem controls.
- Trousers: waist, hips, crotch, two leg panels and cuffs.
- Skirt: waist band, hip surface and hem.
- Accessories: keep their specialist face/head/hand anchors; do not force all categories through a torso renderer.

The merchant texture should be preserved as the source of product identity. AI-generated output must not silently change a logo, pattern, colour or SKU-defining detail.

## 4. Research: human tracking and body surface

### 4.1 MediaPipe remains the right starting point

The current project already uses MediaPipe, so replacing it before measuring the current phone would add risk without solving the garment geometry problem.

MediaPipe Pose Landmarker can process still images, decoded video and live video, and returns image-space and world-space landmarks. The web API's video calls are synchronous; Google's documentation recommends running them in a Web Worker so inference does not block the main UI thread.

Pose landmarks are useful anchors, not a dense body surface. World landmarks do not magically provide exact garment measurements or a complete watertight body mesh.

**Decision:** retain the current MediaPipe workers, instrument their latency, and use pose landmarks as constraints for a custom body proxy. Do not run duplicate pose models on every frame.

Sources:
- https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker
- https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js

### 4.2 Segmentation

Use the cheapest segmentation path that meets the task:

- Live person/body mask: existing MediaPipe segmentation, measured on the phone.
- Higher-quality still-image masks and offline asset preparation: SAM 2 is a candidate; it is not a default every-frame mobile model.
- Semantic garment parser: only if the exact code, weights and data rights are commercially cleared.

SAM 2's official code and checkpoints are Apache-2.0, but its published high-performance benchmarks are not mobile benchmarks. Use it for offline preparation, correction or occasional still processing until a mobile profile proves otherwise.

FASHN Human Parser provides 18 semantic classes, but its model card inherits the NVIDIA SegFormer licence. It must not be treated as a commercially cleared default parser. The current FASHN flat-lay route is specifically designed to avoid needing that parser.

Sources:
- https://github.com/facebookresearch/sam2
- https://huggingface.co/fashn-ai/fashn-human-parser

### 4.3 Avoid unlicensed dense body models

DensePose is useful research, but its official implementation carries a non-commercial licence. Do not put the official DensePose implementation/checkpoints in the commercial runtime without a separate commercial agreement.

SMPL/SMPL-X and related parametric human models also require a separate licence review. A research model being widely used in papers does not mean its body model or weights are commercially usable.

**Decision:** begin with an Isibuko-owned body proxy derived from landmarks and segmentation. Add a commercially cleared dense body model only if it materially improves the fit and the licence is verified.

## 5. Research: garment geometry, sewing patterns and simulation

### 5.1 GarmentCode and GarmentCodeData

This is one of the most useful discoveries for Isibuko's longer-term garment pipeline.

- GarmentCode's repository identifies its code licence as MIT.
- GarmentCodeData v2 is published by ETH Zurich under CC BY 4.0.
- The dataset describes 115,000 synthetic garment/body/material configurations across tops, shirts, dresses, jumpsuits, skirts and pants.
- It includes sewing-pattern and 3D garment information and an automated draping pipeline using XPBD.

This is valuable for generating and testing category-specific garment templates and understanding garment construction. It is **not** a ready-made real-person virtual try-on dataset, and it does not automatically turn a retailer's single flat product image into an accurate 3D garment.

Use it as a geometry/template research source with attribution and review of the dataset documentation and any upstream body-model restrictions before incorporating data into a production asset pipeline.

Sources:
- https://github.com/maria-korosteleva/GarmentCode
- https://igl.ethz.ch/projects/GarmentCodeData/
- https://www.research-collection.ethz.ch/items/9d16a4da-0d30-4963-8842-af20fcf82899

### 5.2 Rapier soft bodies

Rapier is the leading first prototype candidate for cloth physics because its project states Apache-2.0 and it has JavaScript bindings. Its JavaScript soft-body documentation includes cloth, cloth tubes, structural/shear/bending constraints, collision surfaces, kinematic particle control and deformable-body APIs.

That makes it a plausible browser-side experiment, not a proven phone solution. A real garment mesh, stable body colliders, collision tuning and performance measurements are still required.

Prototype one shirt with a coarse mesh, a low particle count, pinned shoulder/neck/side anchors, body/arm colliders and controlled damping. Compare it against a non-physics mesh warp. If the solver drops frames or jitters on the target phone, keep the deterministic mesh warp for Live Fit and move higher-quality cloth simulation to Studio/offline.

Sources:
- https://rapier.rs/docs/
- https://rapier.rs/docs/user_guides/javascript/soft_bodies/
- https://rapier.rs/docs/user_guides/javascript/soft_body_creation_and_insertion/

### 5.3 WebGPU XPBD

An MIT-licensed WebGPU XPBD cloth sample demonstrates GPU compute-based cloth simulation. It is a useful reference for a high-end path, but the repository describes a small cloth demo and its README reports testing on Chrome Dev with unsafe WebGPU flags. That is not sufficient evidence for a production mobile dependency.

Chrome has added Android WebGPU support and a compatibility mode, but browser/driver capability still varies. Feature-detect it and retain WebGL2/CPU fallbacks.

**Decision:** WebGPU is an optional accelerator, not a product requirement. The current WebGL2 path remains the fallback.

Sources:
- https://github.com/jspdown/cloth
- https://developer.chrome.com/blog/new-in-webgpu-121
- https://developer.chrome.com/blog/new-in-webgpu-146

### 5.4 What a single product photo cannot tell us

A single front image does not contain the garment's actual back, side, inner construction, thickness or reliable physical measurements. Any model that generates those unseen regions is inferring them.

For commercial fit fidelity, the product asset intake should progressively support:

- Front and back images; side images for higher-fidelity products.
- Transparent-background or accurately segmented garment image.
- SKU, category, size chart and garment measurements.
- Material/fabric metadata and stretch/stiffness metadata when known.
- Optional GLB/glTF garment mesh or sewing-pattern asset.
- Rights to display, transform and (separately) train on the supplied asset.

A generated 3D mesh from one image can be a visual approximation, but must not be represented as a verified physical garment pattern or an exact back view.

## 6. Research: image and video try-on models

### 6.1 FASHN VTON v1.5 — first still-image benchmark

The official model card states:

- MMDiT, 972M parameters.
- Pixel-space generation at 576×864.
- Supports person images plus garment images, including flat-lay product images.
- Categories: tops, bottoms and one-pieces.
- Approximately 2 GB try-on weights.
- Approximately 8 GB VRAM for inference.
- Approximately five seconds on an NVIDIA H100.
- Training description: 18M masked try-on pairs plus 4M synthetic triplets.
- Known limitations: body-shape preservation can be imperfect, garment traces may remain after long-to-short or bulky-to-slim transitions, and a dedicated GPU is recommended.

The model card and repository state Apache-2.0 for the try-on model/code. The FASHN Human Parser is a separate dependency with a different NVIDIA SegFormer licence. The flat-lay, segmentation-free route can avoid that parser.

However, the card does not publish a separate training-corpus licence/provenance statement for the 18M pairs and 4M synthetic triplets. For that reason, the repository now records FASHN as **conditional**, not fully production-cleared. It may be evaluated after the approved parser-free path is verified; legal review is required before commercial production.

It is an image model. It does not generate a stable real-time camera stream.

Sources:
- https://huggingface.co/fashn-ai/fashn-vton-1.5
- https://github.com/fashn-AI/fashn-vton-1.5
- https://huggingface.co/fashn-ai/fashn-human-parser

### 6.2 Other image try-on research

| Model | Research value | Commercial decision |
|---|---|---|
| IDM-VTON | Strong fabric/garment appearance research reference | CC BY-NC-SA 4.0; do not ship |
| CatVTON | Efficient image try-on reference; authors report under 8 GB at 1024×768 | CC BY-NC-SA 4.0; do not ship |
| Leffa | Useful pose-guided try-on reference | Code/weights/data rights diverge; not cleared |
| OOTDiffusion | Useful garment fusion research | CC BY-NC-SA 4.0; do not ship |
| Qwen Image Edit | General image editing/refinement reference | Not a dedicated SKU-preserving try-on engine; too large for live mobile |

Do not mistake a permissive code repository for permissively licensed model weights or training data.

### 6.3 Video try-on research

- **Fashion-VDM (Google Research, 2024):** useful video-diffusion architecture and temporal-training reference. Its published limitations include body-shape inaccuracies, boundary artifacts, occlusion errors and some pattern flicker. It is not a released commercial drop-in model.
- **SwiftTry (AAAI 2025):** BSD-3-Clause code and a video try-on architecture using temporal attention and ShiftCaching. Its TikTokDress dataset is restricted to research/educational use; its data and pretrained-model provenance therefore do not clear it for Isibuko commercial training.
- **CatV2TON:** supports image and video evaluation, but the official materials are CC BY-NC-SA 4.0.
- **MagicTryOn:** video diffusion and garment-preservation research, but its code, weights and demo are CC BY-NC-SA 4.0.
- **LiveVVT:** the public repository states that code is being prepared; there is no usable released implementation yet.
- **TCE-VTON (2026):** relevant temporal-consistency paper describing preprocessing, warping, video generation and human-feature injection. Treat as a research reference until its code, checkpoints and licence are independently verified.

The lesson is that video VTON is a separate problem from image VTON. It needs temporal attention/caching or explicit tracking and conditioning. Running independent still-image generations on consecutive camera frames will flicker and change garment details.

Sources:
- https://johannakarras.github.io/Fashion-VDM/
- https://github.com/VinAIResearch/SwiftTry
- https://github.com/Zheng-Chong/CatV2TON
- https://github.com/vivoCameraResearch/Magic-TryOn
- https://github.com/caoyushe/LiveVVT
- https://www.sciencedirect.com/science/article/pii/S2468502X26000239

## 7. Research: image-to-3D garment creation

Generic image-to-3D models can create a mesh from an image, but a generic object mesh is not necessarily a simulation-ready garment. A fused mesh may not contain separate front/back panels, seams, thickness, UVs or physically meaningful cloth topology.

Relevant work:

- **GarmentCode:** practical parametric sewing-pattern framework; MIT code.
- **GarmentCodeData:** large synthetic pattern/garment dataset; CC BY 4.0.
- **Dress-1-to-3 (SIGGRAPH 2025):** specifically targets simulation-ready separated garments and sewing patterns from a single image. The paper is a strong research direction, but no production-ready commercial implementation was verified in this audit.
- **GarmentCrafter (3DV 2026):** single-view garment reconstruction and novel-view generation. Its research is highly relevant, but code/weights/licensing must be confirmed before use.
- **3D Magic Mirror (2026):** interesting single-image clothing reconstruction, but the official repository says academic research use only and asks commercial users to contact the authors.
- **TRELLIS:** MIT code/model family for generic image-to-3D asset creation, but it is not a garment-pattern solver and requires substantial GPU resources. Its output must be checked for garment separability and simulation readiness.
- **Stable Fast 3D:** community licence permits commercial use under a revenue threshold, but creates a licence constraint if the company grows beyond that threshold.

**Decision:** use GarmentCode templates and merchant-supplied assets first. Keep generic image-to-3D as an offline asset-preparation experiment, not a runtime requirement or source of exact physical fit.

Sources:
- https://dress-1-to-3.github.io/
- https://humansensinglab.github.io/garment-crafter/
- https://github.com/layumi/3D-Magic-Mirror
- https://github.com/microsoft/TRELLIS
- https://huggingface.co/stabilityai/stable-fast-3d

## 8. Competitive reference: Snap, Decart, Google and Adobe

### Snap

Snap's official cloth-simulation try-on documentation describes a 3D body tracker, body mesh, cloth simulation, physics colliders and body-mesh occlusion. Its external-body-mesh feature deforms a garment mesh to the tracked body using proximity or UV matching without requiring conventional rigging.

This is the strongest public design reference for Live Fit. The code and tracking engine are not an open-source component we can simply copy. Camera Kit Web also warns that resource-heavy 3D body/hand tracking can reduce frame rate.

### Decart Lucy VTON 3.6

Decart's current public API documentation describes a real-time WebRTC camera stream with a prompt and/or garment image, 720p output, and garment switching during the session. It lists standard real-time usage at 2 credits per second and fast mode at 4 credits per second.

This is a hosted proprietary service and quality benchmark, not a free dependency. It confirms that the market is moving toward live-stream garment-conditioned video rather than static stickers.

### Google virtual try-on

Google's public shopping announcement describes a custom fashion image-generation model that understands fabric folds, stretch and drape. It is proprietary, not a downloadable open-weight model. It is a quality reference, not a component.

### Adobe

Adobe's 10 November 2026 MAX announcement introduced Photoshop Relight, Generative Restyle, related-element removal and Quick Compare, plus broader Creative Agent/Firefly workflows. These are not a released open-weight virtual try-on or cloth-simulation model.

Adobe's March 2026 Rotate Object research turns a 2D layer into a manipulable 3D-oriented object for compositing. It is not a substitute for a garment mesh, a cloth solver or a human-body tracking system.

What Isibuko can learn from Adobe:
- Non-destructive, layered refinement.
- Separate lighting/material correction from geometry.
- Editable, reversible generated changes.
- Before/after comparison and local refinement.
- Workflow automation around the model, not hidden edits to the source SKU.

Do not claim that Adobe's recent release provides free try-on weights or that it solves Isibuko's garment-wrapping problem.

Sources:
- https://developers.snap.com/lens-studio/features/try-on/cloth-simulation-try-on
- https://developers.snap.com/lens-studio/features/ar-tracking/body/external-mesh
- https://www.developers.snap.com/camera-kit/integrate-sdk/web/guides/web-considerations
- https://platform.decart.ai/models/lucy-vton
- https://blog.google/products-and-platforms/products/shopping/google-shopping-ai-mode-virtual-try-on-update/
- https://news.adobe.com/news/2026/11/adobe-transforms-creative-cloud-tools
- https://research.adobe.com/news/new-photoshop-feature-rotate-2d-objects-in-three-dimensions/

## 9. Data, training and commercial rights

### 9.1 Public datasets that must not be used for commercial training without permission

The audit found research/academic restrictions on major public fashion datasets and video try-on datasets, including:

- DressCode: non-commercial academic research, teaching and publication.
- DeepFashion: non-commercial research use.
- TikTokDress: research/educational use only.
- VITON-HD and related research try-on datasets: require separate rights review; do not assume commercial training rights.

Using a model trained on a restricted dataset may carry restrictions even when the code is permissively licensed. The model, weights, dataset and each dependency must be reviewed separately.

### 9.2 Commercially usable data plan

Use three data streams:

1. **Merchant product assets:** rights to display, crop, transform and use in a customer try-on session. This does not automatically grant AI-training rights.
2. **Isibuko-owned synthetic geometry:** GarmentCodeData and Isibuko-created templates with attribution and licence review.
3. **Consented real try-on capture:** paid/volunteer models and merchants with explicit written permission for image/video capture, garment usage, AI training, commercial training, derivative outputs, retention and deletion.

Keep product-use consent separate from model-training consent. Preserve the existing independent-review gate. Do not train on a customer's camera session by default.

### 9.3 South African privacy requirements

Isibuko processes camera images and potentially face/body information. POPIA treats biometric information as special personal information. Processing must have a valid lawful basis and the relevant special-information conditions must be assessed. Transfers of personal information outside South Africa are governed by section 72.

Engineering controls should include:
- Camera processing stays on-device for Live Fit wherever possible.
- No camera frame is uploaded just because the camera is active.
- AI Studio uploads only after a clear user action and appropriate notice/consent.
- Try-on consent is not training consent.
- Separate retention periods for raw input, generated output and diagnostics.
- Short-lived signed upload/download URLs.
- Access controls, encryption, deletion workflows and audit logs.
- Clear disclosure of any overseas inference/storage provider.
- No facial recognition or identity matching as part of clothing fit.

This is an engineering and product checklist, not legal advice; South African privacy counsel should review the production policy and contracts.

Sources:
- https://www.acts.co.za/protection-of-personal-information-act-2013/26__prohibition_on_processing_
- https://popia.co.za/section-11-consent-justification-and-objection/
- https://www.acts.co.za/protection-of-personal-information-act-2013/72__transfers_of_personal_info
- https://github.com/aimagelab/dress-code/blob/main/LICENCE
- https://mmlab.ie.cuhk.edu.hk/projects/DeepFashion/DeepFashionAgreement.pdf

## 10. Recommended Isibuko architecture

### Shared core

**Body state**
- Pose landmarks with confidence and timestamp.
- Body silhouette and foreground mask.
- Torso/limb proxy mesh.
- Smoothed orientation and movement state.
- Camera intrinsics/scale calibration where available.
- Confidence and occlusion state.

**Garment asset**
- SKU and original image hash.
- Category and size chart.
- Garment mask and part labels.
- Front/back/side views.
- UV texture and topology.
- Optional GLB/glTF mesh or sewing pattern.
- Material metadata and physical parameters where supplied.
- Separate product-use and AI-training rights records.

### Engine A — Live Fit

1. Camera stream.
2. Existing MediaPipe worker(s).
3. Segmentation and body proxy.
4. Garment topology and mesh.
5. Body-relative deformation.
6. Optional low-resolution XPBD/Rapier cloth solve.
7. Depth and occlusion compositing.
8. Three.js/WebGL2 rendering.
9. Frame-budget telemetry and adaptive quality.

Do not use a generative model in this frame loop.

### Engine B — AI Studio

1. User deliberately captures or selects a photo.
2. Validate image quality and garment category.
3. Run the approved parser-free FASHN flat-lay benchmark.
4. Record model/version, weights hash, runtime, GPU, parameters and output hash.
5. Score garment identity, wearer identity, coverage and artifacts.
6. Store the result only under the user's retention/consent settings.
7. Never label an output as physically measured size-fit.

### Unified product state

Both engines use the same SKU, garment asset, category, size data, user fit profile and provenance. The engines differ only in how they render the try-on.

## 11. What should be tested first

### Test A — Current phone baseline

Use the actual Android phone and the same shirt/product asset.

Capture:
- Frontal pose.
- 15° left/right.
- 30° left/right.
- Arms relaxed, one arm raised, arms crossed.
- Near and far distances.
- Bright and dim lighting.
- Shirt, jacket and dress.

Record:
- Camera session continuity.
- Pose/segmentation update time.
- Frame interval mean and p95.
- JavaScript work time and jank frames.
- Garment coverage and alignment.
- Hand/arm occlusion errors.
- Visual flicker and garment drift.

### Test B — Mesh warp without physics

Use a single shirt template and a triangulated surface. Keep the garment texture unchanged. Test anchor alignment, mesh folding, sleeve continuity and coverage.

If this fails, do not add cloth physics yet. Physics cannot rescue bad garment topology or poor body tracking.

### Test C — Cloth solver

Only after Test B passes:
- Compare static garment shape.
- Turn torso left/right.
- Raise and lower arms.
- Measure solver time, frame time and jitter.
- Compare Rapier/WASM with the deterministic mesh warp.
- Keep physics only if the visual improvement justifies the performance cost.

### Test D — AI Studio FASHN

Use a rights-cleared test person image and an Isibuko-owned/merchant-authorised garment image. Run a single still-image inference on a free/approved GPU environment. Record the actual GPU, precision, memory, latency, output and failures.

Do not download model weights or start a paid GPU pod until the user approves the exact environment and cost. The current service should remain in refusal mode until this benchmark is deliberately enabled.

## 12. Proposed acceptance criteria

These are targets to test, not current achievements.

| Area | Proposed target |
|---|---|
| Camera | No restart when selecting another garment |
| Live rendering | 24–30 FPS target on target Android class |
| Frame work | p95 within the measured 30 FPS budget |
| Torso coverage | At least 90% of intended garment region |
| Shoulder/neck alignment | Within 3% of torso width in the controlled test |
| Rotation | Stable through ±30° before expanding angle |
| Occlusion | Hands/arms remain in front when physically in front |
| Garment identity | Colour, print, logo and SKU details preserved |
| Temporal stability | No visible garment swimming or frame-to-frame texture flicker |
| Failure behaviour | Hide/refuse bad fit rather than show a broken garment |
| Privacy | No silent camera upload or default training reuse |

Visual quality must be scored by both automated metrics and human review. LPIPS/SSIM/FID alone cannot prove that the exact merchant garment was preserved. Add explicit logo/print and SKU-fidelity checks.

**Important:** virtual visual try-on is not a physical size guarantee. Size recommendations must be a separate measurement/size-chart function with calibrated inputs and clearly stated uncertainty.

## 13. What will fail, and why

| Approach | Expected failure |
|---|---|
| Stretching one PNG between shoulder points | Flat appearance, uncovered body, print distortion |
| Running FASHN independently on every frame | High latency, flicker, identity drift |
| Using a still-image model as a 360° cloth simulator | Invented unseen sides/back, inconsistent geometry |
| Using research-only datasets for commercial fine-tuning | Licence violation |
| DensePose official implementation in production | Non-commercial licence issue |
| FASHN Human Parser in commercial runtime | Separate NVIDIA SegFormer licence restriction |
| Full-resolution cloth simulation on every phone | Unproven frame budget, heat and battery use |
| Generic image-to-3D mesh as exact garment pattern | Fused or hallucinated geometry, no guaranteed seams/fit |
| Inferring chest/waist/hip circumference from a front photo | Measurement error; cannot promise physical size fit |
| Making WebGPU mandatory | Device/browser/driver incompatibility |

## 14. Implementation roadmap

### Phase 0 — Research and safeguards (this branch)
- Document the architecture and evidence.
- Correct FASHN's status from fully cleared to conditional pending data-rights review.
- Keep all uninstalled models out of the live registry.
- Keep camera and product flows intact.

### Phase 1 — Live garment mesh
- Build one shirt topology.
- Implement deterministic mesh deformation.
- Preserve texture and garment silhouette.
- Add stable anchors and occlusion.
- Run real-device comparison against the current quad.

### Phase 2 — Body proxy and multi-category topology
- Add better torso depth/orientation.
- Extend to jackets and dresses.
- Add trousers/skirts only after full-body camera coverage works.
- Build garment asset validation and merchant intake.

### Phase 3 — Physics experiment
- Prototype Rapier soft-body cloth.
- Benchmark low-resolution mesh on target Android and desktop.
- Retain only if it improves the fit without unacceptable frame drops.

### Phase 4 — AI Studio still benchmark
- Approve/download FASHN weights only after licence review.
- Use the isolated parser-free flat-lay route.
- Run one controlled test on an approved GPU.
- Compare against Decart/Perfect Corp only if free test access and privacy terms are acceptable; do not create a production dependency.

### Phase 5 — Unified experience and commercial readiness
- Share garment identity/size/profile across engines.
- Add consent, retention, deletion and merchant rights workflows.
- Complete POPIA and cross-border data review.
- Add monitoring, cost controls and model-version records.

---

## 15. Final technical recommendation

**Build the Live Fit engine as a custom body-relative mesh renderer. Build AI Studio as a separate still-image generative service. Share the garment intelligence, not the rendering implementation.**

The fastest credible route to a better Isibuko is:

1. Measure the current phone's frame budget.
2. Replace the single garment quad with a category-aware triangulated shirt surface.
3. Use body landmarks and segmentation to deform the surface.
4. Add correct arms/hands occlusion and temporal smoothing.
5. Validate ±30° rotation.
6. Only then experiment with a cloth solver.
7. In parallel, validate one FASHN still-image output on an approved free GPU.

This is a more realistic path than training a video diffusion model from scratch. It also preserves control of the SKU, the camera experience, the commercial licence and the cost structure.

## 16. Research references by topic

### Live body tracking and cloth
- MediaPipe Pose Landmarker: https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker
- Snap External Body Mesh: https://developers.snap.com/lens-studio/features/ar-tracking/body/external-mesh
- Snap Cloth Simulation Try-On: https://developers.snap.com/lens-studio/features/try-on/cloth-simulation-try-on
- Rapier soft bodies: https://rapier.rs/docs/user_guides/javascript/soft_bodies/
- WebGPU XPBD cloth: https://github.com/jspdown/cloth

### Garment construction and 3D
- GarmentCode: https://github.com/maria-korosteleva/GarmentCode
- GarmentCodeData: https://igl.ethz.ch/projects/GarmentCodeData/
- Dress-1-to-3: https://dress-1-to-3.github.io/
- GarmentCrafter: https://humansensinglab.github.io/garment-crafter/
- TRELLIS: https://github.com/microsoft/TRELLIS

### Virtual try-on
- FASHN VTON 1.5: https://github.com/fashn-AI/fashn-vton-1.5
- FASHN model card: https://huggingface.co/fashn-ai/fashn-vton-1.5
- SwiftTry: https://github.com/VinAIResearch/SwiftTry
- CatV2TON: https://github.com/Zheng-Chong/CatV2TON
- MagicTryOn: https://github.com/vivoCameraResearch/Magic-TryOn
- Fashion-VDM: https://johannakarras.github.io/Fashion-VDM/
- Decart Lucy VTON: https://platform.decart.ai/models/lucy-vton

### Licensing and privacy
- FASHN Human Parser: https://huggingface.co/fashn-ai/fashn-human-parser
- DressCode dataset licence: https://github.com/aimagelab/dress-code/blob/main/LICENCE
- DeepFashion release agreement: https://mmlab.ie.cuhk.edu.hk/projects/DeepFashion/DeepFashionAgreement.pdf
- POPIA section 26: https://www.acts.co.za/protection-of-personal-information-act-2013/26__prohibition_on_processing_
- POPIA section 72: https://www.acts.co.za/protection-of-personal-information-act-2013/72__transfers_of_personal_info

---

**Status at the time of this report:** research and code audit complete for the first architecture decision; no new AI weights downloaded; no paid GPU started; no production deployment; no claim of a successful generative try-on output. The live camera has been observed working on the user's phone, while garment wrapping remains a known failed acceptance test.
