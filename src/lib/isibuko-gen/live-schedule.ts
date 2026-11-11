/** Continuous-video schedule. One diffusion call per camera frame is not the design. */

export type LiveAction = "photographic-fallback" | "reuse-cached-conditioning" | "request-keyframe";

export type LiveSchedule = {
  action: LiveAction;
  modelAttached: false | true;
  reason: string;
};

/**
 * With no video model attached, every displayed frame stays the photographic composite.
 * A future model would generate on a keyframe and reuse pose, product id, and the last
 * latent between keyframes. That model is not attached.
 */
export function nextLiveAction(input: {
  modelAttached: boolean;
  framesSinceKeyframe: number;
  keyframeEvery: number;
}): LiveSchedule {
  if (!input.modelAttached) {
    return {
      action: "photographic-fallback",
      modelAttached: false,
      reason: "No generative video model is attached. The camera frame is not sent to an image model.",
    };
  }
  if (input.keyframeEvery < 2) {
    return {
      action: "photographic-fallback",
      modelAttached: true,
      reason: "A keyframe on every camera frame is rejected. The schedule is not ready.",
    };
  }
  if (input.framesSinceKeyframe < input.keyframeEvery) {
    return {
      action: "reuse-cached-conditioning",
      modelAttached: true,
      reason: "Reuse the cached pose and the last keyframe. No new diffusion call on this frame.",
    };
  }
  return {
    action: "request-keyframe",
    modelAttached: true,
    reason: "A keyframe would be requested. The caller must still refuse if no weights are loaded.",
  };
}
