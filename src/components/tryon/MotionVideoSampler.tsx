import { useState } from "react";
import { extractVideoFrames, validateMotionVideoFile } from "@/lib/tryon/video-frames";
import { createWearerTrackers, type WearerTrackingSample } from "@/lib/tryon/wearer-tracking";

type FramePreview = { timestampMs: number; dataUrl: string };
type TrackingSummary = {
  frames: number;
  faceFrames: number;
  shoulderFrames: number;
  yawProxyRange: number | null;
};

export function MotionVideoSampler() {
  const [status, setStatus] = useState("No video analysed yet.");
  const [error, setError] = useState<string | null>(null);
  const [frames, setFrames] = useState<FramePreview[]>([]);
  const [tracking, setTracking] = useState<TrackingSummary | null>(null);
  const [busy, setBusy] = useState(false);

  async function analyse(file: File | undefined) {
    setError(null);
    setFrames([]);
    setTracking(null);
    if (!file) {
      setStatus("No video selected.");
      return;
    }
    const validation = validateMotionVideoFile(file);
    if (validation) {
      setError(validation);
      setStatus("Video not analysed.");
      return;
    }

    setBusy(true);
    setStatus("Loading on-device face and pose trackers…");
    const previews: FramePreview[] = [];
    const samples: WearerTrackingSample[] = [];
    let tracker: Awaited<ReturnType<typeof createWearerTrackers>> | null = null;
    try {
      tracker = await createWearerTrackers();
      setStatus("Tracking face and shoulders locally…");
      for await (const frame of extractVideoFrames(file, {
        intervalMs: 500,
        maxDurationMs: 15_000,
        maxDimension: 320,
      })) {
        try {
          samples.push(tracker.detect(frame.bitmap, frame.timestampMs));
          if (previews.length < 4) {
            const canvas = document.createElement("canvas");
            canvas.width = frame.width;
            canvas.height = frame.height;
            const context = canvas.getContext("2d");
            if (context) {
              context.drawImage(frame.bitmap, 0, 0);
              previews.push({ timestampMs: frame.timestampMs, dataUrl: canvas.toDataURL("image/jpeg", 0.72) });
            }
          }
        } finally {
          frame.bitmap.close();
        }
      }

      const faceFrames = samples.filter((sample) => sample.faceDetected).length;
      const shoulderFrames = samples.filter((sample) => sample.shouldersDetected).length;
      const yawValues = samples
        .map((sample) => sample.headYawProxy)
        .filter((value): value is number => value !== null);
      setFrames(previews);
      setTracking({
        frames: samples.length,
        faceFrames,
        shoulderFrames,
        yawProxyRange: yawValues.length ? Math.max(...yawValues) - Math.min(...yawValues) : null,
      });
      setStatus(`Tracked ${faceFrames}/${samples.length} faces and ${shoulderFrames}/${samples.length} shoulder pairs. Processing stayed on this device.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not analyse this video.");
      setStatus("Video analysis stopped.");
    } finally {
      tracker?.close();
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-3xl border border-line/40 p-5">
      <p className="text-sm tracking-widest text-clay uppercase">Local processing test</p>
      <h2 className="font-display mt-2 text-2xl">Sample a fitting video</h2>
      <p className="mt-2 text-sm text-ink-muted">
        Select a seller demonstration video. Isibuko extracts frames and tracks the wearer's face
        and shoulders locally using MediaPipe. No video or frames are uploaded. Product segmentation
        and product-relative motion tracking are still separate stages.
      </p>
      <label className="mt-4 block text-sm">
        Choose a demonstration video
        <input
          className="mt-2 block w-full text-sm"
          type="file"
          accept="video/mp4,video/webm,video/quicktime,video/x-m4v"
          disabled={busy}
          onChange={(event) => void analyse(event.target.files?.[0])}
        />
      </label>
      <p className="mt-3 text-sm text-ink-muted" aria-live="polite">{busy ? "Processing…" : status}</p>
      {error && <p className="mt-2 text-sm text-clay" role="alert">{error}</p>}
      {tracking && (
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div><dt className="text-ink-muted">Frames tracked</dt><dd>{tracking.frames}</dd></div>
          <div><dt className="text-ink-muted">Face detected</dt><dd>{tracking.faceFrames}/{tracking.frames}</dd></div>
          <div><dt className="text-ink-muted">Shoulders detected</dt><dd>{tracking.shoulderFrames}/{tracking.frames}</dd></div>
          <div><dt className="text-ink-muted">Head yaw proxy range</dt><dd>{tracking.yawProxyRange?.toFixed(3) ?? "Unavailable"}</dd></div>
        </dl>
      )}
      {frames.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {frames.map((frame) => (
            <figure key={frame.timestampMs} className="overflow-hidden rounded-xl border border-line/40">
              <img src={frame.dataUrl} alt={`Extracted video frame at ${(frame.timestampMs / 1000).toFixed(1)} seconds`} className="aspect-video w-full object-cover" />
              <figcaption className="px-2 py-1 text-xs text-ink-muted">{(frame.timestampMs / 1000).toFixed(1)}s</figcaption>
            </figure>
          ))}
        </div>
      )}
    </section>
  );
}
