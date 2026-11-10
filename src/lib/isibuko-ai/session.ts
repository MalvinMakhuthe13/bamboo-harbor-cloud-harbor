/** Camera-session rules. The mirror calls these so a product change cannot mint a new session. */

export type Source = "off" | "camera" | "studio";

export type SessionState = { session: number; source: Source };

export type SessionEvent = "camera" | "studio" | "stop" | "product" | "colour" | "size";

export function applySessionEvent(state: SessionState, event: SessionEvent): SessionState & { restarted: boolean } {
  if (event === "camera") return { session: state.session + 1, source: "camera", restarted: true };
  if (event === "studio") return { session: state.session + 1, source: "studio", restarted: true };
  if (event === "stop") return { session: state.session, source: "off", restarted: false };
  return { session: state.session, source: state.source, restarted: false };
}

/** A second "use my camera" must not open another stream while the first is live. */
export function reuseLiveCamera(source: Source, tracks: { readyState: string }[]): boolean {
  return source === "camera" && tracks.some((track) => track.readyState === "live");
}

export function cameraErrorMessage(error: unknown): string {
  const name = error && typeof error === "object" && "name" in error ? String((error as { name: unknown }).name) : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "Camera permission was blocked. Allow the camera for this site, then try again. The studio photo is still only a test.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No camera was found on this device.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "The camera is busy in another app. Close it there, then try again.";
  }
  if (name === "SecurityError") return "This page is not allowed to use the camera.";
  if (error instanceof Error && error.message) return error.message;
  return "The camera could not start.";
}
