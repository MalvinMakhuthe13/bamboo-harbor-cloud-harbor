# On-device wig motion

The live wig is still the merchant photograph. Three damped groups in `src/lib/isibuko-ai/hair-motion.ts` lag the head, answer a flick, and move when a tracked hand is inside the hair. That is geometric motion. It is not grown hair and it is not a trained model.

## What is recorded

`/mirror?dev=1` in a development build shows a capture panel. It is absent from a production build and from a normal shopper URL. Recording starts only after the landmark checkbox and Start. Stop ends it. Export writes a JSON draft of landmark numbers and, if that box is checked, segmentation class counts. `trainable` is false. Colour frames are not stored, even if the separate pixel box is checked.

Nothing is uploaded. `FRAME_POLICY.leavesDevice` and `FRAME_POLICY.externalInference` stay false.

## What the constants are

`stepStrandGroups` uses a hand-set spring, damping, and a short flick impulse. A later person can compare an exported trajectory with `replayMae`. That comparison does not change the live constants and does not train a checkpoint.

## What this does not do

- It does not download weights.
- It does not send a frame to a server.
- It does not label the result as trained or generated.
- It does not replace the geometric plate with a new haircut.
