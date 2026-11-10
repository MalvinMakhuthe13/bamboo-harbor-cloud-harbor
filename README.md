# Isibuko

An on-device virtual try-on for a merchant catalogue. The shopper opens their camera, picks a real product, and the mirror fits that photograph to their face and body. Changing product, colour, or size does not restart the camera. Frames stay on the device.

This is photographic compositing with MediaPipe tracking. It is not a trained generative video model, and it does not call Decart.

## Routes

| Path | What it is |
| --- | --- |
| `/` | The existing house page |
| `/mirror` | The live try-on |
| `/wardrobe` | Add a merchant piece to the mirror. Stored in this browser only |
| `/studio` | The earlier try-on studio. It is not the live mirror's catalogue |
| `/lab` | Shirt-model contract. It does not generate a frame |
| `/bench` | What is running, and what is not |

## Run

```bash
npm install
npm run dev
```

No API key is required. `DATABASE_URL` is optional; the mirror does not use it. Auth stays off for this experience.

Typecheck and the Isibuko tests:

```bash
npx tsc --noEmit
node --experimental-strip-types --test \
  src/lib/isibuko-ai/engine-logic.test.ts \
  src/lib/isibuko-ai/schedule.test.ts \
  src/lib/isibuko-ai/release.test.ts \
  src/lib/isibuko-gen/foundation.test.ts \
  src/lib/isibuko-gen/shirt-experiment.test.ts
npm run build
```

`npm test` also runs the app-template scripts. Eight of those OG-card injector tests fail on this branch and are not mirror regressions. See `docs/ISIBUKO_RELEASE_CANDIDATE.md`.

## Honest limit

A webcam and a person were not available in the build environment. The studio photograph is a labelled test, not a live camera. Stop ends the session and releases the camera tracks; starting again opens a new session. Skirts and bracelets have a placement path and a merchant upload, and no house photograph yet. Generative try-on is specified and refused until a checkpoint exists. The production preview must serve `.wasm` as `application/wasm` and must not Brotli-compress the tracker binaries on the fly, or MediaPipe never finishes loading.
