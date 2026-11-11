/**
 * Synthetic live-video laboratory.
 * The subject is a list of numbers, not a person and not a generated frame.
 */

import { buildCondition } from "./conditioning.ts";
import { LiveTrack } from "./live-track.ts";
import { PerceptionCache, type Landmark } from "./perception.ts";
import { lockProduct, type ProductLock } from "./product-lock.ts";
import { merchantTryOnReady } from "./stream-study.ts";
import { TemporalEngine } from "./temporal.ts";

export type LabReport = {
  synthetic: true;
  personTested: false;
  generatedFrames: number;
  photographicFrames: number;
  displays: string[];
  sessions: number[];
  productLockIds: string[];
  phases: string[];
  recovered: boolean;
  readyForModel: false;
  merchantTryOnFromStream: false;
  meanCompositeMs: number;
  droppedFrames: number;
  appearanceConsistent: false;
  poseSamples: number;
};

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function garment(sku: string, hash: string): ProductLock {
  const locked = lockProduct({
    brandId: "brand-lab",
    sku,
    category: "shirt",
    imageRef: `asset://${sku}`,
    maskRef: `mask://${sku}`,
    geometryRef: `geom://${sku}`,
    colours: ["sand"],
    textureRef: `texture://${sku}`,
    patternRef: null,
    logoRefs: [`logo://${sku}`],
    material: "linen",
    sizeLabel: "M",
    measurementsCm: { chest: 96, length: 72, shoulder: 44 },
    contentHash: hash,
  });
  if (!locked.ok) throw new Error(locked.errors.join(" "));
  return locked.lock;
}

function pose(shift: number, visible: boolean): Landmark[] {
  const point = (x: number, y: number, on: boolean): Landmark => ({ x, y, visibility: on ? 1 : 0 });
  const marks = Array.from({ length: 33 }, () => point(0.5, 0.5, false));
  marks[0] = point(0.5 + shift, 0.18, visible);
  marks[11] = point(0.4 + shift, 0.34, visible);
  marks[12] = point(0.6 + shift, 0.34, visible);
  marks[13] = point(0.32 + shift, 0.5, visible);
  marks[14] = point(0.68 + shift, 0.5, visible);
  marks[15] = point(0.28 + shift, 0.66, visible);
  marks[16] = point(0.72 + shift, 0.66, visible);
  marks[23] = point(0.43 + shift, 0.72, visible);
  marks[24] = point(0.57 + shift, 0.72, visible);
  return marks;
}

export function runLiveLab(): LabReport {
  const perception = new PerceptionCache();
  const temporal = new TemporalEngine();
  const track = new LiveTrack();
  const session = track.openCamera();
  const first = garment("linen-shirt", HASH_A);
  const second = garment("black-shirt", HASH_B);
  let lock = first;
  const displays: string[] = [];
  const phases: string[] = [];
  const productLockIds: string[] = [];
  let recovered = false;
  let sawLost = false;
  let readyForModel = false;

  let at = 0;
  for (let i = 0; i < 18; i += 1) {
    const lost = i >= 8 && i <= 12;
    const atMs = (at += lost ? 200 : i === 6 ? 132 : 33);
    if (i === 5) {
      track.changeProduct(second.sku);
      lock = second;
    }
    const state = perception.update({
      atMs,
      face: lost ? null : [{ x: 0.5, y: 0.2, visibility: 1 }],
      pose: lost ? null : pose(i * 0.002, true),
      hands: lost ? [] : [Array.from({ length: 21 }, () => ({ x: 0.3, y: 0.7, visibility: 1 }))],
      silhouetteFresh: !lost,
    });
    const step = temporal.step({ atMs, perception: state, productLockId: lock.lockId });
    const packet = buildCondition({ lock, perception: state, temporal: step });
    readyForModel = packet.readyForModel;
    track.observe({
      atMs,
      cameraSession: session,
      productId: lock.sku,
      pose: state.occlusion !== "lost",
      fps: 30,
      compositeMs: 1 + (i % 3),
      receipt: null,
    });
    displays.push(step.display);
    phases.push(step.phase);
    productLockIds.push(step.productLockId ?? "");
    if (step.phase === "lost") sawLost = true;
    if (sawLost && step.phase === "tracking" && i > 12) recovered = true;
  }

  const summary = track.summary();
  return {
    synthetic: true,
    personTested: false,
    generatedFrames: summary.generatedFrames,
    photographicFrames: summary.photographicFrames,
    displays,
    sessions: summary.sessions,
    productLockIds,
    phases,
    recovered,
    readyForModel,
    merchantTryOnFromStream: merchantTryOnReady(),
    meanCompositeMs: summary.meanCompositeMs,
    droppedFrames: summary.droppedFrames,
    appearanceConsistent: false,
    poseSamples: temporal.poseHistoryLength(),
  };
}
