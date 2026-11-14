import type { CaptureSample } from "./capture.ts";

/**
 * A single listener. The engine calls emit only when one is registered.
 * Registering happens after a visible consent checkbox and a Start press.
 */
type Listener = (sample: CaptureSample) => void;

let listener: Listener | null = null;

export function captureListenerCount(): number {
  return listener ? 1 : 0;
}

export function subscribeCapture(next: Listener): () => void {
  listener = next;
  return () => {
    if (listener === next) listener = null;
  };
}

export function emitCapture(sample: CaptureSample): void {
  listener?.(sample);
}
