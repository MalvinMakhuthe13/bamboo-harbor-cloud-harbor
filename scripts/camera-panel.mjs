/** Reads numbers the mirror already prints. It does not invent a rate that is absent. */

export function parseCameraPanel(panel) {
  const live = panel.includes("Live. Frames stay on this device.");
  const blank = {
    live,
    fps: null,
    faceHz: null,
    poseHz: null,
    handHz: null,
    segmentHz: null,
    compositeMs: null,
    cameraSession: null,
    motion: null,
    faceFound: null,
  };
  if (!live) return blank;
  const take = (pattern) => {
    const match = panel.match(pattern);
    return match ? Number(match[1]) : null;
  };
  return {
    live: true,
    fps: take(/(\d+) fps/),
    faceHz: take(/(?:found|missing) · (\d+) Hz/),
    poseHz: take(/pose (\d+) Hz/),
    handHz: take(/Hands\s+\d+ · (\d+) Hz/),
    segmentHz: take(/(?:mask|none) · (\d+) Hz/),
    compositeMs: take(/Composite\s+(\d+(?:\.\d+)?) ms/),
    cameraSession: take(/Session\s+(\d+)/),
    motion: (panel.match(/Motion\s+(still|moving|turning|unknown)/) || [])[1] ?? null,
    faceFound: panel.includes("found ·") ? true : panel.includes("missing ·") ? false : null,
  };
}
