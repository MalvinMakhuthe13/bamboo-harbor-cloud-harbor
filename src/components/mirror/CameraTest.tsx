import type { LiveMetrics } from "@/lib/isibuko-ai/types";

function cell(value: string) {
  return <div className="text-paper">{value}</div>;
}

export function CameraTest({
  metrics,
  switches,
  onDelegate,
}: {
  metrics: LiveMetrics | null;
  switches: number;
  onDelegate: (delegate: "CPU" | "GPU") => void;
}) {
  const live = metrics?.source === "camera";
  return (
    <section className="rounded-2xl border border-line bg-ink p-3">
      <h2 className="font-display text-xl text-paper">Camera test</h2>
      <p className="mt-2 text-sm text-muted">
        A real person has not been validated on the build machine. Use your own camera. Step back until both shoulders show, raise your arms, turn, then switch shirts. The session number must stay the same.
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm text-muted">
        <div>Camera</div>
        {cell(live ? "Live. Frames stay on this device." : metrics?.source === "studio" ? "Studio photograph. Not your camera." : "Off")}
        <div>Session</div>
        {cell(metrics ? String(metrics.cameraSession) : "—")}
        <div>Shirt switches</div>
        {cell(live ? `${switches} during this session` : "—")}
        <div>Picture</div>
        {cell(metrics ? `${metrics.fps} fps` : "—")}
        <div>Face</div>
        {cell(metrics ? `${metrics.face ? "found" : "missing"} · ${metrics.faceHz} Hz · ${metrics.faceMs} ms` : "waiting")}
        <div>Shoulders</div>
        {cell(metrics ? (metrics.shoulders ? "both" : "not both") : "waiting")}
        <div>Elbows</div>
        {cell(metrics ? `${metrics.elbows} of 2 · pose ${metrics.poseHz} Hz · ${metrics.poseMs} ms` : "waiting")}
        <div>Wrists</div>
        {cell(metrics ? `${metrics.wrists} of 2` : "waiting")}
        <div>Hands</div>
        {cell(metrics ? `${metrics.hands} · ${metrics.handHz} Hz · ${metrics.handMs} ms` : "—")}
        <div>Segment</div>
        {cell(
          metrics
            ? `${metrics.segment ? "mask" : "none"} · ${metrics.segmentHz} Hz · ${metrics.segmentMs} ms · age ${metrics.maskAgeMs} ms`
            : "waiting",
        )}
        <div>Motion</div>
        {cell(metrics?.motion ?? "unknown")}
        <div>Pose crop</div>
        {cell(metrics ? (metrics.poseCrop ? "region, with a full frame on a fixed beat" : "full frame") : "—")}
        <div>Segment size</div>
        {cell(metrics ? `${metrics.segmentEdge}px long edge, not cropped` : "—")}
        <div>Piece change</div>
        {cell(
          metrics?.switchMs == null
            ? "—"
            : metrics.switchMs === 0
              ? "under 1 ms, same frame"
              : `${metrics.switchMs} ms until the photograph was bound`,
        )}
        <div>Composite</div>
        {cell(metrics ? `${metrics.compositeMs} ms` : "—")}
        <div>Runtime</div>
        {cell(metrics?.delegate ?? "—")}
      </dl>
      <p className="mt-3 text-sm text-muted">{metrics?.delegateNote}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="min-h-11 rounded-full bg-paper px-3 text-sm text-ink" onClick={() => onDelegate("CPU")}>
          Tracker CPU
        </button>
        <button type="button" className="min-h-11 rounded-full border border-line px-3 text-sm text-paper" onClick={() => onDelegate("GPU")}>
          Try GPU tracker
        </button>
      </div>
    </section>
  );
}
