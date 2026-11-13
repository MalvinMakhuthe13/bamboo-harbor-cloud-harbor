import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_PRODUCTS } from "./catalog.ts";
import { FRAME_POLICY } from "./privacy.ts";
import type { Category, SizeRow } from "./types.ts";
import {
  AI_CAPABILITIES,
  CATEGORY_REQUIRED,
  chartMeasurementKeys,
  defaultProvider,
  disabledProvider,
  localFitProvider,
  requestCapability,
  requestFit,
  selectProvider,
  type AiProvider,
  type FitMeasurements,
  type FitRequest,
} from "./advisor.ts";

const wigSizes: SizeRow[] = [
  { label: "Petite", head: [51, 54] },
  { label: "Average", head: [54, 57] },
];

const shirtSizes: SizeRow[] = [
  { label: "S", chest: [82, 90], waist: [66, 74], shoulder: [38, 42] },
  { label: "M", chest: [90, 98], waist: [74, 82], shoulder: [42, 45] },
];

function request(extra: Partial<FitRequest> = {}): FitRequest {
  return {
    productId: "wig-bob",
    category: "wig",
    sizes: wigSizes,
    measurements: { headCircCm: 55 },
    ...extra,
  };
}

function spyProvider(): AiProvider & { seen: FitRequest | null; calls: number } {
  const spy = {
    id: "isibuko.spy",
    runsOnDevice: true,
    capabilities: ["fit"] as const,
    seen: null as FitRequest | null,
    calls: 0,
    adviseFit(input: FitRequest) {
      spy.calls += 1;
      spy.seen = input;
      return localFitProvider.adviseFit(input);
    },
  };
  return spy;
}

describe("Isibuko AI advisor", () => {
  it("keeps camera frames on the device", () => {
    assert.equal(FRAME_POLICY.externalInference, false);
    assert.equal(FRAME_POLICY.leavesDevice, false);
    assert.deepEqual(AI_CAPABILITIES, ["attributes", "fit", "recommend", "generate"]);
  });

  it("follows the house catalogue charts and does not invent a chart", () => {
    for (const product of DEFAULT_PRODUCTS) {
      for (const key of chartMeasurementKeys(product.sizes)) {
        assert.ok(
          CATEGORY_REQUIRED[product.category].includes(key),
          `${product.id} chart uses ${key}, which is not required for ${product.category}`,
        );
      }
    }
    assert.deepEqual(CATEGORY_REQUIRED.nails, []);
    assert.deepEqual(CATEGORY_REQUIRED.earrings, []);
    assert.deepEqual(CATEGORY_REQUIRED.skirt, []);
  });

  it("defaults to the disabled provider and can switch to local fit", () => {
    assert.equal(defaultProvider, disabledProvider);
    assert.equal(selectProvider(null).id, disabledProvider.id);
    assert.equal(selectProvider("gemini").id, disabledProvider.id);
    assert.equal(selectProvider(localFitProvider.id), localFitProvider);
    assert.equal(localFitProvider.runsOnDevice, true);
    assert.deepEqual(localFitProvider.capabilities, ["fit"]);
  });

  it("refuses fit help while disabled and does not invent a size", async () => {
    const result = await requestFit(disabledProvider, request());
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "DISABLED");
    assert.equal(result.source, "disabled");
  });

  it("explains a local wig size only from head circumference", async () => {
    const result = await requestFit(localFitProvider, request());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.size, "Average");
    assert.equal(result.source, "local-measurements");
    assert.match(result.explanation, /head/);
    assert.match(result.explanation, /No image left the device/);
  });

  it("refuses a shirt until chest, waist and shoulder are all present", async () => {
    const spy = spyProvider();
    const partial = await requestFit(spy, request({
      productId: "shirt-linen",
      category: "shirt",
      sizes: shirtSizes,
      measurements: { chestCm: 94, shoulderCm: 43 },
    }));
    assert.equal(partial.ok, false);
    if (!partial.ok) {
      assert.equal(partial.code, "MISSING_MEASUREMENTS");
      assert.match(partial.reason, /waist/);
    }
    assert.equal(spy.calls, 0);

    const complete = await requestFit(localFitProvider, request({
      productId: "shirt-linen",
      category: "shirt",
      sizes: shirtSizes,
      measurements: { chestCm: 94, waistCm: 78, shoulderCm: 43 },
    }));
    assert.equal(complete.ok, true);
    if (complete.ok) assert.equal(complete.size, "M");
  });

  it("refuses pants without hip, glasses without face width, and a ring without finger width", async () => {
    const pants = await requestFit(localFitProvider, request({
      category: "pants",
      sizes: [{ label: "M", waist: [74, 82], hip: [96, 104] }],
      measurements: { waistCm: 78 },
    }));
    assert.equal(pants.ok, false);
    if (!pants.ok) assert.match(pants.reason, /hip/);

    const glasses = await requestFit(localFitProvider, request({
      category: "glasses",
      sizes: [{ label: "Medium", face: [13, 14.4] }],
      measurements: { headCircCm: 56 },
    }));
    assert.equal(glasses.ok, false);
    if (!glasses.ok) assert.match(glasses.reason, /face width/);

    const ring = await requestFit(localFitProvider, request({
      category: "ring",
      sizes: [{ label: "R", finger: [1.6, 1.75] }],
      measurements: {},
    }));
    assert.equal(ring.ok, false);
    if (!ring.ok) assert.match(ring.reason, /finger/);
  });

  it("does not suggest a size for a category with no chart", async () => {
    for (const category of ["nails", "earrings", "necklace", "bracelet", "skirt"] as const satisfies readonly Category[]) {
      const result = await requestFit(localFitProvider, request({ category, sizes: [], measurements: { headCircCm: 55 } }));
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.reason, /no size chart/);
    }
  });

  it("rejects unexpected top-level properties before the provider runs", async () => {
    const spy = spyProvider();
    const framed = request() as FitRequest & { frame: Uint8Array };
    framed.frame = new Uint8Array([1, 2, 3]);
    const result = await requestFit(spy, framed);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "UNEXPECTED_INPUT");
    assert.equal(spy.calls, 0);
  });

  it("rejects nested media on an otherwise valid measurement", async () => {
    const spy = spyProvider();
    const dirty = request({
      measurements: { headCircCm: 55, pixels: { data: [1, 2, 3] } } as FitMeasurements,
    });
    const result = await requestFit(spy, dirty);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "UNEXPECTED_INPUT");
    assert.equal(spy.calls, 0);
  });

  it("gives the provider a new object that contains only allowlisted measurements", async () => {
    const spy = spyProvider();
    const original: FitMeasurements = { headCircCm: 55, chestCm: null };
    const result = await requestFit(spy, request({ measurements: original }));
    assert.equal(result.ok, true);
    assert.equal(spy.calls, 1);
    assert.ok(spy.seen);
    assert.notEqual(spy.seen.measurements, original);
    assert.deepEqual(spy.seen.measurements, { headCircCm: 55 });
    assert.equal(Object.hasOwn(spy.seen, "frame"), false);
    assert.equal(Object.hasOwn(spy.seen.measurements, "pixels"), false);
  });

  it("cancels an already aborted request and aborts the provider signal", async () => {
    const caller = AbortSignal.abort();
    let providerSignal: AbortSignal | undefined;
    const provider: AiProvider = {
      id: "isibuko.spy",
      runsOnDevice: true,
      capabilities: ["fit"],
      adviseFit(input) {
        providerSignal = input.signal;
        return localFitProvider.adviseFit(input);
      },
    };
    const result = await requestFit(provider, request({ signal: caller }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "ABORTED");
    assert.equal(providerSignal, undefined);
  });

  it("aborts the provider signal when the caller cancels", async () => {
    const caller = new AbortController();
    let providerSignal: AbortSignal | undefined;
    const provider: AiProvider = {
      id: "isibuko.slow",
      runsOnDevice: true,
      capabilities: ["fit"],
      adviseFit(input) {
        providerSignal = input.signal;
        return new Promise((resolve) => {
          input.signal?.addEventListener("abort", () => {
            resolve(refusalLike());
          });
        });
      },
    };
    const pending = requestFit(provider, request({ signal: caller.signal, timeoutMs: 500 }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    caller.abort();
    const result = await pending;
    assert.equal(providerSignal?.aborted, true);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "ABORTED");
  });

  it("times out by aborting the provider, and ignores a size that arrives afterwards", async () => {
    let providerSignal: AbortSignal | undefined;
    let late: string | null = null;
    const provider: AiProvider = {
      id: "isibuko.hang",
      runsOnDevice: true,
      capabilities: ["fit"],
      adviseFit(input) {
        providerSignal = input.signal;
        return new Promise((resolve) => {
          const lateTimer = setTimeout(() => {
            late = "size";
            resolve({
              ok: true,
              capability: "fit",
              source: "local-measurements",
              providerId: "isibuko.hang",
              productId: "wig-bob",
              size: "Petite",
              warning: null,
              detail: "late",
              explanation: "late",
            });
          }, 40);
          input.signal?.addEventListener("abort", () => {
            clearTimeout(lateTimer);
            late = "aborted";
            setTimeout(() => {
              late = "late-after-abort";
              resolve({
                ok: true,
                capability: "fit",
                source: "local-measurements",
                providerId: "isibuko.hang",
                productId: "wig-bob",
                size: "Petite",
                warning: null,
                detail: "late",
                explanation: "late",
              });
            }, 15);
          });
        });
      },
    };
    const result = await requestFit(provider, request({ timeoutMs: 20 }));
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(providerSignal?.aborted, true);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "TIMEOUT");
      assert.match(result.reason, /Nothing was sent/);
    }
    assert.equal(late, "late-after-abort");
  });

  it("refuses attributes, recommendations and generation", async () => {
    for (const capability of ["attributes", "recommend", "generate"] as const) {
      const result = await requestCapability(localFitProvider, capability, request());
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.code, "NOT_AVAILABLE");
      assert.equal(result.capability, capability);
    }
  });

  it("leaves the photographic size suggestion on the original matchSize call", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../routes/mirror.tsx"), "utf8");
    assert.match(source, /const fit = useMemo\(\s*\(\) => \(metrics \? matchSize\(active\.sizes, metrics\.body\) : null\)/);
    assert.match(source, /const \[fitHelp, setFitHelp\] = useState\(false\)/);
    assert.match(source, /aria-live="polite"/);
  });
});

function refusalLike() {
  return {
    ok: false as const,
    capability: "fit" as const,
    source: "refused" as const,
    providerId: "isibuko.slow",
    code: "ABORTED" as const,
    reason: "cancelled inside the provider",
  };
}
