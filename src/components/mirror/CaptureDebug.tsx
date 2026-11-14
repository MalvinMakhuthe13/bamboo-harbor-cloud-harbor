import { useState } from "react";
import { acceptSample, emptyCaptureConsent, type CapturePurpose, type StoredSample } from "@/lib/isibuko-gen/capture";
import { subscribeCapture } from "@/lib/isibuko-gen/capture-bus";
import { MANIFEST_VERSION, type TrainManifest } from "@/lib/isibuko-gen/manifest";

/**
 * Developer-only. The page mounts this only when `import.meta.env.DEV` and `?dev=1`.
 * Recording starts after a visible checkbox and a button. Nothing is collected before that.
 */
export function CaptureDebug() {
  const [landmarksOk, setLandmarksOk] = useState(false);
  const [segmentationOk, setSegmentationOk] = useState(false);
  const [pixelsOk, setPixelsOk] = useState(false);
  const [recording, setRecording] = useState(false);
  const [samples, setSamples] = useState<StoredSample[]>([]);
  const [note, setNote] = useState("Not recording. Landmark consent is required.");
  const [purpose, setPurpose] = useState<CapturePurpose>("hair-motion");

  function start() {
    if (!landmarksOk) {
      setNote("Check landmark consent before recording.");
      return;
    }
    const consent = emptyCaptureConsent(`dev-${Date.now()}`, purpose);
    consent.atIso = new Date().toISOString();
    consent.segmentation = segmentationOk;
    consent.pixels = false;
    consent.rights = {
      ...consent.rights,
      recordKind: "synthetic-fixture",
      rightsBasis: "isibuko-owned",
      rightsHolder: "developer-local",
      agreementReference: "dev-session",
      agreementScope: "ai-training",
      commercialTraining: true,
      consentId: consent.id,
      allowsTraining: true,
      allowsPersonImagery: false,
      source: "dev-panel",
      acquired: consent.atIso.slice(0, 10),
      method: "landmark-log",
      merchant: "none",
    };
    const stop = subscribeCapture((incoming) => {
      const accepted = acceptSample(consent, segmentationOk ? incoming : { ...incoming, segmentation: undefined });
      if (!accepted.ok) return;
      setSamples((current) => [...current, accepted.stored].slice(-400));
    });
    setRecording(true);
    setNote(
      pixelsOk
        ? "Recording landmark numbers. Colour frames are not stored by this panel."
        : "Recording landmark numbers on this device. No pixels.",
    );
    return stop;
  }

  const [stopFn, setStopFn] = useState<(() => void) | null>(null);

  function begin() {
    const stop = start();
    if (stop) setStopFn(() => stop);
  }

  function end() {
    stopFn?.();
    setStopFn(null);
    setRecording(false);
    setNote(`Stopped. ${samples.length} samples in memory. Nothing was uploaded.`);
  }

  function download() {
    const consent = emptyCaptureConsent("dev-export", purpose);
    consent.atIso = new Date().toISOString();
    consent.rights = {
      ...consent.rights,
      recordKind: "synthetic-fixture",
      rightsBasis: "isibuko-owned",
      rightsHolder: "developer-local",
      agreementReference: "dev-session",
      agreementScope: "ai-training",
      commercialTraining: true,
      consentId: consent.id,
      allowsTraining: true,
      allowsPersonImagery: false,
      source: "dev-panel",
      acquired: consent.atIso.slice(0, 10),
      method: "landmark-log",
      merchant: "none",
    };
    const manifest: TrainManifest = {
      version: MANIFEST_VERSION,
      trainable: false,
      rows: [
        {
          id: "dev-session",
          task: purpose,
          category: samples[0]?.category ?? "none",
          consent,
          pixelBlob: false,
          samples,
        },
      ],
    };
    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "isibuko-landmark-session.json";
    link.click();
    URL.revokeObjectURL(url);
    setNote("Exported a non-trainable draft. train:prepare will refuse it as a training set.");
  }

  return (
    <aside className="fixed right-3 bottom-3 z-40 w-72 rounded-2xl border border-line bg-ink p-3 text-sm text-paper shadow-lg">
      <p className="font-display text-base">Developer capture</p>
      <p className="mt-1 text-muted">Hidden unless this is a dev build opened with ?dev=1. Shoppers do not see it.</p>
      <label className="mt-2 flex min-h-11 items-center gap-2">
        <input type="checkbox" checked={landmarksOk} onChange={(event) => setLandmarksOk(event.target.checked)} />
        I agree to record landmark numbers on this device.
      </label>
      <label className="flex min-h-11 items-center gap-2">
        <input type="checkbox" checked={segmentationOk} onChange={(event) => setSegmentationOk(event.target.checked)} />
        Also record segmentation class counts.
      </label>
      <label className="flex min-h-11 items-center gap-2">
        <input type="checkbox" checked={pixelsOk} onChange={(event) => setPixelsOk(event.target.checked)} />
        Separate pixel consent. This panel still does not store colour frames.
      </label>
      <label className="mt-2 block">
        Purpose
        <select
          className="mt-1 min-h-11 w-full rounded-xl border border-line bg-ink px-2"
          value={purpose}
          onChange={(event) => setPurpose(event.target.value as CapturePurpose)}
        >
          <option value="hair-motion">Hair motion</option>
          <option value="garment-drape">Garment drape</option>
          <option value="jewellery">Jewellery</option>
          <option value="nails">Nails</option>
          <option value="product-cutout">Product cut-out</option>
        </select>
      </label>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className="min-h-11 rounded-full bg-brass px-3 text-ink" disabled={recording || !landmarksOk} onClick={begin}>
          Start
        </button>
        <button type="button" className="min-h-11 rounded-full border border-line px-3" disabled={!recording} onClick={end}>
          Stop
        </button>
        <button type="button" className="min-h-11 rounded-full border border-line px-3" disabled={!samples.length || recording} onClick={download}>
          Export
        </button>
      </div>
      <p className="mt-2 text-muted">{note}</p>
      <p className="text-muted">{samples.length} samples</p>
    </aside>
  );
}
