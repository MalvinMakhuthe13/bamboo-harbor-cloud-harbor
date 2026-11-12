/**
 * Measurement-only frame budget telemetry for the live mirror.
 *
 * This module deliberately does not change rendering quality or inference cadence.
 * It records frame timing so device-tier thresholds can be chosen from real data.
 */

export type BudgetRung = 0 | 1 | 2 | 3;

export type FrameBudgetSnapshot = {
  frameIntervalMs: number;
  frameWorkMs: number;
  meanFrameIntervalMs: number;
  p95FrameIntervalMs: number;
  meanFrameWorkMs: number;
  jankFrames: number;
  longestFrameMs: number;
  sampleCount: number;
  rung: BudgetRung;
  reason: "measurement-only";
};

export type FrameBudgetOptions = {
  windowSize?: number;
  jankThresholdMs?: number;
};

function safeMs(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export class FrameBudgetMonitor {
  private readonly windowSize: number;
  private readonly jankThresholdMs: number;
  private intervals: number[] = [];
  private workTimes: number[] = [];
  private frameIntervalMs = 0;
  private frameWorkMs = 0;
  private jankFrames = 0;
  private longestFrameMs = 0;
  private sampleCount = 0;

  constructor(options: FrameBudgetOptions = {}) {
    this.windowSize = Math.max(4, Math.floor(options.windowSize ?? 120));
    this.jankThresholdMs = safeMs(options.jankThresholdMs ?? 50) || 50;
  }

  observe(frameIntervalMs: number, frameWorkMs: number): FrameBudgetSnapshot {
    const interval = safeMs(frameIntervalMs);
    const work = safeMs(frameWorkMs);
    this.frameIntervalMs = interval;
    this.frameWorkMs = work;

    if (interval > 0) {
      this.push(this.intervals, interval);
      this.sampleCount += 1;
      this.longestFrameMs = Math.max(this.longestFrameMs, interval);
      if (interval > this.jankThresholdMs) this.jankFrames += 1;
    }
    if (work > 0) this.push(this.workTimes, work);

    return this.snapshot();
  }

  snapshot(): FrameBudgetSnapshot {
    const sorted = [...this.intervals].sort((a, b) => a - b);
    const intervalSum = this.intervals.reduce((sum, value) => sum + value, 0);
    const workSum = this.workTimes.reduce((sum, value) => sum + value, 0);
    const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);

    return {
      frameIntervalMs: round(this.frameIntervalMs),
      frameWorkMs: round(this.frameWorkMs),
      meanFrameIntervalMs: round(this.intervals.length ? intervalSum / this.intervals.length : 0),
      p95FrameIntervalMs: round(sorted.length ? sorted[p95Index]! : 0),
      meanFrameWorkMs: round(this.workTimes.length ? workSum / this.workTimes.length : 0),
      jankFrames: this.jankFrames,
      longestFrameMs: round(this.longestFrameMs),
      sampleCount: this.sampleCount,
      rung: 0,
      reason: "measurement-only",
    };
  }

  reset(): void {
    this.intervals = [];
    this.workTimes = [];
    this.frameIntervalMs = 0;
    this.frameWorkMs = 0;
    this.jankFrames = 0;
    this.longestFrameMs = 0;
    this.sampleCount = 0;
  }

  private push(target: number[], value: number): void {
    target.push(value);
    if (target.length > this.windowSize) target.shift();
  }
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
