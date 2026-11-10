import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { startEngine, type Drag, type EngineHandle } from "@/lib/isibuko-ai/engine";
import type { FrameRequest, LiveMetrics } from "@/lib/isibuko-ai/types";

export function Stage({
  requestRef,
  dragRef,
  onMetrics,
  onStatus,
}: {
  requestRef: { current: FrameRequest };
  dragRef: { current: Drag };
  onMetrics: (metrics: LiveMetrics) => void;
  onStatus: (status: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<EngineHandle | null>(null);

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
        autoStudio: true,
      });
    } catch (error) {
      onStatus(error instanceof Error ? error.message : "The mirror could not start.");
      return;
    }
    handleRef.current = handle;
    return () => {
      handle.dispose();
      handleRef.current = null;
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
        <EngineButton label="My camera" onClick={() => void handleRef.current?.startCamera().catch((error) => onStatus(error instanceof Error ? error.message : "Camera permission was blocked."))} />
        <EngineButton label="Studio photo" onClick={() => void handleRef.current?.startStudio().catch((error) => onStatus(error instanceof Error ? error.message : "Studio photo failed."))} />
      </div>
    </div>
  );
}

function EngineButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="pointer-events-auto min-h-11 rounded-full bg-ink/80 px-4 text-sm text-paper">
      {label}
    </button>
  );
}
