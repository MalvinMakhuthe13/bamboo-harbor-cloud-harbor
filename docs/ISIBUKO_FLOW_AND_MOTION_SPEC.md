# Isibuko Flow and Motion Standard

Flow and motion are core product requirements, not polish work deferred until after visual quality.

## 1. Shopper journey

The experience should feel continuous and low-friction:

1. Enter the merchant's Isibuko mirror from a product page or category.
2. Browse real merchant product photography with texture, colour, style, size and price metadata.
3. Choose a sample shopper or explicitly activate the camera.
4. Preview the selected product. In photo mode, the shopper explicitly chooses/captures one still and consents to that single image being processed. In live mode, the UI must clearly identify whether processing is on-device or uses an encrypted video session.
5. See a clear loading/progress state and preserve the selected product while processing.
6. Inspect the result, change variants or products without restarting the whole experience.
7. Save, compare, share or return to the merchant product page.
8. Recover gracefully from camera denial, model failure, network loss, unsupported products and low-confidence fits.

Never imply that a still-photo request is a live camera stream. Never silently upload video in photo mode. Switching product should not unexpectedly reset camera permission, shopper selection or the current viewing position.

## 2. Motion principles

- **Continuity:** no visible snapping, popping, scale jumps or sudden identity/background changes between frames.
- **Low perceived latency:** tracking and interaction should respond immediately; heavier generative refinement may follow progressively without losing alignment.
- **Stable attachment:** product roots and anchors remain attached to the correct anatomical locations as the person moves.
- **Inertia:** hair, cloth and jewellery respond to acceleration and settle naturally rather than moving as rigid stickers.
- **Interaction continuity:** a grabbed object follows the hand while held, remains attached at the selected point, and inherits believable release velocity.
- **Occlusion and depth:** front/behind relationships update as body parts and products cross one another.
- **Graceful tracking loss:** briefly predict through small landmark dropouts, then ease back to measured tracking; do not teleport to stale coordinates.
- **Frame-rate resilience:** motion must remain stable across variable device frame rates and must not accumulate unbounded simulation time after a stalled frame.
- **Reduced motion:** respect the operating system preference without breaking tracking, fitting or direct manipulation.

## 3. Category-specific physical behaviour

| Category | Attachment and motion requirements |
|---|---|
| Wigs and hair | Hairline/crown/temples anchored to head; strand groups move with head acceleration; hand can select a local section; roots stay attached; release has inertia, gravity, collision and settling. |
| Nails | Each nail remains aligned to its nail bed and finger orientation; no sliding during finger articulation; perspective and occlusion follow hand rotation. |
| Rings | Attached to the correct finger segment; rotate with the finger and remain stable during flexion. |
| Watches and bracelets | Follow wrist pose and roll; maintain scale and contact; loose jewellery may rotate or swing with bounded inertia. |
| Earrings and necklaces | Correct attachment points; pendulum/swing response follows head and torso movement; chains/beads preserve length and collision constraints. |
| Glasses and hats | Stable face/head anchors with correct depth, rotation and occlusion; no floating during head turns. |
| Shirts and jackets | Shoulder, neckline, chest and torso anchors; fabric deformation follows pose; folds respond to motion and material/ease. |
| Trousers and skirts | Waist/hip/leg anchors; deformation follows hip, knee and leg articulation; garment must not slide independently of the body. |
| Footwear | Stable heel, toe and ankle alignment; follows foot orientation and ground-facing perspective. |

## 4. Generative temporal consistency

For live generative try-on, each frame must be conditioned on stable person/product references and recent temporal context. The model must preserve:

- Face and identity outside the intended product edit.
- Body proportions, pose and camera viewpoint.
- Product identity, colour, pattern, texture and design details.
- Background and lighting unless the shopper explicitly requests a scene change.
- Temporal continuity of edges, hairline, garment seams, jewellery and occlusion.

A one-frame photorealistic result is not evidence of a successful live model. Evaluate clips, not only still images.

## 5. Interaction state model

Interactions should have explicit states:

- idle — no active manipulation.
- hover — a valid product region is under the hand/pointer.
- pressed — pinch/touch begins and target is being confirmed.
- dragging — selected local region follows the hand.
- releasing — release velocity is transferred to the simulation.
- settling — physical motion decays until stable.
- lost — tracking confidence is insufficient; hold/predict briefly, then release safely.

The state machine must prevent accidental target switching mid-grab. A product change or category change must explicitly end the current interaction.

## 6. Quality gates

A feature is not ready because it renders once. Test:

- Slow and fast head turns, nods, tilts and partial profile views.
- Walking or torso movement where the category supports it.
- Hands entering/exiting frame, crossing the face, pinching, dragging and releasing.
- Short landmark dropouts and temporary camera stalls.
- 24, 30 and 60 FPS playback where device capability allows.
- Mobile portrait, mobile landscape and desktop layouts.
- Product switching while the camera is active.
- Reduced-motion settings and low-performance devices.

Track objective metrics: frame time, dropped frames, landmark confidence, anchor error, temporal flicker, identity similarity, product fidelity, interaction target stability, release settling time and end-to-end inference latency.

## 7. Current implementation notes

The existing deterministic Three.js engine already includes MediaPipe face/hand/pose tracking, wig strand simulation, pinch-based grabbing, necklace/shirt interaction paths and garment deformation. Treat these as valuable starting points, not proof that all categories meet the standard. Audit and integrate them incrementally; do not replace them wholesale without regression evidence.

The independent generative model path must be evaluated separately from deterministic 3D tracking. The long-term product may combine both: generative appearance with tracked spatial anchors and interaction signals.
