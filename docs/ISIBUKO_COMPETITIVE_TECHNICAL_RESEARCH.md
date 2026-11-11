# Competitive technical research — Lucy and the open gap

**Date:** 11 November 2026  
**Scope:** public pages only. No Decart API call. No weights downloaded. No private material sought.

## Lucy virtual try-on

Public docs: [Virtual Try-On](https://docs.platform.decart.ai/models/realtime/virtual-try-on).

What the page actually offers:

- Hosted models `lucy-vton-latest` (resolves to `lucy-vton-3.6`) and `lucy-vton-3.5` (720p).
- Realtime through Decart’s client, taking a live camera, a text prompt, and a garment image.
- Batch jobs: `POST https://api.decart.ai/v1/jobs/lucy-vton-latest`, then status and content URLs. Input is an MP4 (max 200 MB) plus an optional reference image. Default resolution 720p.
- Fast mode is documented as twice the standard realtime rate. The pricing page was not copied in this pass, so no credit number is stated here.
- No weights, no training code, no training set, and no local runtime.

A separate public model, [Lucy Edit Dev](https://huggingface.co/decart-ai/Lucy-Edit-Dev), is a ~5B text-guided video editor built on Wan 2.2. Its card licence name is `lucy-edit-dev-model-non-commercial-license`. It can change clothing from a sentence. It is not a merchant-SKU try-on model, and the non-commercial licence excludes it from Isibuko’s product.

No public VTON paper, patent, or training corpus was found that would let Isibuko reproduce Lucy. If that changes, it has to be a primary document, not a demo.

## What the demos imply we must build

Lucy’s public behaviour is a moving person, a chosen garment, and a new video rather than a sticker. That implies, at minimum:

- Identity held outside the edit.
- A garment reference, not only a text prompt, if the merchant SKU must survive.
- Temporal consistency while the body turns.
- Latency low enough for a camera, which their hosted 720p stream claims and which we have not measured.
- Occlusion of arms and hands.

Isibuko’s mirror currently does a different job: MediaPipe masks plus a merchant photograph. It can follow a torso on device. It does not synthesise cloth, prints, or a turn.

Open image models (FASHN, and the non-commercial IDM/Cat/OOT family) do synthesise a still. They do not hold a shirt across a turn, and most cannot be shipped commercially.

## Gap Isibuko has to close itself

1. A legally usable still baseline, then our own measured fidelity numbers.
2. Conditioning that pins the merchant asset (print, colour, cut), which a text video editor does not guarantee.
3. A temporal module only after the still passes.
4. Brand-isolated catalogues and datasets around that core.
5. No runtime dependence on Decart, Grok, or any single hosted try-on API.

Lucy is a quality bar. It is not a component.
