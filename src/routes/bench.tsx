import { createFileRoute } from "@tanstack/react-router";
import { Nav } from "@/components/site/Nav";
import { MODEL_REGISTRY, WEIGHT_BYTES } from "@/lib/isibuko-ai/registry";

export const Route = createFileRoute("/bench")({ component: BenchPage });

function BenchPage() {
  const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`;
  return (
    <main className="min-h-screen bg-paper text-ink">
      <div className="bg-ink">
        <Nav />
      </div>
      <div className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="font-display text-4xl">Isibuko AI</h1>
        <p className="mt-3 text-ink-muted">
          The live mirror is an on-device composite. It tracks the person, segments hair, skin, face and clothes, and wears the merchant photograph. It is not a video diffusion model, and it does not call Decart.
        </p>
        <h2 className="font-display mt-8 text-2xl">What is running</h2>
        <ul className="mt-4 space-y-4">
          {MODEL_REGISTRY.map((model) => (
            <li key={model.id} className="rounded-2xl border border-line/30 p-4">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="font-display text-xl">{model.name}</h3>
                <span className="text-sm text-ink-muted">{model.status}</span>
              </div>
              <p className="mt-2 text-sm">{model.role}</p>
              <p className="mt-2 text-sm text-ink-muted">
                {model.owner === "isibuko" ? "Isibuko original" : "Open source component"} · {model.license} · {model.runs}
              </p>
              <p className="mt-1 text-sm text-ink-muted">{model.notes}</p>
            </li>
          ))}
        </ul>
        <h2 className="font-display mt-8 text-2xl">Cost of the live path</h2>
        <p className="mt-3 text-sm text-ink-muted">
          Measured weight download, served once and cached: face {mb(WEIGHT_BYTES.face)}, pose {mb(WEIGHT_BYTES.pose)}, hands {mb(WEIGHT_BYTES.hands)}, segmenter {mb(WEIGHT_BYTES.segmenter)}, runtime {mb(WEIGHT_BYTES.wasm)}. After that, inference is on the shopper's device. Camera frames are not uploaded, so there is no per-session GPU bill. A generative video model is not running, so it is not costed.
        </p>
        <h2 className="font-display mt-8 text-2xl">What is not done</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-ink-muted">
          <li>No owned generative video weights. Temporal stability is landmark smoothing and a mask held across frames, not a diffusion prior.</li>
          <li>A front garment photograph replaces the torso. Sleeves do not yet follow a raised arm, and the shoulder line is a straight fit rather than a draped shoulder.</li>
          <li>A wig plate is placed on the head. Its transparent face opening still shows the shopper's own hair. It is not a generative hairstyle.</li>
          <li>Depth is assumed from breadth. There is no depth camera.</li>
          <li>Side and rear views use the same front photograph, so a hard profile will look less faithful.</li>
          <li>Physical camera tests in this build use a studio photograph when the preview cannot grant a camera. Frame timings on the mirror are measured; they are not a phone lab report.</li>
        </ul>
      </div>
    </main>
  );
}
