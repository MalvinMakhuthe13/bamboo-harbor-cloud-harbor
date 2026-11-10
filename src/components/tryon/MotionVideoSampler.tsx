import { useState } from "react";
import { extractVideoFrames, validateMotionVideoFile } from "@/lib/tryon/video-frames";
import { createWearerTrackers, type WearerTrackingSample } from "@/lib/tryon/wearer-tracking";
import { createProductSegmenter, type ProductSegmentationSample } from "@/lib/tryon/product-segmentation";
import { buildRelativeHairTrack, summarizeRelativeHairTrack, selectSeededHairRegion, trackSeededHairBidirectional, type SeededHairRegion, type SeededHairTrackPoint } from "@/lib/tryon/hair-region-tracking";

type FramePreview = { timestampMs: number; dataUrl: string; maskDataUrl: string; categoryMask: Uint8Array; maskWidth: number; maskHeight: number };
type SeedSelection = { timestampMs: number; x: number; y: number; result: SeededHairRegion; track: SeededHairTrackPoint[] };
type TrackingSummary = {
  frames: number;
  faceFrames: number;
  shoulderFrames: number;
  yawProxyRange: number | null;
  hairFrames: number;
  meanHairCoverage: number;
  faceSkinFrames: number;
  clothesFrames: number;
  relativeHairSamples: number;
  horizontalJitter: number | null;
  verticalJitter: number | null;
};

export function MotionVideoSampler() {
  const [status, setStatus] = useState("No video analysed yet.");
  const [error, setError] = useState<string | null>(null);
  const [frames, setFrames] = useState<FramePreview[]>([]);
  const [maskFrames, setMaskFrames] = useState<{ timestampMs: number; categories: Uint8Array; width: number; height: number }[]>([]);
  const [tracking, setTracking] = useState<TrackingSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [seedSelection, setSeedSelection] = useState<SeedSelection | null>(null);

  async function analyse(file: File | undefined) {
    setError(null);
    setFrames([]);
    setMaskFrames([]);
    setTracking(null);
    setSeedSelection(null);
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
    setStatus("Loading on-device face, pose and segmentation models…");
    const previews: FramePreview[] = [];
    const allMaskFrames: { timestampMs: number; categories: Uint8Array; width: number; height: number }[] = [];
    const wearerSamples: WearerTrackingSample[] = [];
    const segmentationSamples: ProductSegmentationSample[] = [];
    let tracker: Awaited<ReturnType<typeof createWearerTrackers>> | null = null;
    let segmenter: Awaited<ReturnType<typeof createProductSegmenter>> | null = null;
    try {
      [tracker, segmenter] = await Promise.all([createWearerTrackers(), createProductSegmenter()]);
      setStatus("Tracking wearer and segmenting hair/clothing locally…");
      for await (const frame of extractVideoFrames(file, {
        intervalMs: 500,
        maxDurationMs: 15_000,
        maxDimension: 320,
      })) {
        try {
          wearerSamples.push(tracker.detect(frame.bitmap, frame.timestampMs));
          const segmentation = segmenter.detect(frame.bitmap, frame.timestampMs, true);
          segmentationSamples.push(segmentation);
          const categoryMask = segmentation.categoryMask ?? new Uint8Array();
          allMaskFrames.push({ timestampMs: frame.timestampMs, categories: categoryMask, width: segmentation.width, height: segmentation.height });
          const includePreviewMask = previews.length < 4;
          if (includePreviewMask) {
            const canvas = document.createElement("canvas");
            canvas.width = frame.width;
            canvas.height = frame.height;
            const context = canvas.getContext("2d");
            if (context) {
              context.drawImage(frame.bitmap, 0, 0);
              const dataUrl = canvas.toDataURL("image/jpeg", 0.72);
              const maskCanvas = document.createElement("canvas");
              maskCanvas.width = frame.width;
              maskCanvas.height = frame.height;
              const maskContext = maskCanvas.getContext("2d");
              if (maskContext && categoryMask.length) {
                const overlay = maskContext.createImageData(frame.width, frame.height);
                const maskWidth = segmentation.width;
                const maskHeight = segmentation.height;
                for (let y = 0; y < frame.height; y++) {
                  const maskY = Math.min(maskHeight - 1, Math.floor((y / frame.height) * maskHeight));
                  for (let x = 0; x < frame.width; x++) {
                    const maskX = Math.min(maskWidth - 1, Math.floor((x / frame.width) * maskWidth));
                    const category = categoryMask[maskY * maskWidth + maskX];
                    const pixel = (y * frame.width + x) * 4;
                    if (category === 1) {
                      overlay.data[pixel] = 232;
                      overlay.data[pixel + 1] = 70;
                      overlay.data[pixel + 2] = 170;
                      overlay.data[pixel + 3] = 105;
                    } else if (category === 3) {
                      overlay.data[pixel] = 70;
                      overlay.data[pixel + 1] = 170;
                      overlay.data[pixel + 2] = 245;
                      overlay.data[pixel + 3] = 85;
                    } else if (category === 4) {
                      overlay.data[pixel] = 245;
                      overlay.data[pixel + 1] = 180;
                      overlay.data[pixel + 2] = 55;
                      overlay.data[pixel + 3] = 75;
                    }
                  }
                }
                maskContext.putImageData(overlay, 0, 0);
              }
              previews.push({
                timestampMs: frame.timestampMs,
                dataUrl,
                maskDataUrl: maskCanvas.toDataURL("image/jpeg", 0.78),
                categoryMask,
                maskWidth: segmentation.width,
                maskHeight: segmentation.height,
              });
            }
          }
        } finally {
          frame.bitmap.close();
        }
      }

      const faceFrames = wearerSamples.filter((sample) => sample.faceDetected).length;
      const shoulderFrames = wearerSamples.filter((sample) => sample.shouldersDetected).length;
      const yawValues = wearerSamples
        .map((sample) => sample.headYawProxy)
        .filter((value): value is number => value !== null);
      const hairSamples = segmentationSamples.filter((sample) => sample.hairDetected);
      const relativeHairTrack = buildRelativeHairTrack(wearerSamples, segmentationSamples);
      const relativeHairSummary = summarizeRelativeHairTrack(relativeHairTrack);
      setFrames(previews);
      setMaskFrames(allMaskFrames);
      setTracking({
        frames: wearerSamples.length,
        faceFrames,
        shoulderFrames,
        yawProxyRange: yawValues.length ? Math.max(...yawValues) - Math.min(...yawValues) : null,
        hairFrames: hairSamples.length,
        meanHairCoverage: hairSamples.length
          ? hairSamples.reduce((sum, sample) => sum + sample.hair.ratio, 0) / hairSamples.length
          : 0,
        faceSkinFrames: segmentationSamples.filter((sample) => sample.faceSkin.pixels > 0).length,
        clothesFrames: segmentationSamples.filter((sample) => sample.clothes.pixels > 0).length,
        relativeHairSamples: relativeHairSummary.sampleCount,
        horizontalJitter: relativeHairSummary.horizontalJitter,
        verticalJitter: relativeHairSummary.verticalJitter,
      });
      setStatus(`Processed ${wearerSamples.length} frames locally. Face: ${faceFrames}; shoulders: ${shoulderFrames}; hair regions: ${hairSamples.length}. No video was uploaded.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not analyse this video.");
      setStatus("Video analysis stopped.");
    } finally {
      tracker?.close();
      segmenter?.close();
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-3xl border border-line/40 p-5">
      <p className="text-sm tracking-widest text-clay uppercase">Local processing test</p>
      <h2 className="font-display mt-2 text-2xl">Sample a fitting video</h2>
      <p className="mt-2 text-sm text-ink-muted">
        Isibuko extracts frames and runs on-device face, shoulder and semantic hair/clothing segmentation.
        No video or frames are uploaded. Semantic hair is a coarse region mask, not yet a product-specific wig boundary.
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
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <div><dt className="text-ink-muted">Frames tracked</dt><dd>{tracking.frames}</dd></div>
          <div><dt className="text-ink-muted">Face detected</dt><dd>{tracking.faceFrames}/{tracking.frames}</dd></div>
          <div><dt className="text-ink-muted">Shoulders detected</dt><dd>{tracking.shoulderFrames}/{tracking.frames}</dd></div>
          <div><dt className="text-ink-muted">Hair regions</dt><dd>{tracking.hairFrames}/{tracking.frames}</dd></div>
          <div><dt className="text-ink-muted">Mean hair coverage</dt><dd>{(tracking.meanHairCoverage * 100).toFixed(1)}%</dd></div>
          <div><dt className="text-ink-muted">Face / clothing regions</dt><dd>{tracking.faceSkinFrames} / {tracking.clothesFrames}</dd></div>
          <div><dt className="text-ink-muted">Head yaw proxy range</dt><dd>{tracking.yawProxyRange?.toFixed(3) ?? "Unavailable"}</dd></div>
          <div><dt className="text-ink-muted">Face-relative hair track</dt><dd>{tracking.relativeHairSamples}/{tracking.frames} frames</dd></div>
          <div><dt className="text-ink-muted">Hair horizontal jitter</dt><dd>{tracking.horizontalJitter?.toFixed(3) ?? "Unavailable"}</dd></div>
          <div><dt className="text-ink-muted">Hair vertical jitter</dt><dd>{tracking.verticalJitter?.toFixed(3) ?? "Unavailable"}</dd></div>
        </dl>
      )}
      {frames.length > 0 && (
        <>
          <p className="mt-4 text-sm font-medium">Select the product region</p>
          <p className="mt-1 text-xs text-ink-muted">Click the centre of the wig or hair product in a frame. The selection is refined against the pink semantic hair mask, then tracked both directions through every sampled frame. Motion prediction widens the search after temporary mask loss; recovered frames are reported separately.</p>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {frames.map((frame) => (
              <figure key={frame.timestampMs} className="overflow-hidden rounded-xl border border-line/40">
                <button
                  type="button"
                  className="relative block w-full cursor-crosshair"
                  aria-label={`Select hair product region at ${(frame.timestampMs / 1000).toFixed(1)} seconds`}
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
                    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
                    const frameIndex = frames.findIndex((item) => item.timestampMs === frame.timestampMs);
                    const propagated = trackSeededHairBidirectional(
                      maskFrames,
                      frameIndex,
                      { x, y, radius: 0.18 },
                    );
                    const result = propagated[0]?.region ?? selectSeededHairRegion(frame.categoryMask, frame.maskWidth, frame.maskHeight, { x, y, radius: 0.18 });
                    setSeedSelection({ timestampMs: frame.timestampMs, x, y, result, track: propagated });
                  }}
                >
                  <img src={frame.maskDataUrl} alt={`Semantic segmentation overlay at ${(frame.timestampMs / 1000).toFixed(1)} seconds`} className="block w-full" />
                  {seedSelection?.timestampMs === frame.timestampMs && (
                    <span className="pointer-events-none absolute rounded-full border-2 border-white bg-clay/20" style={{ left: `${seedSelection.x * 100}%`, top: `${seedSelection.y * 100}%`, width: "36%", aspectRatio: "1", transform: "translate(-50%, -50%)" }} />
                  )}
                </button>
                <figcaption className="px-2 py-1 text-xs text-ink-muted">
                  {(frame.timestampMs / 1000).toFixed(1)}s · {seedSelection?.track.some((point) => point.timestampMs === frame.timestampMs && point.tracked) ? "tracked" : "click to select"}
                </figcaption>
              </figure>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-muted">Overlay key: pink = semantic hair, blue = face skin, amber = clothing. These are broad model classes, not confirmed product boundaries.</p>
          {seedSelection && (
            <div className="mt-3 rounded-xl border border-line/40 p-3 text-sm" aria-live="polite">
              <p className="font-medium">Selected region · {(seedSelection.timestampMs / 1000).toFixed(1)}s</p>
              <p className="mt-1 text-ink-muted">{seedSelection.result.pixels.toLocaleString()} hair-class pixels · {(seedSelection.result.ratio * 100).toFixed(2)}% of frame mask</p>
              <p className="mt-1 text-ink-muted">Bidirectional tracking: {seedSelection.track.filter((point) => point.tracked).length}/{seedSelection.track.length} frames found · {seedSelection.track.filter((point) => point.recovered).length} recovered after mask loss · {maskFrames.length} masks retained</p>
              {seedSelection.result.bounds
                ? <p className="mt-1 text-ink-muted">Bounds: x {seedSelection.result.bounds.left.toFixed(2)}–{seedSelection.result.bounds.right.toFixed(2)}, y {seedSelection.result.bounds.top.toFixed(2)}–{seedSelection.result.bounds.bottom.toFixed(2)}</p>
                : <p className="mt-1 text-clay">No semantic hair pixels found near that point. Try another point on the pink region.</p>}
            </div>
          )}
        </>
      )}
    </section>
  );
}
