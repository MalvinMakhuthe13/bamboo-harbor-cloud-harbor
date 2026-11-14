# Isibuko release candidate

Branch `build/isibuko-decart-inspired-live-experience`. This is an engineering record. It is not a claim that a generative model has been trained, and it is not a claim that a person was filmed.

## What existed before this work

- An on-device mirror: explicit camera, classic MediaPipe workers, WebGL composite, product and colour changes that do not restart the camera.
- A house catalogue for shirts, coats, dresses, trousers, wigs, glasses, hats, earrings, necklaces, watches, rings, and nails.
- A camera-test panel with separate picture and inference rates.
- A shirt experiment that validates a training contract and refuses to generate.
- An older try-on studio, still at `/studio`, not used as the live mirror.

## What changed

- Skirts are a clothing region from the waist toward mid-thigh, with no sleeves. Bracelets are a narrower band past the wrist, not a watch face. Neither has a house photograph. The wardrobe can add one.
- The wardrobe checks magic bytes, not the file name. JPEG, PNG, and WebP only, at most 1.5 MB. Private, credentialed, decimal-IP, and local IPv6 links are refused. The file stays in this browser. The catalogue stops at 24 custom pieces. Nothing is fetched from the merchant URL.
- A product-condition record names the sku, cut, and the limits of a photograph. The hand-back payload includes it.
- Camera session rules: a second start does not open another stream, a product change does not mint a session, Stop releases the tracks, a hidden tab skips inference without disposing the models, and an ended camera track is reported instead of left open. Permission errors are specific.
- A tracked hand is not painted over, including where it crosses a garment.
- Segmented hair outside the protected face is cleared to a sampled backdrop before the wig plate is drawn. The plate is still the merchant photograph. It is not a generated haircut.
- Piece-change time is the time until that photograph is bound for a draw. A colour change that lands in the same frame is reported as under 1 ms, not as a made-up latency.
- A model adapter seam. Both adapters return no image. The mirror does not call them to paint.
- Production preview was serving tracker binaries with on-the-fly Brotli and labelling wasm as `application/octet-stream`. The browser download never finished, so the built mirror stayed on "tracker is still loading" while the picture moved. Preview now sends those files uncompressed and labels wasm `application/wasm`. Deployed responses set the same wasm content type.

Nothing was removed from the live composite. The older `/studio` page was left in place.

## Geometric fit on this line

The live picture is still MediaPipe tracking plus a WebGL composite of the product photograph. It is not cloth simulation and it is not a generative frame.

- Torso width at the chest, waist, and hip follows the pose and the segmentation mask, and a portrait that loses the hips keeps the last torso length instead of pulling the collar down.
- A stated sleeveless, short, or long cut decides whether sleeve triangles are built. Clothes pixels on a bare arm are filled with a neighbouring body-class colour from the same frame. That fill is not a reconstructed arm.
- Landmark smoothing takes a larger step while the body is moving and a smaller step while it is still. The hem takes a small lateral offset from shoulder velocity and tilt, then settles. Fold shading and a webcam colour cast stay inside the garment shader, with a darker band at the collar and hem.
- A wig plate is clipped to the hair class so the rectangular photograph does not sit on the background as a box. Hats, glasses, earrings, necklaces, watches, bracelets, rings, skirts, trousers, dresses, and nails use the same steadier landmarks.
- `readyForModel` stays false. No weights are downloaded. Camera frames still do not leave the browser.

## Category matrix

| Category | In the mirror | What it actually does | Not true |
| --- | --- | --- | --- |
| Shirts, coats | Yes, house photos | Replaces segmented torso and, for sleeves, the arms. A tracked hand stays the camera | Not a drape or a diffusion frame |
| Dresses | Yes | Same body replacement, longer, no extra sleeves | Not cloth simulation |
| Trousers | Yes | Waist to ankle when the legs are in frame | A chest-up photo cannot show them |
| Skirts | Yes, studio sample drawing | Waist to mid-thigh, no sleeves. The drawing is not a merchant photograph | Not validated on a person. Not cloth simulation |
| Hair | Yes, three plates | Clears segmented hair outside the face, then draws the plate | Not a new hair mesh. Backdrop fill is approximate |
| Glasses, hats, earrings, necklaces | Yes | Landmark sprites | Approximate scale, not a scan |
| Watches | Yes | Sprite on the wrist pose | Needs the wrist in frame |
| Bracelets | Yes, studio sample drawing | Narrower band further along the forearm than the watch. The drawing is not a merchant photograph | Not validated on a person |
| Rings, nails | Yes | Finger landmarks and nail tint | Needs a visible hand. Hands were 0 on the studio still |

## Functional, partial, prototype

Fully working in this build, on the studio photograph and by the session rules:

- Opening the mirror, refusing a missing camera with a specific error, and using the labelled studio photograph only when the shopper chooses it.
- Wearing a house shirt, coat, dress, wig, glasses, hat, or jewellery photograph while tracking runs off the paint loop.
- Switching product, colour, and size without a new camera session.
- Stop, then a second start, which mints a new session.
- Adding a JPEG, PNG, or WebP in the wardrobe and trying that sku from a same-app link. A third-party iframe was not tested.

Partial:

- Fit is an ellipse from pose breadth. Depth is assumed. The screen says so.
- Segmentation is reused between slow passes. A fast turn can be ahead of the mask.
- Pose may be cropped, with a full frame on a fixed beat.
- Hair, glasses, and jewellery are anchored plates. Hair clearance is a class mask, not a grown silhouette.
- The GPU tracker is optional and returns to CPU if one pass exceeds 1.8 s. It was not re-measured on real GPU hardware.

Prototype:

- `isibuko.shirt-diffusion` is an architecture, a dataset validator, and an evaluation function. No weights. No training. The lab says so.
- The adapter interface does not produce pixels.
- External video models were compared and not installed.

## Credentials, payment, data, training

- No API key, no Decart, no xAI, no paid GPU, no paid download.
- A production generative shirt still needs owned or commercially licensed pairs, an approved training run, and a checkpoint that returns worn frames.
- FASHN VTON v1.5 is Apache-2.0 and image-only. Wan 2.1 is Apache-2.0 video and not a try-on model. Leffa’s code is MIT and its weights are not commercially cleared. None are installed.
- `DATABASE_URL` is unused by the mirror. Auth is off. There is no upload endpoint, so there is no server rate limit. The browser cap is 24 custom pieces.

## Performance

Environment: headless Chromium, software WebGL, CPU delegate, the bundled studio photograph (a still person, chest-up), 10 Nov 2026. Not a phone. Not a webcam. Not a Decart comparison. `getUserMedia` returned `NotFoundError`.

Development server, after the session and hair work, one pass through hair, glasses, nails, a shirt colour, and another shirt:

- Picture 7–10 fps. Composite 0–1 ms, because the still is uploaded once.
- Face found, 3–5 Hz, 127–174 ms. Pose 2–5 Hz, 146–253 ms. Both shoulders, both elbows. Wrists 0 of 2. Hands 0.
- Segmentation last pass 502–1405 ms. The mask is reused; several windows showed 0 new masks with the mask 770–1386 ms old.
- Session stayed 1 across those changes. Stop returned the camera gate. The next studio start was session 2.
- Honey bob bound in 210 ms. Black silk bound in 225 ms. Those are the times until the photograph was on the GPU, not a script's wait. The Ink colour change landed in the same frame and is reported as under 1 ms.
- JS heap about 37 MB. That is `performance.memory.usedJSHeapSize`, not GPU memory, and not a phone.
- No page errors. No request for `vision_wasm_internal.js?import`. Wasm, the vision bundle, and three classic workers returned HTTP 200.

The same environment, production build, after the wasm content-type and compression fix:

- The wasm file reached the page in 285 ms, `application/wasm`, no content-encoding.
- Picture 9 fps. Face found, 4 Hz, 227 ms. Pose 4 Hz, 135 ms. Both shoulders, both elbows. Status stayed "Studio photograph for testing only. This is not your camera."

Before that fix, the production build painted at about 7 fps and the tracker stayed on "still loading" for more than 25 s, because the wasm body never finished. That failure is not a guess.

Motion on the still read "still" after a two-sample gate. An earlier single-sample reading said "moving" from landmark jitter. That was not a person moving.

## Tests

Passed here:

- `npx tsc --noEmit`
- Isibuko node tests, invoked directly: 39 tests, 0 failures. They cover placement, fit, the schedule, the camera session, privacy, the merchant draft, the adapter refusal, the shirt foundation, and the shirt experiment.
- `npm run build`

`npm test` on this line runs the script suite and then the node suite. The eight OG-card injector cases named below pass here. They were not weakened and they were not skipped. Four other script tests are skipped by their own guards. The names that used to fail on an earlier record were:

- platform chrome overwrites share-card metas and always sets og:title
- published grok.me slug is still a title fallback
- emits og:image for a public host and prefers a custom card
- placeholder og:image appends site.color when it is 6-digit hex
- document title entities are not double-escaped on og:title
- injects into documents with no head element
- streaming injector matches `</HEAD>` case-insensitively
- uses the app name in the injected title tag

On this line the script suite was 198 tests, 194 pass, 4 skipped by their own guards, 0 fail. The node suite was 368 tests, 0 fail. A real person was not available. Developer commands that do not train are in `docs/ISIBUKO_TRAINING_PLAN.md`. A studio-still seating note is in `docs/VISUAL_PASS_LOG.md`.

## Security and privacy

- The camera starts only from the shopper's button. Stop, unmount, and a track that ends all stop the tracks.
- A second camera request reuses a live track instead of opening another stream.
- The mirror does not `fetch` camera frames. Frames go to a worker as an `ImageBitmap` and are closed there. `FRAME_POLICY.leavesDevice` is false.
- A merchant URL is stored for the shopper to open. It is not fetched. Private hosts, `file:`, `javascript:`, passwords, and bare decimal IPs are rejected.
- Photographs must match JPEG, PNG, or WebP magic bytes. SVG is refused even if renamed. The file is a data URL in `localStorage` on this origin. Any script on this origin can read it.
- No model API key is in the mirror. Camera errors name the browser permission or device, not a frame.

## Commands

```bash
npm install
npm run dev
npx tsc --noEmit
node --experimental-strip-types --test \
  src/lib/isibuko-ai/engine-logic.test.ts \
  src/lib/isibuko-ai/schedule.test.ts \
  src/lib/isibuko-ai/release.test.ts \
  src/lib/isibuko-gen/foundation.test.ts \
  src/lib/isibuko-gen/shirt-experiment.test.ts
npm test
npm run build
```

## Deploy

`npm run build` is the existing Vercel/Nitro build. No new environment variable is required. Do not set a generative provider key; none is read. Responses for `*.wasm` must be `Content-Type: application/wasm`. That header is in `vercel.json`.

## Still required, by severity

1. A person on a real camera: arms, a turn, a shirt change, then a stop and a second start. This environment has no camera.
2. A person wearing the studio skirt and bracelet drawings, then the same human check. The drawings are in the catalogue. They are not merchant photographs.
3. Hair that is a real silhouette, not a plate plus a backdrop fill.
4. Licensed pairs and an approved training run before any generative frame is shown.
5. A measured GPU-delegate run on hardware that is not software WebGL.
