import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Nav } from "@/components/site/Nav";
import { OWNED_SHIRT_MODEL, SHIRT_CANDIDATES } from "@/lib/isibuko-gen/candidates";
import { buildShirtPacket } from "@/lib/isibuko-gen/packet";
import { runShirtExperiment, type ShirtExperimentResult } from "@/lib/isibuko-gen/runner";

export const Route = createFileRoute("/lab")({ component: LabPage });

function LabPage() {
  const [result, setResult] = useState<ShirtExperimentResult | null>(null);
  const [note, setNote] = useState("");

  function check() {
    const built = buildShirtPacket({
      category: "shirt",
      garmentId: "shirt-linen",
      garmentUrl: "/catalog/shirt-linen.png",
      frameWidth: 720,
      frameHeight: 960,
      timestampMs: Date.now(),
      poseTracked: true,
      clothesMask: true,
      source: "studio",
    });
    if (!built.ok) {
      setResult(null);
      setNote(built.reason);
      return;
    }
    setNote("");
    setResult(runShirtExperiment(built.packet));
  }

  return (
    <main className="min-h-screen bg-paper text-ink">
      <div className="bg-ink">
        <Nav />
      </div>
      <div className="mx-auto max-w-3xl px-4 py-8">
        <p className="text-sm tracking-widest text-ink-muted uppercase">Experiment · not the mirror</p>
        <h1 className="font-display mt-2 text-4xl">Shirt video model</h1>
        <p className="mt-3 text-ink-muted">
          This page is the first Isibuko generative experiment, and only for shirts. It does not run a diffusion model. It will not show a composited shirt and call that generated.
        </p>
        <div className="mt-6 rounded-2xl border border-line/30 p-4">
          <h2 className="font-display text-2xl">{OWNED_SHIRT_MODEL.name}</h2>
          <p className="mt-2 text-sm">{OWNED_SHIRT_MODEL.weights}</p>
          <p className="mt-2 text-sm text-ink-muted">{OWNED_SHIRT_MODEL.license}</p>
          <button type="button" className="mt-4 min-h-11 rounded-full bg-ink px-4 text-sm text-paper" onClick={check}>
            Check whether it can run
          </button>
          {note && <p className="mt-3 text-sm">{note}</p>}
          {result && (
            <div className="mt-4 text-sm">
              <p>State: {result.state}</p>
              <p>Running: {result.running ? "yes" : "no"}</p>
              <p>Live: {result.live ? "yes" : "no"}</p>
              <p>Used the photographic composite: {result.usedComposite ? "yes" : "no"}</p>
              <p>Generated frame: none</p>
              <p className="mt-2 text-ink-muted">{result.reason}</p>
            </div>
          )}
        </div>
        <h2 className="font-display mt-8 text-2xl">What was investigated</h2>
        <p className="mt-3 text-sm text-ink-muted">
          Open video and image try-on models were compared for a live shirt. None is fast enough for a camera, and the usable checkpoints are non-commercial, so they are not installed. Figures below are from the cited papers and demos, not from this machine.
        </p>
        <ul className="mt-4 space-y-4">
          {SHIRT_CANDIDATES.map((candidate) => (
            <li key={candidate.id} className="rounded-2xl border border-line/30 p-4">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="font-display text-xl">{candidate.name}</h3>
                <span className="text-sm text-ink-muted">{candidate.kind} · not running</span>
              </div>
              <p className="mt-2 text-sm">{candidate.code}</p>
              <p className="mt-2 text-sm text-ink-muted">{candidate.license}</p>
              <p className="mt-2 text-sm">{candidate.whyNotLive}</p>
              <a className="mt-2 inline-flex min-h-11 items-center text-sm underline" href={candidate.source}>
                Source
              </a>
            </li>
          ))}
        </ul>
        <h2 className="font-display mt-8 text-2xl">How this connects later</h2>
        <p className="mt-3 text-sm text-ink-muted">
          The mirror already tracks pose and clothes on the device. A future approved model would receive a shirt packet: garment id, frame size, whether pose and a clothes mask exist, and the camera-or-studio label. It would return a generated frame. That call is <span className="text-ink">runShirtExperiment</span>. Today it only reports that the checkpoint is missing. The live mirror does not import it.
        </p>
        <p className="mt-3 text-sm text-ink-muted">
          Owning the model means training on pairs Isibuko has the right to use, then distilling toward the camera budget. No training run and no paid GPU has been started.
        </p>
        <Link to="/mirror" className="mt-6 inline-flex min-h-11 items-center text-sm underline">
          Back to the photographic mirror
        </Link>
      </div>
    </main>
  );
}
