# Isibuko training plan

This is a plan for work that has not started. No training run has been launched, no Kaggle job has been started, and no weights have been downloaded. The live mirror still composites a photograph with MediaPipe and WebGL. `FRAME_POLICY.externalInference` and `FRAME_POLICY.leavesDevice` stay false.

These notes are not legal advice.

## Developer commands

None of these train, upload, or download weights. Output goes to `training/outputs/`, which is gitignored.

| Command | What it does |
| --- | --- |
| `npm run train:prepare` | Validates a manifest. With no file yet, it writes the synthetic manifest and packages that. Pass a path to the script to validate another file. |
| `npm run train:synthetic` | Writes `training/outputs/synthetic/manifest.json`. Landmark numbers only. `trainable` is false. |
| `npm run train:kaggle-pack` | Copies notebooks, stubs, and fixture files into `training/outputs/kaggle-pack` and writes `DATA_REFERENCES.json` with `uploaded: false`. |
| `npm run train:eval` | Prints a fixture replay error. It does not load a checkpoint. The renderer line stays geometric-composite. |
| `npm run train:import` | `node --experimental-strip-types scripts/train-cli.ts import path/to/note.json` parks a JSON note under `training/outputs/import` with `enabled: false`. Weight filenames are refused. |

The in-app recorder is developer-only. It renders on `/mirror?dev=1` in a dev build (`import.meta.env.DEV`). A production build does not show it. Recording starts only after the landmark checkbox and Start. Stop ends it. Export downloads a non-trainable draft. Colour frames are not stored. The engine emits landmarks only while that panel is subscribed. There is no background collector.

## What is in the tree

- `src/lib/isibuko-gen/capture.ts` records an opt-in landmark log. A colour frame is refused unless pixel consent is set separately and the rights record allows person imagery.
- `src/lib/isibuko-gen/manifest.ts` checks a manifest per task: hair motion, garment drape, jewellery, nails, product cut-out. A synthetic fixture cannot be marked trainable.
- Rights use `rights.ts`. Shirt-shaped pairs still use `dataset.ts`. Capture rows are not admitted to a run by this plan.
- `src/lib/isibuko-gen/feature-flag.ts` resolves the renderer. The constant `enabled` is false, so a request for a checkpoint still returns the geometric composite.
- `training/` holds fixtures and stubs. See `training/README.md`.

## Phases

### 1. Kaggle free tier

About 30 GPU hours a week, often in sessions of about 9–12 hours. The planning split in `training/kaggle/gpu-estimates.json` is 2 hours for a spring search, 10 for a first cut-out head, and 12 for a nail mask head. That is 24 hours, with about 6 hours left. These are estimates, not a bill from a run.

The spring search can stay on CPU. A GPU is only so the same notebook form is ready. The stubs refuse to run a loop until `ISIBUKO_APPROVE_GPU_RUN=1`, and even then they still have no training loop.

Do not upload shopper camera frames. A later export would be a reviewed manifest of landmarks, or commercially licensed product photos for the cut-out task.

### 2. Paid GPU, after paying clients

Use this when a week of free hours is not enough for a real fine-tune: more product photos, a nail set that includes consented crops, and a longer evaluation. Still no generative video in this phase. Checkpoints stay out of git.

### 3. A generative model in the Lucy style

Only after owned or commercially licensed worn pairs, a written approval, and a checkpoint that returns frames. That model is not specified as weights here. It would sit behind the feature flag. The default remains the geometric composite. The mirror would still not send a live frame to a paid API. `FRAME_POLICY.externalInference` stays false unless a later decision changes it on purpose.

## Data volume

These are targets for a later collection, not counts of files we hold.

| Task | Useful starting set | What it must contain |
| --- | --- | --- |
| Hair motion | A few hundred short trajectories | Forehead and cheek landmarks, the spring offset, consent. No pixels by default |
| Garment drape | A few hundred turns | Shoulders, hips, a clothes-class summary, consent |
| Jewellery | About a hundred motions per kind | The anchor landmark and the swing. Earrings, necklace, ring, bracelet, watch |
| Nails | A few hundred hands, and a separate foot set if pixels are approved later | Fingertips are hand landmarks. Toes today have one foot-index point, not five toe masks |
| Product cut-out | A few thousand licensed product photos | Category confirmed by a person. A purchase link may be stored and is not a checkout |

A generative worn-pair set is larger again, on the order of tens of thousands of licensed pairs. It is not started.

## Consent and POPIA

POPIA applies to personal information of people in South Africa. Body landmarks are personal information. Treat them as sensitive even when the colour frame is not stored.

- The shopper opts in. Landmark consent and pixel consent are separate. Pixel consent is off unless they set it.
- The purpose is training a try-on, not a general profile.
- The log stays on the device until a person exports a reviewed manifest. Sending it to Kaggle, which is outside South Africa, would be a further decision and a further consent. This tree does not upload it.
- The rights record needs a holder, an agreement reference, an `ai-training` scope, and a consent id. A product-use licence is not enough. `rights.ts` already rejects that.
- A person can ask for the log to be deleted. The capture store is not a server account.
- Synthetic fixtures are for the stubs. `sampleStatus` rejects them for admission.

## Evaluation

`replayMae` in `manifest.ts` is the harness for motion: compare a recorded offset with a spring replay and report the mean absolute error. It does not score a generated frame.

Cut-out and nail masks would use intersection-over-union on a held-out mask. Until those masks exist, the stub prints a refusal instead of a score.

The shirt experiment in `isibuko-gen` still refuses to generate. A generative score waits on a checkpoint.

## Plugging a checkpoint back in

`resolveRenderer()` returns `geometric-composite`. It returns that even if a caller passes `allowTrained: true`, because `TRAINED_ARTIFACTS.enabled` is false and no loader is installed.

A later change would set `enabled` only in a build that has a local checkpoint, keep the default call site on the geometric path, and never point the live camera at an external model. The mirror code does not import the training stubs.
