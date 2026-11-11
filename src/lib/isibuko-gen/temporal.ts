/**
 * Frame history for a future video model.
 * No slot here is a generated image unless an existing file path is accepted.
 * Do not import this module from the camera page. The camera stays on the photographic composite.
 */

import { statSync } from "node:fs";
import { nextLiveAction, type LiveAction } from "./live-schedule.ts";
import type { PerceptionState } from "./perception.ts";

export type DisplayKind = "photographic-fallback" | "model-generated";

export type TemporalFrame = {
  index: number;
  atMs: number;
  kind: DisplayKind;
  productLockId: string | null;
  occlusion: PerceptionState["occlusion"];
  featureRef: null;
};

export type TemporalStep = {
  display: DisplayKind;
  phase: "tracking" | "recovering" | "lost";
  schedule: LiveAction;
  ifModelAttached: LiveAction;
  productLockId: string | null;
  productChanged: boolean;
  appearanceConsistent: false;
  featureRef: null;
  /** False until a generated feature exists. The schedule may still plan a reuse. */
  propagated: boolean;
  generatedFrames: number;
};

export type PoseSnapshot = {
  atMs: number;
  shoulders: number;
  torso: boolean;
  arms: number;
  hands: number;
  occlusion: PerceptionState["occlusion"];
};

const HISTORY = 24;
const KEYFRAME_EVERY = 8;

export class TemporalEngine {
  private frames: TemporalFrame[] = [];
  private poses: PoseSnapshot[] = [];
  private lockId: string | null = null;
  private lostStreak = 0;
  private phase: TemporalStep["phase"] = "tracking";
  private generatedFrames = 0;
  private framesSinceKeyframe = 0;
  private occlusions: PerceptionState["occlusion"][] = [];

  step(input: { atMs: number; perception: PerceptionState; productLockId: string | null }): TemporalStep {
    const productChanged = input.productLockId !== this.lockId;
    if (productChanged) {
      this.lockId = input.productLockId;
      this.framesSinceKeyframe = 0;
      this.generatedFrames = 0;
    }
    if (input.perception.occlusion === "lost") {
      this.lostStreak += 1;
      this.phase = this.lostStreak > 4 ? "lost" : "recovering";
    } else if (this.phase === "lost" || this.phase === "recovering") {
      if (this.lostStreak > 0) {
        this.lostStreak = 0;
        this.phase = "recovering";
      } else {
        this.phase = "tracking";
      }
    } else {
      this.phase = "tracking";
    }
    this.occlusions.push(input.perception.occlusion);
    if (this.occlusions.length > HISTORY) this.occlusions.shift();
    if (input.perception.shoulders === 2) {
      this.poses.push({
        atMs: input.atMs,
        shoulders: input.perception.shoulders,
        torso: input.perception.torso,
        arms: input.perception.arms,
        hands: input.perception.hands,
        occlusion: input.perception.occlusion,
      });
    }
    if (this.poses.length > HISTORY) this.poses.shift();

    this.framesSinceKeyframe += 1;
    const schedule = nextLiveAction({
      modelAttached: false,
      framesSinceKeyframe: this.framesSinceKeyframe,
      keyframeEvery: KEYFRAME_EVERY,
    });
    const ifModelAttached = nextLiveAction({
      modelAttached: true,
      framesSinceKeyframe: this.framesSinceKeyframe,
      keyframeEvery: KEYFRAME_EVERY,
    }).action;
    const frame: TemporalFrame = {
      index: this.frames.length,
      atMs: input.atMs,
      kind: "photographic-fallback",
      productLockId: this.lockId,
      occlusion: input.perception.occlusion,
      featureRef: null,
    };
    this.frames.push(frame);
    if (this.frames.length > HISTORY) this.frames.shift();
    return {
      display: "photographic-fallback",
      phase: this.phase,
      schedule: schedule.action,
      ifModelAttached,
      productLockId: this.lockId,
      productChanged,
      appearanceConsistent: false,
      featureRef: null,
      propagated: false,
      generatedFrames: this.generatedFrames,
    };
  }

  /** A generated file can be recorded only by path. This method is not called by the camera. */
  acceptGeneratedFile(outputPath: string): { ok: boolean; reason: string } {
    if (!outputPath.trim()) return { ok: false, reason: "An empty path is not a generated frame." };
    let isFile = false;
    try {
      isFile = statSync(outputPath).isFile();
    } catch {
      isFile = false;
    }
    if (!isFile) return { ok: false, reason: "The path is not an existing file. No frame was labeled generated." };
    const last = this.frames.at(-1);
    if (!last) return { ok: false, reason: "There is no frame to attach a file to." };
    last.kind = "model-generated";
    this.generatedFrames += 1;
    this.framesSinceKeyframe = 0;
    return { ok: true, reason: "The path was recorded. The file was not decoded and no latent features were stored." };
  }

  history(): TemporalFrame[] {
    return this.frames.map((frame) => ({ ...frame }));
  }

  poseHistory(): PoseSnapshot[] {
    return this.poses.map((pose) => ({ ...pose }));
  }

  poseHistoryLength(): number {
    return this.poses.length;
  }

  occlusionHistory(): PerceptionState["occlusion"][] {
    return [...this.occlusions];
  }

  /** Streaming slots a future generator would fill. Every learned slot stays empty. */
  featureState(): {
    previousGeneratedFeature: null;
    latent: null;
    garmentAppearance: null;
    temporalAttention: "not-attached";
    motionRefinement: "not-attached";
    occlusionHistory: PerceptionState["occlusion"][];
    phase: TemporalStep["phase"];
  } {
    return {
      previousGeneratedFeature: null,
      latent: null,
      garmentAppearance: null,
      temporalAttention: "not-attached",
      motionRefinement: "not-attached",
      occlusionHistory: this.occlusionHistory(),
      phase: this.phase,
    };
  }
}
