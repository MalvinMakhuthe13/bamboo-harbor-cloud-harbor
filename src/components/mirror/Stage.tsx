import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { startEngine, type Drag, type EngineHandle } from "@/lib/isibuko-ai/engine";
import { cameraErrorMessage } from "@/lib/isibuko-ai/session";
import type { FrameRequest, LiveMetrics } from "@/lib/isibuko-ai/types";

export function Stage({
  requestRef,
  dragRef,
  controlsRef,
  onMetrics,
  onStatus,
}: {
  requestRef: { current: FrameRequest };
  dragRef: { current: Drag };
  controlsRef?: { current: { setDelegate: (delegate: "CPU" | "GPU") => void } | null };
  onMetrics: (metrics: LiveMetrics) => void;
  onStatus: (status: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<EngineHandle | null>(null);
  const [mode, setMode] = useState<"ask" | "camera" | "studio">("ask");
  const [cameraError, setCameraError] = useState("");
  const [engineReady, setEngineReady] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    let handle: EngineHandle;
    try {
      handle = startEngine({
        video,
        canvas,
        getRequest: () => requestRef.current,
        drag: dragRef.current,
        onMetrics,
        onStatus,
      });
    } catch (error) {
      onStatus(error instanceof Error ? error.message : "The mirror could not start.");
      return;
    }
    handleRef.current = handle;
    if (controlsRef) controlsRef.current = { setDelegate: (delegate) => handle.setDelegate(delegate) };
    setEngineReady(true);
    return () => {
      handle.dispose();
      handleRef.current = null;
      if (controlsRef) controlsRef.current = null;
      setEngineReady(false);
    };
    // The engine reads the latest request through refs. Mount once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const origin = useRef<{ x: number; y: number } | null>(null);

  function mapPointer(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scale = Math.min(rect.width / canvas.width, rect.height / canvas.height);
    const dw = canvas.width * scale;
    const dh = canvas.height * scale;
    const ox = rect.left + (rect.width - dw) / 2;
    const oy = rect.top + (rect.height - dh) / 2;
    const x = (event.clientX - ox) / scale;
    const y = (event.clientY - oy) / scale;
    if (x < 0 || y < 0 || x > canvas.width || y > canvas.height) return null;
    return { x: x / canvas.width, y: y / canvas.height };
  }

  return (
    <div className="relative h-full min-h-0 w-full bg-ink">
      <video ref={videoRef} className="pointer-events-none absolute h-px w-px opacity-0" playsInline muted />
      <canvas
        ref={canvasRef}
        aria-label="Try-on picture. Drag to nudge the piece."
        className="h-full w-full object-contain"
        onPointerDown={(event) => {
          const point = mapPointer(event);
          if (!point) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current.hold = true;
          dragRef.current.x = 0;
          dragRef.current.y = 0;
          origin.current = point;
        }}
        onPointerMove={(event) => {
          if (!dragRef.current.hold) return;
          const point = mapPointer(event);
          if (!point || !origin.current) return;
          dragRef.current.x = Math.max(-0.18, Math.min(0.18, point.x - origin.current.x));
          dragRef.current.y = Math.max(-0.18, Math.min(0.18, point.y - origin.current.y));
        }}
        onPointerUp={() => {
          dragRef.current.hold = false;
        }}
      />
      <div className="pointer-events-none absolute right-4 bottom-4 left-4 flex flex-wrap gap-2">
        {mode === "studio" && (
          <p className="pointer-events-none rounded-full bg-ink/80 px-3 py-2 text-sm text-brass-2">Test photo. Not your camera.</p>
        )}
        <EngineButton
          label="Use my camera"
          primary
          disabled={!engineReady}
          onClick={() => {
            setCameraError("");
            const handle = handleRef.current;
            if (!handle) return;
            void handle
              .startCamera()
              .then(() => setMode("camera"))
              .catch((error) => {
                const message = cameraErrorMessage(error);
                setCameraError(message);
                onStatus(message);
              });
          }}
        />
        <EngineButton
          label="Studio photo — test only"
          disabled={!engineReady}
          onClick={() => {
            const handle = handleRef.current;
            if (!handle) return;
            void handle
              .startStudio()
              .then(() => setMode("studio"))
              .catch((error) => onStatus(error instanceof Error ? error.message : "Studio photo failed."));
          }}
        />
        {mode !== "ask" && (
          <EngineButton
            label="Stop"
            onClick={() => {
              handleRef.current?.stop();
              setMode("ask");
              setCameraError("");
            }}
          />
        )}
      </div>
      {mode === "ask" && (
        <div className="absolute inset-0 flex items-end justify-center bg-ink/55 p-6 sm:items-center">
          <div className="mb-16 w-full max-w-md rounded-3xl border border-line bg-ink-2 p-5 sm:mb-0">
            <p className="font-display text-3xl text-paper">Wear it on camera</p>
            <p className="mt-2 text-sm text-muted">Your camera stays on while you move and change pieces. Frames stay on this device. A studio photo is only for testing, and it is never treated as live.</p>
            {cameraError && <p className="mt-3 text-sm text-clay">{cameraError}</p>}
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!engineReady}
                className="min-h-11 rounded-full bg-brass px-4 text-sm text-ink disabled:opacity-50"
                onClick={() => {
                  setCameraError("");
                  const handle = handleRef.current;
                  if (!handle) return;
                  void handle
                    .startCamera()
                    .then(() => setMode("camera"))
                    .catch((error) => {
                      const message = cameraErrorMessage(error);
                      setCameraError(message);
                      onStatus(message);
                    });
                }}
              >
                Use my camera
              </button>
              <button
                type="button"
                disabled={!engineReady}
                className="min-h-11 rounded-full border border-line px-4 text-sm text-paper disabled:opacity-50"
                onClick={() => {
                  const handle = handleRef.current;
                  if (!handle) return;
                  void handle
                    .startStudio()
                    .then(() => setMode("studio"))
                    .catch((error) => onStatus(error instanceof Error ? error.message : "Studio photo failed."));
                }}
              >
                Studio photo — test only
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EngineButton({ label, onClick, primary = false, disabled = false }: { label: string; onClick: () => void; primary?: boolean; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={`pointer-events-auto min-h-11 rounded-full px-4 text-sm disabled:opacity-50 ${primary ? "bg-brass text-ink" : "bg-ink/80 text-paper"}`}>
      {label}
    </button>
  );
}
