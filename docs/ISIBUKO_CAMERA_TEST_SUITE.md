# Camera test suite

The browser is a test harness. It is not the model. Inference must keep working with the Python service and no agent in the loop.

## Automated checks that ran

`src/lib/isibuko-gen/camera-suite.ts` encodes the procedure and rejects a report when permission is missing, no person is detected, the session number changes on a product switch, frames are kept for training, or an external upload has no consent record.

`src/lib/isibuko-ai/release.test.ts` already checks session reuse: a live track is not opened twice, stop then start is a new session, and `NotFoundError` is not described as a live camera.

This sandbox has no webcam. `acceptCameraReport` with `permission: "not-found"` returns `personTested: false`. That is the result. A studio photograph does not flip it.

## Manual procedure, when a person and a camera exist

1. Open the mirror. Do not call the camera from a hidden script.
2. Accept the browser permission prompt.
3. Confirm a face and both shoulders are reported by the existing panel.
4. Change product. The session number must stay the same.
5. Move, raise an arm, and turn. Record picture rate, pose rate, and whether wrists exist. Do not invent frames.
6. Stop. Start again. The session number must increase.
7. Delete any saved frames unless a written consent says they may be kept, and never mark them training-eligible from try-on consent alone.

## What this suite does not do

It does not upload frames. It does not call Decart. It does not score a generated shirt, because no shirt was generated. Generative output, when it exists, is scored by `src/lib/isibuko-gen/scorecard.ts`, which requires the output path, numeric measures, and a named human review. A single score is rejected.
