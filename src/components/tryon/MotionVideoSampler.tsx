import { useState } from "react";
import { extractVideoFrames, validateMotionVideoFile } from "@/lib/tryon/video-frames";

type FramePreview = { timestampMs: number; dataUrl: string };

export function MotionVideoSampler() {
  const [status, setStatus] = useState("No video analysed yet.");
  const [error, setError] = useState<string | null>(null);
  const [frames, setFrames] = useState<FramePreview[]>([]);
  const [busy, setBusy] = useState(false);

  async function analyse(file: File | undefined) {
    setError(null);
    setFrames([]);
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
    setStatus("Reading video locally…");
    const previews: FramePreview[] = [];
    let sampled = 0;
    try {
      for await (const frame of extractVideoFrames(file, {
        intervalMs: 500,
        maxDurationMs: 15_000,
        maxDimension: 320,
      })) {
        sampled += 1;
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
        frame.bitmap.close();
      }
      setFrames(previews);
      setStatus(`Extracted ${sampled} frames from the first 15 seconds. No video was uploaded.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not analyse this video.");
      setStatus("Video analysis stopped.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-3xl border border-line/40 p-5">
      <p className="text-sm tracking-widest text-clay uppercase">Local processing test</p>
      <h2 className="font-display mt-2 text-2xl">Sample a fitting video</h2>
      <p className="mt-2 text-sm text-ink-muted">
        Select a video from this device. Isibuko extracts low-resolution frames in your browser;
        the video is not uploaded. This validates frame extraction only — product tracking and
        motion-profile generation are the next stages.
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
