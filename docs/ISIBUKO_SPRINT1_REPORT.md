# Sprint 1 report — generative foundation

**Branch:** `ai/isibuko-generative-foundation` only. `main` was not checked out and was not modified.  
**Date:** 11 November 2026  
**Honest state:** partial. The refusal path is tested. No generated image exists.

## Functional, partial, prototype

| Layer | State |
| --- | --- |
| Photographic mirror (inherited) | Present on this branch. Not re-tested in the browser this sprint. Not generative. |
| Model registry and consent contracts | Functional as gates. Registry is empty. |
| Category registry | Functional. Nothing is advertised as generative. |
| Brand directory | Prototype. In memory. Cross-brand read throws. No database, no billing, no prices. |
| Dataset validator and manifest | Functional as metadata gates. No dataset files. |
| Python inference service | Functional as a refusal. HTTP 409, `generated: false`, `image: null` when weights are missing. The success path was not executed. |
| Frontend adapter | Prototype. `routeRender` will not relabel a miss as the composite. The mirror was not wired to the service. |
| Evaluation | Prototype. Scorecard and experiment record refuse fake metrics. No image was scored. |
| Camera suite | Partial. Session logic and the not-found report are tested. No person was filmed. |
| Training | Not started. No weights, no job, no owned checkpoint. |
| Specialist agents | Specifications and a claim gate only. They do not run as separate processes. |

## Tests run this sprint

From the AI worktree:

```bash
cd services/isibuko-infer && python3 test_server.py
node --experimental-strip-types --test \
  src/lib/isibuko-data/validate.test.ts \
  src/lib/isibuko-gen/platform.test.ts \
  src/lib/isibuko-gen/contracts.test.ts \
  src/lib/isibuko-gen/foundation.test.ts \
  src/lib/isibuko-gen/shirt-experiment.test.ts
```

Python: missing weights, HTTP 409, experiment record with `metrics: null`, and path escape rejected.  
Node: 25 passed, 0 failed. That includes the registry, shirt refusal, category advertising, brand isolation, experiment records, scorecard, and the missing-camera report.

`npm test` is not the signal. It is a chain of `&&` and already fails on eight pre-existing OG injector tests. Those tests were not deleted and were not “fixed”.

## Not tested

- No webcam, no real person, no phone.
- No FASHN import, no torch install, no weight download.
- No Decart call, no paid GPU, no training step.
- No browser pass of the mirror in this sprint.
- No colour, identity, or latency number for a generated shirt, because there is no output file.
- Upstream timings in the research register are theirs. They are not Isibuko benchmarks.

## Blockers before a real still

1. Written acceptance of the FASHN Human Parser’s NVIDIA SegFormer terms, or a replacement parser.
2. Approval to download about 2 GB of try-on weights. Disk has about 45 GB free, so space is not the reason to wait.
3. An approved GPU. Do not rent one silently.
4. One rights-cleared person photo and one exact merchant garment, stored outside Git.
5. Only then set `ISIBUKO_ALLOW_FASHN=1` and expect `services/isibuko-infer` to write `outputs/tryon.png`. Until that file exists, the UI must keep saying the mirror is a composite.

## Commands

```bash
cd services/isibuko-infer
python3 test_server.py
# service, still a refusal until weights are approved:
ISIBUKO_WEIGHTS=/abs/path/outside/git python3 server.py
```

Do not set `ISIBUKO_ALLOW_FASHN`. Do not commit `weights/`, `datasets/`, or `services/isibuko-infer/outputs/`.

## Next milestone

One real `tryon.png` from FASHN, a scorecard that names that file, and a human note on print and identity. Not a video model. Not a second brand fine-tune. Brand isolation is already a tested guard, not a trained adapter.
