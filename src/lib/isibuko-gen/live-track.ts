/** Live camera journal. A photographic frame is never recorded as a generated frame. */

import { applySessionEvent, type SessionState } from "../isibuko-ai/session.ts";
import { nextLiveAction, type LiveAction, type LiveSchedule } from "./live-schedule.ts";

export type InferenceReceipt = {
  generated: boolean;
  weightsPresent: boolean;
  outputPath: string | null;
};

export type LiveFrameNote = {
  atMs: number;
  cameraSession: number;
  productId: string | null;
  pose: boolean;
  fps: number;
  compositeMs: number;
  receipt: InferenceReceipt | null;
};

export type LiveFrameRecord = {
  kind: "photographic-fallback" | "model-generated";
  cameraSession: number;
  productId: string | null;
  unstable: boolean;
};

/** Pose and product identity kept across frames. There is no latent and no weight file here. */
export type TemporalCache = {
  productId: string | null;
  posePresent: boolean;
  keyframeIndex: number;
  framesSinceKeyframe: number;
  valid: boolean;
};

export type LiveObservation = {
  record: LiveFrameRecord;
  schedule: LiveSchedule;
  cache: TemporalCache;
  /** Scheduler output if a video model were attached. The model is not attached and is not called. */
  ifModelAttached: LiveAction;
  modelCalled: false;
};

/** Gaps wider than two 30 fps slots count as missed camera frames. This is not a model frame rate. */
const NOMINAL_FRAME_MS = 33;
const KEYFRAME_EVERY = 8;

export class LiveTrack {
  private state: SessionState = { session: 0, source: "off" };
  private lastPose = false;
  private lastAt: number | null = null;
  private generatedFrames = 0;
  private photographicFrames = 0;
  private unstableFrames = 0;
  private droppedFrames = 0;
  private compositeSum = 0;
  private compositeCount = 0;
  private maxCompositeMs = 0;
  private lastFps = 0;
  private readonly sessions = new Set<number>();
  private cache: TemporalCache = {
    productId: null,
    posePresent: false,
    keyframeIndex: 0,
    framesSinceKeyframe: 0,
    valid: false,
  };

  openCamera(): number {
    const next = applySessionEvent(this.state, "camera");
    this.state = { session: next.session, source: next.source };
    return this.state.session;
  }

  /** Product, colour, and size changes must not open a new camera session. */
  changeProduct(productId: string, event: "product" | "colour" | "size" = "product"): number {
    const before = this.state.session;
    const next = applySessionEvent(this.state, event);
    if (next.session !== before || next.restarted) {
      throw new Error("A product change restarted the camera session.");
    }
    this.state = { session: next.session, source: next.source };
    if (productId !== this.cache.productId) this.invalidateCache(productId);
    return this.state.session;
  }

  observe(note: LiveFrameNote): LiveObservation {
    if (this.lastAt !== null && note.atMs > this.lastAt) {
      const gap = note.atMs - this.lastAt;
      if (gap > NOMINAL_FRAME_MS * 2) {
        this.droppedFrames += Math.floor(gap / NOMINAL_FRAME_MS) - 1;
      }
    }
    this.lastAt = note.atMs;
    this.lastFps = note.fps;
    this.compositeSum += note.compositeMs;
    this.compositeCount += 1;
    this.maxCompositeMs = Math.max(this.maxCompositeMs, note.compositeMs);
    this.sessions.add(note.cameraSession);

    if (note.productId !== this.cache.productId || !note.pose) this.invalidateCache(note.productId);
    this.cache.posePresent = note.pose;
    this.cache.framesSinceKeyframe += 1;

    const generated = Boolean(note.receipt?.generated && note.receipt.weightsPresent && note.receipt.outputPath);
    const unstable = this.lastPose && !note.pose;
    this.lastPose = note.pose;
    if (generated) this.generatedFrames += 1;
    else this.photographicFrames += 1;
    if (unstable) this.unstableFrames += 1;

    const schedule = nextLiveAction({
      modelAttached: false,
      framesSinceKeyframe: this.cache.framesSinceKeyframe,
      keyframeEvery: KEYFRAME_EVERY,
    });
    const ifModelAttached = nextLiveAction({
      modelAttached: true,
      framesSinceKeyframe: this.cache.framesSinceKeyframe,
      keyframeEvery: KEYFRAME_EVERY,
    }).action;
    return {
      record: {
        kind: generated ? "model-generated" : "photographic-fallback",
        cameraSession: note.cameraSession,
        productId: note.productId,
        unstable,
      },
      schedule,
      cache: { ...this.cache },
      ifModelAttached,
      modelCalled: false,
    };
  }

  summary(): {
    generative: boolean;
    generatedFrames: number;
    photographicFrames: number;
    unstableFrames: number;
    droppedFrames: number;
    lastFps: number;
    meanCompositeMs: number;
    maxCompositeMs: number;
    sessions: number[];
    modelAttached: false;
    cacheValid: boolean;
  } {
    return {
      generative: this.generatedFrames > 0,
      generatedFrames: this.generatedFrames,
      photographicFrames: this.photographicFrames,
      unstableFrames: this.unstableFrames,
      droppedFrames: this.droppedFrames,
      lastFps: this.lastFps,
      meanCompositeMs: this.compositeCount ? this.compositeSum / this.compositeCount : 0,
      maxCompositeMs: this.maxCompositeMs,
      sessions: [...this.sessions],
      modelAttached: false,
      cacheValid: this.cache.valid,
    };
  }

  reset(): void {
    this.state = { session: 0, source: "off" };
    this.lastPose = false;
    this.lastAt = null;
    this.generatedFrames = 0;
    this.photographicFrames = 0;
    this.unstableFrames = 0;
    this.droppedFrames = 0;
    this.compositeSum = 0;
    this.compositeCount = 0;
    this.maxCompositeMs = 0;
    this.lastFps = 0;
    this.sessions.clear();
    this.cache = { productId: null, posePresent: false, keyframeIndex: 0, framesSinceKeyframe: 0, valid: false };
  }

  private invalidateCache(productId: string | null): void {
    this.cache = {
      productId,
      posePresent: false,
      keyframeIndex: this.cache.keyframeIndex,
      framesSinceKeyframe: 0,
      valid: false,
    };
  }
}

const mirrorTrack = new LiveTrack();

/** Called from the camera loop. The receipt is null until a real model frame exists. */
export function noteLiveFrame(note: LiveFrameNote): void {
  mirrorTrack.observe(note);
}

export function readLiveTrack(): ReturnType<LiveTrack["summary"]> {
  return mirrorTrack.summary();
}

export function resetLiveTrack(): void {
  mirrorTrack.reset();
}
