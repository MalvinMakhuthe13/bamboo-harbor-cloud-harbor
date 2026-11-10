import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Nav } from "@/components/site/Nav";
import { SHIRT_ARCHITECTURE, estimateTrainGpu } from "@/lib/isibuko-gen/architecture";
import { SHIRT_CANDIDATES } from "@/lib/isibuko-gen/candidates";
import { COMMERCIAL_PATHS, commercialSummary } from "@/lib/isibuko-gen/commercial";
import { sampleOwnedPair, sampleResearchPair, validatePair } from "@/lib/isibuko-gen/dataset";
import { evaluateShirt, syntheticScoreFixture } from "@/lib/isibuko-gen/evaluate";
import { UNMEASURED_ACCEPTANCE, acceptanceGaps } from "@/lib/isibuko-gen/inference";
import { buildShirtPacket } from "@/lib/isibuko-gen/packet";
import { runShirtExperiment, type ShirtExperimentResult } from "@/lib/isibuko-gen/runner";

export const Route = createFileRoute("/lab")({ component: LabPage });

function round(value: number): string {
  return value.toFixed(1);
}

function LabPage() {
  const [result, setResult] = useState<ShirtExperimentResult | null>(null);
  const [note, setNote] = useState("");
  const owned = useMemo(() => validatePair(sampleOwnedPair()), []);
  const research = useMemo(() => validatePair(sampleResearchPair()), []);
  const gpu = useMemo(() => estimateTrainGpu(), []);
  const score = useMemo(() => evaluateShirt(syntheticScoreFixture()), []);
  const summary = useMemo(() => commercialSummary(), []);
  const gaps = useMemo(() => acceptanceGaps(UNMEASURED_ACCEPTANCE), []);

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
        <p className="text-sm tracking-widest text-ink-muted uppercase">Shirt foundation · not a live model</p>
        <h1 className="font-display mt-2 text-4xl">Isibuko shirt model</h1>
        <p className="mt-3 text-ink-muted">
          This page runs the training contract, the conditioning preflight, and the pixel scorer. It does not generate a worn frame. The mirror does not import it. No weights have been downloaded and no training run has been started.
        </p>

        <h2 className="font-display mt-8 text-2xl">Data the trainer will accept</h2>
        <p className="mt-3 text-sm text-ink-muted">
          An owned clip needs eight or more frames, rising timestamps, the same person and shirt, a fabric note, a merchant photo, a garment mask, and visible shoulders, elbows and wrists. Research-only sets are refused. The rows below are metadata fixtures, not photographs.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <article className="rounded-2xl border border-line/30 p-4">
            <h3 className="font-display text-xl">Owned fixture</h3>
            <p className="mt-2 text-sm">{owned.ok ? "Accepted." : owned.errors.join(" ")}</p>
          </article>
          <article className="rounded-2xl border border-line/30 p-4">
            <h3 className="font-display text-xl">Research fixture</h3>
            <p className="mt-2 text-sm">{research.ok ? "Accepted." : `Refused. ${research.errors[0]}`}</p>
          </article>
        </div>

        <h2 className="font-display mt-8 text-2xl">Architecture</h2>
        <p className="mt-3 text-sm text-ink-muted">
          {SHIRT_ARCHITECTURE.parameters / 1e6} million parameters designed, {SHIRT_ARCHITECTURE.frames} frames at {SHIRT_ARCHITECTURE.width}×{SHIRT_ARCHITECTURE.height}. Status: {SHIRT_ARCHITECTURE.status}. Weights present: no.
        </p>
        <ul className="mt-4 space-y-3">
          {SHIRT_ARCHITECTURE.stages.map((stage) => (
            <li key={stage.id} className="rounded-2xl border border-line/30 p-4">
              <h3 className="font-display text-xl">{stage.id}</h3>
              <p className="mt-2 text-sm">{stage.role}</p>
              <p className="mt-2 text-sm text-ink-muted">{stage.trains}</p>
            </li>
          ))}
        </ul>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-ink-muted">
          {SHIRT_ARCHITECTURE.strategy.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-ink-muted">
          Training memory, arithmetic only, not measured: checkpointed about {round(gpu.checkpointedGb)} GB, naive attention about {round(gpu.naiveGb)} GB. {gpu.note}
        </p>

        <h2 className="font-display mt-8 text-2xl">Scorer</h2>
        <p className="mt-3 text-sm text-ink-muted">
          A 2×2 numeric fixture, not a photograph and not a model output. Colour drift {score.colorDrift.toFixed(2)}, flicker {score.flicker.toFixed(2)}, identity drift {score.identityDrift.toFixed(2)}. The real acceptance test is still open.
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm">
          {gaps.map((gap) => (
            <li key={gap}>{gap}</li>
          ))}
        </ul>

        <div className="mt-8 rounded-2xl border border-line/30 p-4">
          <h2 className="font-display text-2xl">Inference preflight</h2>
          <p className="mt-2 text-sm text-ink-muted">
            Builds a shirt packet for Sand linen and assembles pose slots, the garment id, and an 8-frame window. Generation is then refused.
          </p>
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
              <p>Conditioning valid: {result.preflight.conditioningValid ? "yes" : "no"}</p>
              <p>Steps: {result.preflight.steps.join(", ")}</p>
              <p className="mt-2 text-ink-muted">{result.reason}</p>
            </div>
          )}
        </div>

        <h2 className="font-display mt-8 text-2xl">Commercial paths</h2>
        <p className="mt-3 text-sm text-ink-muted">
          Installed: {summary.installed}. Live: {summary.live}. None of these are in the mirror. Figures are from the cited cards, not from this machine. A code licence is not treated as a licence for the weights.
        </p>
        <ul className="mt-4 space-y-4">
          {COMMERCIAL_PATHS.map((path) => (
            <li key={path.id} className="rounded-2xl border border-line/30 p-4">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="font-display text-xl">{path.name}</h3>
                <span className="text-sm text-ink-muted">
                  {path.kind} · {path.commercial} · not installed
                </span>
              </div>
              <p className="mt-2 text-sm">Code: {path.codeLicense}</p>
              <p className="mt-2 text-sm">Weights: {path.weightLicense}</p>
              <p className="mt-2 text-sm text-ink-muted">Training data: {path.trainingData}</p>
              <p className="mt-2 text-sm">Size: {path.size}</p>
              <p className="mt-2 text-sm">GPU: {path.gpu}</p>
              <p className="mt-2 text-sm">Time: {path.temporal} {path.latency}</p>
              <p className="mt-2 text-sm">Fine-tune: {path.finetune}</p>
              <p className="mt-2 text-sm">Product conditioning: {path.productConditioning}</p>
              <p className="mt-2 text-sm text-ink-muted">{path.whyNotInstalled}</p>
              <a className="mt-2 inline-flex min-h-11 items-center text-sm underline" href={path.source}>
                Source
              </a>
            </li>
          ))}
        </ul>

        <h2 className="font-display mt-8 text-2xl">Still not commercial</h2>
        <ul className="mt-4 space-y-3">
          {SHIRT_CANDIDATES.map((candidate) => (
            <li key={candidate.id} className="text-sm text-ink-muted">
              {candidate.name} · {candidate.kind} · {candidate.license}. {candidate.whyNotLive}
            </li>
          ))}
        </ul>

        <h2 className="font-display mt-8 text-2xl">What has to be collected</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-ink-muted">
          {SHIRT_ARCHITECTURE.collection.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-ink-muted">
          Infrastructure still required, and not purchased: a GPU large enough for the checkpointed estimate once a real dry-run confirms it, licensed pairs on disk, and an approved training job. Until that checkpoint returns frames, this page keeps refusing.
        </p>
        <Link to="/mirror" className="mt-6 inline-flex min-h-11 items-center text-sm underline">
          Back to the photographic mirror
        </Link>
      </div>
    </main>
  );
}
