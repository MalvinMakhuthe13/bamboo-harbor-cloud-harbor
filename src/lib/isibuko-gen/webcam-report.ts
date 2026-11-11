/** Separates a real camera probe from the synthetic laboratory. This file does not open a camera. */

export type DeviceProbe = {
  fakeDevice: boolean;
  videoInputs: number;
  opened: boolean;
  errorName: string | null;
  pageError: string | null;
  fps: number | null;
  faceHz: number | null;
  poseHz: number | null;
  handHz: number | null;
  segmentHz: number | null;
  compositeMs: number | null;
  cameraSession: number | null;
  productSwitchKeptSession: boolean | null;
};

export type WebcamMeasurement = {
  kind: "webcam" | "no-camera" | "synthetic-device";
  personTested: false;
  measurements: {
    fps: number;
    faceHz: number;
    poseHz: number;
    handHz: number;
    segmentHz: number;
    compositeMs: number;
    cameraSession: number;
  } | null;
  discardedRates: boolean;
  reason: string;
};

export function classifyProbe(probe: DeviceProbe): WebcamMeasurement {
  if (probe.fakeDevice) {
    return {
      kind: "synthetic-device",
      personTested: false,
      measurements: null,
      discardedRates: probe.fps !== null,
      reason: "A fake media device is not a webcam measurement.",
    };
  }
  const granted = probe.opened && probe.videoInputs > 0 && probe.errorName === null;
  if (!granted) {
    return {
      kind: "no-camera",
      personTested: false,
      measurements: null,
      discardedRates: probe.fps !== null || probe.faceHz !== null,
      reason: probe.errorName ?? probe.pageError ?? "No camera stream opened.",
    };
  }
  if (
    probe.fps === null ||
    probe.faceHz === null ||
    probe.poseHz === null ||
    probe.handHz === null ||
    probe.segmentHz === null ||
    probe.compositeMs === null ||
    probe.cameraSession === null
  ) {
    return {
      kind: "webcam",
      personTested: false,
      measurements: null,
      discardedRates: false,
      reason: "A camera opened, but the mirror did not publish a complete rate set. A person was not confirmed.",
    };
  }
  return {
    kind: "webcam",
    personTested: false,
    measurements: {
      fps: probe.fps,
      faceHz: probe.faceHz,
      poseHz: probe.poseHz,
      handHz: probe.handHz,
      segmentHz: probe.segmentHz,
      compositeMs: probe.compositeMs,
      cameraSession: probe.cameraSession,
    },
    discardedRates: false,
    reason: "Rates came from a real camera stream. humanDetected is still false until a person is confirmed in frame.",
  };
}
