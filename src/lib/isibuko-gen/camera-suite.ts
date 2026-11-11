/** Camera test procedure. This module does not open a camera. */

export const CAMERA_STEPS = [
  "Open the mirror only in a test environment.",
  "Ask for camera permission. Do not call getUserMedia before that.",
  "Record whether a person is actually in the frame.",
  "Select a catalogue product and confirm the session number does not change.",
  "Stop the camera. Confirm the next start is a new session.",
  "Do not keep frames for training.",
  "Do not upload frames unless a separate consent record names the provider.",
] as const;

export type CameraPermission = "granted" | "denied" | "not-found" | "not-run";

export type CameraReport = {
  permission: CameraPermission;
  humanDetected: boolean;
  device: string;
  sessionBefore: number;
  sessionAfterProductChange: number;
  framesKeptForTraining: boolean;
  externalUpload: boolean;
};

export function acceptCameraReport(report: CameraReport): { personTested: boolean; errors: string[] } {
  const errors: string[] = [];
  if (report.permission !== "granted") errors.push("No granted camera. A studio still is not this test.");
  if (!report.humanDetected) errors.push("No person was detected.");
  if (!report.device.trim()) errors.push("Name the machine. A missing device is not a pass.");
  if (!(report.sessionBefore > 0) || report.sessionAfterProductChange !== report.sessionBefore) {
    errors.push("The product change must keep the same camera session.");
  }
  if (report.framesKeptForTraining) errors.push("Try-on frames are not a training set.");
  if (report.externalUpload) errors.push("An external upload needs its own consent record, which this report does not carry.");
  return { personTested: errors.length === 0, errors };
}
