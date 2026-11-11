# Isibuko Generative AI — Build Blueprint

**Status:** implementation blueprint; no model weights or training run are claimed.
**Branch:** `ai/isibuko-generative-foundation`
**Product objective:** replace approximate photographic overlays with product-faithful, photorealistic virtual try-on that can ultimately run as a continuous live experience and embed in merchant websites.

## 1. Product acceptance standard

A result is not accepted because a product image is positioned over a camera frame. The selected merchant product must look worn by the shopper.

For every supported category, acceptance requires:

- Preserve the shopper's identity, face, skin, body shape, and all regions outside the intended edit.
- Preserve the selected SKU's recognisable design, colour, print, cut, and important details. Do not silently substitute a similar product.
- Respect pose, perspective, lighting, occlusion, and body boundaries.
- Avoid sticker edges, rectangular cut-outs, cartoon geometry, floating objects, and visible seams.
- For video, maintain identity, garment identity, geometry, and temporal stability across frames while the person moves.
- Degrade honestly when the input product asset, camera view, or model cannot support a reliable result.

The current MediaPipe + WebGL compositor remains a temporary preview/fallback and tracking source. It is not the target generative renderer.

## 2. Build in stages — do not attempt a frontier video model first

### Stage 0 — Separate the product layers

Create stable contracts between:

1. Merchant catalogue and product assets.
2. Camera capture and on-device perception.
3. Try-on conditioning and model routing.
4. Image/video inference.
5. Temporal stabilisation and output compositing.
6. Merchant embed, consent, analytics, and billing boundaries.

The mirror must not depend directly on one model vendor. All inference must go through a typed adapter with explicit capabilities, licence metadata, latency class, data route, and failure state.

### Stage 1 — Establish a realistic still-image baseline

Start with one category: **upper-body garments (shirts and tops)**.

Benchmark a commercially usable, reproducible image try-on baseline before attempting live video. FASHN VTON v1.5 is a candidate previously identified in the project notes, but its exact code, weights, training-data provenance, attribution, redistribution, and production terms must be re-verified from primary sources at implementation time. No model is approved merely because its code is Apache-2.0.

Benchmark on a fixed, rights-cleared evaluation set:
- Person image.
- Exact merchant garment image.
- Garment mask / category metadata.
- Ground-truth worn image where rights permit.
- Pose and occlusion labels.

The still-image baseline must demonstrate product identity and human identity preservation. If the chosen baseline changes logos, prints, garment cut, or colour materially, it is not acceptable as the merchant product renderer.

### Stage 2 — Isibuko conditioning and control

Build original Isibuko-owned conditioning and control around the selected baseline:

- SKU identity and immutable product asset reference.
- Garment category, cut, fabric, colour, print, and variant metadata supplied by the merchant.
- Person identity reference and protected regions.
- Pose, body parsing, garment mask, hands, and occlusion signals.
- Explicit edit mask and preservation mask.
- Reproducible inference settings and model/version identifiers.

Keep source frames local by default. If a model requires server inference, require a separate, explicit consent step and disclose the provider, transfer, retention, and session limits before sending any frame. Never silently route camera frames to a vendor.

### Stage 3 — Temporal video try-on

Only after the still baseline passes, add temporal consistency. The video system must use a stable garment condition across the whole clip and account for motion between frames.

Evaluate:
- Identity drift outside the garment.
- SKU / print / colour drift inside the garment.
- Temporal flicker.
- Boundary and occlusion errors.
- Motion lag and recovery after fast movement.
- End-to-end latency, throughput, and memory on named hardware.

Do not claim real-time performance based on offline clip generation or a vendor's advertised benchmark. A model that takes seconds per still is not a live video model.

### Stage 4 — Proprietary Isibuko model

Build proprietary capability incrementally from rights-cleared data and measurable gaps:

- Own data specification, consent and rights ledger.
- Own preprocessing, masks, pose/occlusion labels, evaluation sets, and training/evaluation code.
- Fine-tune/adapt only a base model whose weights and training/data terms allow the intended commercial use.
- Keep an independent model card and provenance record for every checkpoint.
- Train a smaller, faster student only after quality is demonstrated by a larger baseline.
- Consider training a video temporal module before attempting to train an entire generative foundation model.

“Isibuko AI” means Isibuko owns the orchestration, conditioning, datasets it has rights to, evaluation, training pipeline, and resulting original weights where applicable. It must not be used to misrepresent third-party weights as Isibuko-owned.

## 3. Initial category order

| Priority | Category | First credible milestone | Special challenge |
| --- | --- | --- | --- |
| P0 | Shirts / tops | Realistic still try-on with SKU fidelity | Garment boundaries, sleeves, hands, print preservation |
| P1 | Dresses / jackets | Still try-on with category-specific masks | Variable length, layered clothing, sleeves |
| P2 | Trousers / skirts | Full-body still try-on | Lower-body pose, legs, occlusion, full-body framing |
| P3 | Wigs / hairstyles | Identity-preserving hair replacement | Hairline, strand detail, silhouette, head turns |
| P4 | Glasses / hats | Perspective-aware try-on | Head pose, reflections, occlusion |
| P5 | Jewellery / watches / rings / nails | Fine-detail try-on | Hand/finger landmarks, small-object tracking |

Do not mark a category supported merely because its button or catalogue entry exists.

## 4. Data and rights requirements

Every training/evaluation asset must carry:

- Stable asset and person identifiers (pseudonymous).
- Rights status: Isibuko-owned or commercially licensed.
- Written scope of consent: collection, processing, model training, evaluation, retention, and commercial use.
- Source and licence document reference.
- Product SKU and exact merchant asset version.
- Capture device, resolution, frame rate, lighting, camera view, and timestamps.
- Person/garment masks, pose landmarks, hand masks, and occlusion labels where required.
- Split assignment (train, validation, test) by person and SKU to prevent leakage.

Never use customer camera sessions for training by default. Training opt-in must be separate from try-on consent. Exclude unknown, research-only, scraped, or incompatible assets. Keep a deletion and consent-withdrawal process.

### Minimum shirt capture protocol

For a controlled, rights-cleared sample:
- One participant, one exact garment SKU, and a separate clean product reference.
- Front, left/right quarter turns, and return to front.
- Arms relaxed, raised, crossed, and lowered.
- Consistent lighting and camera framing.
- Several garment sizes and body shapes over time.
- A corresponding garment mask and hand/arm occlusion labels.
- Multiple participants and SKUs before claiming generalisation.

A small capture set is a pilot dataset, not enough to claim a production model.

## 5. Model adapter contract

Implement one stable adapter contract for all inference engines. Each adapter must declare:

- `id`, `version`, `owner`, `licence`, `commercialStatus`.
- Supported categories and input resolutions.
- Still-image or video capability.
- Local or remote processing and data-transfer disclosure.
- Required input assets and conditioning.
- Whether weights are actually present.
- Hardware requirements and measured latency metadata.
- `generateStill` and/or `generateClip` capability.
- Typed failures: not installed, missing weights, invalid input, unsupported category, consent required, unavailable hardware, timeout, provider error.

The adapter must return generated media plus provenance metadata, not silently fall back to the WebGL compositor. The UI must label preview compositing separately from generative output.

## 6. Evaluation gates

No stage advances without recorded results on a fixed, held-out evaluation set.

| Gate | Required evidence |
| --- | --- |
| G0 — rights | Every asset has verified commercial rights and required consent |
| G1 — still quality | Side-by-side review and automated identity, garment, colour, and boundary metrics |
| G2 — product fidelity | SKU, print, logo, cut, and colour reviewed against exact source asset |
| G3 — temporal quality | Moving-person clips with identity drift, flicker, occlusion and garment consistency scores |
| G4 — live performance | End-to-end camera-to-display latency and sustained FPS on named target devices |
| G5 — merchant embed | Tested on independent merchant origins, consent, CSP/CORS, mobile, and product feeds |
| G6 — production readiness | Security, privacy, monitoring, cost limits, graceful degradation and rollback |

Synthetic fixtures test code paths only. They never count as model-quality evidence.

## 7. Merchant integration target

Design the embed as a separately versioned client SDK / web component with:
- Merchant ID and origin allowlist.
- Product/SKU payload or catalogue API.
- Signed, short-lived session configuration.
- Camera consent controlled by the shopper.
- Responsive modal/inline mirror.
- Product variant updates without camera restart.
- Explicit provider disclosure if remote inference is selected.
- No merchant secret or permanent model key in browser code.
- CSP/CORS and abuse controls.
- A documented fallback when browser/device capability is insufficient.

Do not build a scraper as the primary product integration. Prefer merchant-provided product feeds, APIs, or a documented product payload.

## 8. Compute and cost policy

No paid GPU, paid inference API, model download with a fee, or cloud training job may be started without explicit approval.

Before any run:
1. Record model and licence.
2. Estimate dataset size, GPU memory, runtime, storage, and expected cost.
3. Run a tiny smoke test on free/local resources where feasible.
4. Define a hard spend cap and shutdown procedure.
5. Save checkpoints and logs to approved storage only.

A local or free environment can build the pipeline and run small tests; it does not prove that a large model can be trained there.

## 9. Immediate implementation backlog

1. Create `src/lib/isibuko-gen/contracts.ts` with model, capability, provenance, consent, request, result, and typed error contracts.
2. Create a registry that refuses to register a model as available unless its weights and runtime are verified.
3. Add an explicit `preview-composite` vs `generative` render mode. Never silently substitute one for the other.
4. Create a reproducible still-image benchmark command and a manifest format for rights-cleared person/product pairs.
5. Add a model-card/provenance record for every candidate and re-verify primary licences before install.
6. Build the P0 shirt still-image adapter and evaluation harness without wiring an unapproved paid provider into the live camera.
7. Keep the existing live camera and MediaPipe tracking isolated so it can later supply conditioning to the generative engine.
8. Add merchant embed/API design after the model request/response contract stabilises.

## 10. Definition of “Isibuko AI is alive”

The AI is not considered alive when a registry entry exists, a mock returns success, a still is composited, or a model card is displayed.

The first meaningful milestone is:
- A real, rights-cleared person image and exact merchant shirt asset are passed to an installed model.
- The model returns a new, photorealistic worn image.
- The result preserves the person's identity and the exact product sufficiently to pass human review and the evaluation gate.
- The output is saved with model/version/provenance metadata and can be reproduced.

The next milestone is a short moving-person clip with the same garment identity across frames. Only after that should the team pursue a continuous live mirror.

---

**Current state reminder:** the repository's existing `isibuko.shirt-diffusion` architecture is designed but untrained; its runner deliberately returns no image. This blueprint does not change that fact and does not authorise any paid service or training run.
