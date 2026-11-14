import { useEffect } from "react";
import type { LiveMetrics } from "@/lib/isibuko-ai/types";

/**
 * Developer-only. Mounted with the capture panel on `/mirror?dev=1` in a dev build.
 * It reads numbers the mirror already computed. It does not start a tracker.
 */
export function PerfOverlay({ metrics }: { metrics: LiveMetrics | null }) {
  useEffect(() => {
    (globalThis as { __isibukoPerf?: boolean }).__isibukoPerf = true;
    return () => {
      (globalThis as { __isibukoPerf?: boolean }).__isibukoPerf = false;
    };
  }, []);

  const row = (label: string, value: string) => (
    <div className="flex justify-between gap-3">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );

  return (
    <aside className="fixed top-3 left-3 z-40 w-64 rounded-2xl border border-line bg-ink/95 p-3 text-xs text-paper">
      <p className="font-display text-base">Developer perf</p>
      <p className="mt-1 text-muted">Dev build with ?dev=1. Shoppers do not see this. Trackers may run slower than the picture.</p>
      <div className="mt-2 space-y-1">
        {row("Render", metrics ? `${metrics.renderFps} fps` : "—")}
        {row("Camera", metrics ? (metrics.source === "camera" ? `${metrics.cameraFps} fps` : "still") : "—")}
        {row("Face", metrics ? `${metrics.faceHz} Hz · ${metrics.faceMs} ms` : "—")}
        {row("Pose", metrics ? `${metrics.poseHz} Hz · ${metrics.poseMs} ms` : "—")}
        {row("Hands", metrics ? `${metrics.handHz} Hz · ${metrics.handMs} ms` : "—")}
        {row("Segmentation", metrics ? `${metrics.segmentHz} Hz · ${metrics.segmentMs} ms` : "—")}
        {row("Composite", metrics ? `${metrics.compositeMs} ms` : "—")}
        {row("Frame latency", metrics ? `${metrics.frameLatencyMs} ms` : "—")}
      </div>
    </aside>
  );
}
