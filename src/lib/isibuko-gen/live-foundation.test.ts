import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildCondition } from "./conditioning.ts";
import { runLiveLab } from "./live-lab.ts";
import { PerceptionCache, type Landmark, type PerceptionState } from "./perception.ts";
import { lockProduct, sameGarment } from "./product-lock.ts";
import { STREAM_DIFFUSION_V2, WAN_T2V_1_3B, merchantTryOnReady } from "./stream-study.ts";
import { TemporalEngine } from "./temporal.ts";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function pose(shift: number): Landmark[] {
  const point = (x: number, y: number): Landmark => ({ x, y, visibility: 1 });
  const marks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0 }));
  marks[0] = point(0.5, 0.18);
  marks[11] = point(0.4 + shift, 0.34);
  marks[12] = point(0.6 + shift, 0.34);
  marks[13] = point(0.32, 0.5);
  marks[14] = point(0.68, 0.5);
  marks[15] = point(0.28, 0.66);
  marks[16] = point(0.72, 0.66);
  marks[23] = point(0.43, 0.72);
  marks[24] = point(0.57, 0.72);
  return marks;
}

function sample(atMs: number, shift: number, fresh = true) {
  return {
    atMs,
    face: [{ x: 0.5, y: 0.2, visibility: 1 }],
    pose: pose(shift),
    hands: [Array.from({ length: 21 }, () => ({ x: 0.3, y: 0.7, visibility: 1 }))],
    silhouetteFresh: fresh,
  };
}

describe("perception cache", () => {
  it("reuses a held pose inside the TTL and drops it after the TTL", () => {
    const cache = new PerceptionCache();
    const first = cache.update(sample(0, 0));
    assert.equal(first.shoulders, 2);
    assert.equal(first.torso, true);
    assert.equal(first.arms, 2);
    assert.equal(first.hands >= 1, true);
    assert.equal(first.face, true);
    assert.equal(first.head, true);
    assert.equal(first.silhouette, true);
    assert.equal(first.occlusion, "clear");
    assert.equal(first.reused.pose, false);

    const held = cache.update({ atMs: 100, face: null, pose: null, hands: [], silhouetteFresh: false });
    assert.equal(held.reused.pose, true);
    assert.equal(held.reused.face, true);
    assert.equal(held.reused.hands, true);
    assert.equal(held.reused.silhouette, true);
    assert.equal(held.occlusion, "clear");
    assert.equal(held.motion, "unknown");

    const expired = cache.update({ atMs: 100 + 161, face: null, pose: null, hands: [], silhouetteFresh: false });
    assert.equal(expired.reused.pose, false);
    assert.equal(expired.shoulders, 0);
    assert.equal(expired.occlusion, "lost");
    assert.equal(expired.motion, "unknown");
    assert.equal(expired.reused.silhouette, true);
  });

  it("keeps the last motion when the next sample is a cache hit", () => {
    const cache = new PerceptionCache();
    cache.update(sample(0, 0));
    const moved = cache.update(sample(33, 0.02));
    assert.equal(moved.motion, "moving");
    const held = cache.update({ atMs: 66, face: null, pose: null, hands: [], silhouetteFresh: false });
    assert.equal(held.reused.pose, true);
    assert.equal(held.motion, "moving");
  });
});

describe("merchant product lock", () => {
  it("refuses a product that has no sku hash and keeps two assets distinct", () => {
    const rejected = lockProduct({
      brandId: "brand-lab",
      sku: "linen-shirt",
      category: "shirt",
      imageRef: "asset://linen-shirt",
      maskRef: null,
      geometryRef: null,
      colours: ["sand"],
      textureRef: null,
      patternRef: null,
      logoRefs: [],
      material: "linen",
      sizeLabel: "M",
      measurementsCm: {},
      contentHash: "not-a-hash",
    });
    assert.equal(rejected.ok, false);

    const fields = {
      brandId: "brand-lab",
      category: "shirt",
      maskRef: "mask://shirt",
      geometryRef: "geom://shirt",
      colours: ["sand"],
      textureRef: "texture://shirt",
      patternRef: "pattern://stripe",
      logoRefs: ["logo://mark"],
      material: "linen",
      sizeLabel: "M",
      measurementsCm: { chest: 96, length: 72, shoulder: 44 },
    };
    const first = lockProduct({ ...fields, sku: "linen-shirt", imageRef: "asset://linen", contentHash: HASH_A });
    const second = lockProduct({ ...fields, sku: "linen-shirt", imageRef: "asset://linen", contentHash: HASH_B });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (!first.ok || !second.ok) return;
    assert.equal(first.lock.measurementsComplete, true);
    assert.equal(sameGarment(first.lock, second.lock), false);
    assert.equal(first.lock.lockId.includes("linen-shirt"), true);
    assert.equal(first.lock.lockId.endsWith(HASH_A), true);
  });
});

describe("temporal engine", () => {
  const clear = (atMs: number): PerceptionState => ({
    atMs,
    face: true,
    head: true,
    shoulders: 2,
    torso: true,
    arms: 2,
    hands: 1,
    silhouette: true,
    occlusion: "clear",
    motion: "still",
    reused: { face: false, pose: false, hands: false, silhouette: false },
  });

  it("stays photographic, plans keyframes, and recovers only after a real tracking loss", () => {
    const engine = new TemporalEngine();
    const lock = `brand-lab:linen-shirt:${HASH_A}`;
    let requested = false;
    for (let i = 0; i < 8; i += 1) {
      const step = engine.step({ atMs: i * 33, perception: clear(i * 33), productLockId: lock });
      assert.equal(step.display, "photographic-fallback");
      assert.equal(step.schedule, "photographic-fallback");
      assert.equal(step.propagated, false);
      assert.equal(step.appearanceConsistent, false);
      assert.equal(step.featureRef, null);
      assert.equal(step.generatedFrames, 0);
      if (step.ifModelAttached === "request-keyframe") requested = true;
    }
    assert.equal(requested, true);
    assert.equal(engine.poseHistoryLength(), 8);

    for (let i = 0; i < 5; i += 1) {
      const step = engine.step({
        atMs: 1000 + i * 40,
        perception: { ...clear(1000), occlusion: "lost", shoulders: 0, torso: false, arms: 0 },
        productLockId: lock,
      });
      assert.equal(step.phase, i < 4 ? "recovering" : "lost");
    }
    const returning = engine.step({ atMs: 1300, perception: clear(1300), productLockId: lock });
    assert.equal(returning.phase, "recovering");
    const tracked = engine.step({ atMs: 1333, perception: clear(1333), productLockId: lock });
    assert.equal(tracked.phase, "tracking");

    const changed = engine.step({ atMs: 1366, perception: clear(1366), productLockId: `brand-lab:other:${HASH_B}` });
    assert.equal(changed.productChanged, true);
    assert.equal(changed.productLockId?.endsWith(HASH_B), true);
    assert.equal(engine.history().length <= 24, true);
  });

  it("does not label a missing path as a generated frame", () => {
    const engine = new TemporalEngine();
    const lock = `brand-lab:linen-shirt:${HASH_A}`;
    engine.step({ atMs: 0, perception: clear(0), productLockId: lock });
    const missing = engine.acceptGeneratedFile("/tmp/isibuko-does-not-exist-tryon.png");
    assert.equal(missing.ok, false);
    assert.equal(engine.history()[0]?.kind, "photographic-fallback");
    const empty = engine.acceptGeneratedFile("  ");
    assert.equal(empty.ok, false);

    const dir = mkdtempSync(join(tmpdir(), "isibuko-live-"));
    const file = join(dir, "marker.txt");
    writeFileSync(file, "not an image");
    try {
      const recorded = engine.acceptGeneratedFile(file);
      assert.equal(recorded.ok, true);
      assert.match(recorded.reason, /not decoded/i);
      assert.equal(engine.history().at(-1)?.kind, "model-generated");
      assert.equal(engine.history().at(-1)?.featureRef, null);
      const next = engine.step({ atMs: 33, perception: clear(33), productLockId: lock });
      assert.equal(next.display, "photographic-fallback");
      assert.equal(next.appearanceConsistent, false);
      assert.equal(next.propagated, false);
      assert.equal(next.featureRef, null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("streaming study and conditioning", () => {
  it("does not treat Wan or StreamDiffusionV2 as merchant try-on", () => {
    assert.equal(WAN_T2V_1_3B.providesMerchantTryOn, false);
    assert.equal(WAN_T2V_1_3B.weightsDownloaded, false);
    assert.equal(WAN_T2V_1_3B.commercial, "cleared-weights");
    assert.equal(WAN_T2V_1_3B.absentInputs.includes("Merchant sku"), true);
    assert.equal(STREAM_DIFFUSION_V2.providesMerchantTryOn, false);
    assert.equal(STREAM_DIFFUSION_V2.commercial, "not-cleared");
    assert.match(STREAM_DIFFUSION_V2.licence, /CC|NonCommercial|CausVid/i);
    assert.equal(merchantTryOnReady(WAN_T2V_1_3B), false);
    assert.equal(merchantTryOnReady(STREAM_DIFFUSION_V2), false);
  });

  it("builds a condition packet that is not ready for a model", () => {
    const locked = lockProduct({
      brandId: "brand-lab",
      sku: "linen-shirt",
      category: "shirt",
      imageRef: "asset://linen",
      maskRef: null,
      geometryRef: null,
      colours: ["sand"],
      textureRef: "texture://linen",
      patternRef: null,
      logoRefs: [],
      material: "linen",
      sizeLabel: null,
      measurementsCm: { chest: 96 },
      contentHash: HASH_A,
    });
    assert.equal(locked.ok, true);
    if (!locked.ok) return;
    const perception: PerceptionState = {
      atMs: 0,
      face: true,
      head: true,
      shoulders: 1,
      torso: false,
      arms: 1,
      hands: 0,
      silhouette: false,
      occlusion: "partial",
      motion: "still",
      reused: { face: false, pose: false, hands: false, silhouette: false },
    };
    const temporal = new TemporalEngine().step({ atMs: 0, perception, productLockId: locked.lock.lockId });
    const packet = buildCondition({ lock: locked.lock, perception, temporal });
    assert.equal(packet.readyForModel, false);
    assert.equal(packet.previousFeatureRef, null);
    assert.equal(packet.textureRef, "texture://linen");
    assert.equal(packet.measurementsCm.chest, 96);
    assert.equal(packet.missing.some((item) => item.includes("No video model")), true);
    assert.equal(packet.missing.some((item) => item.includes("mask")), true);
    assert.equal(packet.missing.some((item) => item.includes("geometry")), true);
    assert.equal(packet.missing.some((item) => item.includes("measurements")), true);
    assert.equal(packet.missing.some((item) => item.includes("partial")), true);
    assert.equal(packet.missing.some((item) => item.includes("latent")), true);
  });
});

describe("synthetic live laboratory", () => {
  it("keeps one session, switches products, recovers tracking, and generates nothing", () => {
    const report = runLiveLab();
    assert.equal(report.synthetic, true);
    assert.equal(report.personTested, false);
    assert.equal(report.generatedFrames, 0);
    assert.equal(report.photographicFrames, 18);
    assert.equal(report.readyForModel, false);
    assert.equal(report.merchantTryOnFromStream, false);
    assert.equal(report.appearanceConsistent, false);
    assert.equal(report.recovered, true);
    assert.deepEqual(report.sessions, [1]);
    assert.equal(new Set(report.displays).size, 1);
    assert.equal(report.displays[0], "photographic-fallback");
    assert.equal(new Set(report.productLockIds).size, 2);
    assert.equal(report.phases.includes("lost"), true);
    assert.equal(report.phases.at(-1), "tracking");
    assert.equal(report.droppedFrames, 28);
    assert.equal(report.meanCompositeMs, 2);
    assert.equal(report.poseSamples, 13);
  });
});
