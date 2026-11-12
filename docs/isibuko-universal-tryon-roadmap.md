# Isibuko universal virtual try-on roadmap

## Product direction

Isibuko is a multi-category virtual try-on platform. The shirt mesh in Phase 1 is a first garment implementation used to validate body-constrained geometry, texture mapping, segmentation, occlusion and mobile rendering. It is not the product boundary and must not become a shirt-only architecture.

The target is one fitting platform with category-specific fitting models. Garments and accessories must not be forced through one generic shape or one generic overlay.

## Category coverage

| Category | Target fitting representation | Main tracking / fit signals |
| --- | --- | --- |
| T-shirts, polos, shirts, blouses | Torso garment mesh; sleeve panels where applicable | Shoulders, chest, waist, hips, elbows, wrists |
| Hoodies, sweaters, jackets, coats | Layered torso mesh with category-specific collar, hem, cuffs and sleeve volume | Shoulders, chest, waist, hips, elbows, wrists |
| Dresses, jumpsuits | Full upper/lower-body garment mesh with silhouette-specific panels | Shoulders, chest, waist, hips, knees, ankles |
| Trousers, jeans, leggings | Left/right leg panels with waist and inseam structure | Waist, hips, knees, ankles |
| Shorts | Waist/hip mesh with independent upper-leg panels | Waist, hips, knees |
| Skirts | Waist-anchored panel mesh with length and flare controls | Waist, hips, knees/hem |
| Hats and wigs | Head-anchored, head-pose-aware fitting | Face/head landmarks, head pose, hair segmentation |
| Glasses | Rigid face-anchored fitting | Eye/temple/nose landmarks, head pose |
| Earrings, necklaces | Landmark/pose-anchored accessories with occlusion | Ears, neck, shoulders, face and hair masks |
| Watches, bracelets, rings | Hand/wrist/finger-anchored fitting | Hand landmarks, wrist and finger geometry |
| Nails | Per-nail geometry and surface alignment | Fingertip and nail landmarks |

## Catalogue taxonomy notes

The current `Category` union has canonical buckets rather than every retail subtype. T-shirts, polos, shirts and blouses currently map to `shirt`; hoodies, sweaters, jackets and coats map to `jacket`; jeans, trousers and shorts map to `pants`; jumpsuits map to the one-piece `dress` family until the catalogue needs a separate first-class subtype. Product cut, sleeve length, garment length and silhouette should be represented as product metadata rather than guessed from the category name. Add a first-class category only when the catalogue and renderer both need distinct routing.

## Shared fitting pipeline

Every category should use the same high-level pipeline:

1. Identify the selected product category and its fitting profile.
2. Acquire only the landmarks and segmentation classes needed by that profile.
3. Build or update category-specific geometry from tracked body/face/hand anchors.
4. Map product imagery using an explicit asset/UV convention; do not assume every catalogue image is a texture atlas.
5. Render with depth/segmentation-aware occlusion, camera lighting and stable temporal smoothing.
6. Fall back safely when tracking, assets or device performance are insufficient.
7. Report fit confidence and missing measurements honestly; visual alignment is not a guarantee of physical size fit.

## Engineering rules

- Keep camera/session handling and existing working mobile camera behaviour independent of garment-category work.
- Keep the CPU-capable path viable; GPU acceleration is optional, not a prerequisite for basic try-on.
- Do not apply the shirt mesh to trousers, skirts, dresses or accessories simply by changing a category string.
- Separate reusable mesh primitives from category-specific topology, anchors, deformation constraints and texture layouts.
- Preserve legacy renderers as controlled fallbacks until each replacement category passes its own tests and device checks.
- Add geometry, UV, tracking-loss, occlusion, orientation and performance tests per category.
- Validate with varied body shapes, skin tones, garment cuts, camera angles, lighting and movement before promoting a category.
- Keep fit estimation (measurements/sizing) distinct from visual overlay quality.

## Delivery sequence

### Phase 1 — Shirt foundation
Validate torso mesh and sleeve panels on real phones, including tracking stability, texture alignment, hand/face occlusion, rotation and recovery after tracking loss.

### Phase 2 — Shared garment primitives
Extract reusable torso, sleeve, waist, hip and limb-panel primitives plus a category-profile registry. Keep category-specific constraints explicit.

### Phase 3 — Lower-body garments
Implement trousers/jeans, shorts and skirts with independent leg/panel geometry and knee/ankle tracking.

### Phase 4 — One-piece and layered garments
Implement dresses/jumpsuits and outerwear with category-specific silhouettes, hems, collars and layering/occlusion rules.

### Phase 5 — Accessories
Upgrade head-, face-, ear-, neck-, wrist- and finger-anchored products with appropriate rigid or surface-following representations.

### Phase 6 — Fit intelligence and catalogue readiness
Connect product sizing/material metadata, calibrated body measurements where available, fit confidence and robust catalogue asset validation.

## Current scope

The current Phase 1 pull request implements the shirt mesh only. The roadmap defines the platform direction; the other categories are future work and are not claimed to be implemented by this pull request.
