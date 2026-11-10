# Isibuko Live AI — independent engine architecture

## Product goal

Build an independently owned virtual try-on intelligence and inference platform. Decart/Lucy is a quality and latency benchmark, not a runtime dependency. Isibuko must not call Decart APIs or require Decart models.

Independence means Isibuko owns its product schema, preprocessing and postprocessing, preservation and consistency evaluation, interaction layer, inference orchestration, deployment and eventually its fine-tuned and trained model weights. Permissively licensed open research and model components may accelerate early development after license and deployment review. We do not need to train a frontier video model from random initialization on day one.

## Experience modes

1. **Photo try-on:** the shopper explicitly selects or captures one still image, selects a real merchant product image and submits one image-processing request. Return one edited still. In this mode no live camera stream is sent. Camera permission does not imply permission to upload.
2. **Tracked 3D try-on:** local face, hand and body tracking plus product geometry, anchors, occlusion and physics. This remains useful when a product has a suitable 3D asset.
3. **Generative live try-on:** continuous frames with identity, product and background consistency, low latency and explicit interaction conditioning. This requires a genuine video-capable model/session. A photo endpoint must never be presented as live video.

## Shared photorealism standard

The same visual quality bar applies to wigs, nails, jewellery, clothing, hats, glasses, footwear and accessories. Product-specific fitting and material logic differs, but every category must preserve the shopper's identity, fit correctly, respect depth and occlusion, respond consistently to movement and avoid cartoon-like placeholder rendering.

## Engine boundaries

- **Product asset service:** merchant SKU, original product photographs, category, rights metadata, optional 3D asset, masks/regions and fitting metadata.
- **Input preparation:** image validation, orientation correction, resolution limits, person/region detection and category-specific masks.
- **Try-on model adapter:** provider-neutral contracts in `src/lib/live-ai/contracts.ts`. Model providers are replaceable and report actual capabilities.
- **Preservation evaluator:** identity similarity, protected-region change, product fidelity and background preservation. Report measured signals; never claim preservation merely because it was requested.
- **Temporal engine:** later video-frame conditioning, identity/reference memory, temporal consistency checks and motion-aware refinement.
- **Inference scheduler:** queues, cancellation, GPU selection, batching, model warm pools, timeouts, retries and cost/latency telemetry.
- **Interaction controller:** pinch/grab/touch events become spatial controls. For generative video, controls condition the model; for 3D assets, they drive local physics.

## Privacy and rights

- A still image is uploaded only after a clear user action and explicit consent for the stated try-on purpose.
- Camera permission is not consent to stream or store video.
- Do not persist source photos or derived face/body embeddings by default. Define short-lived processing retention and document exceptions before launch.
- Do not train on shopper images without separate, optional, informed opt-in.
- Record merchant product rights and model/data licenses.
- Avoid identity-changing edits outside the selected product region. Report uncertainty and failure rather than silently returning a misleading result.

## First engineering sequence

1. Establish provider-neutral request/result contracts, explicit consent and product-rights validation. **Added in this branch.**
2. Benchmark the current photo transformation path using a fixed evaluation set, beginning with wigs across hair textures, protective styles, skin tones, lighting, head angles and occlusion. Measure identity preservation, hairline fit, edge quality, product fidelity, latency and failure rate.
3. Implement a self-hostable photo-model adapter behind the contract; compare candidate open models only after license, GPU memory, image quality and latency review.
4. Build repeatable evaluation and regression tests before fine-tuning.
5. Add video only after a model demonstrates temporal stability and acceptable end-to-end latency.
6. Fine-tune Isibuko-owned weights on licensed and consented product/try-on data, retaining dataset and model provenance.

## Current implementation status

The initial provider-neutral contracts and validation guards are in place. This does not yet include a generative model, GPU worker, photo endpoint or live video model. The existing Three.js/MediaPipe mirror remains a separate deterministic try-on path.
