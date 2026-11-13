import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAssetEditorProduct,
  buildAssetExportPayload,
  checkReattachedImageCompatibility,
  loadSavedAssetDraft,
  parseAssetDraftJson,
  persistAssetDraft,
  validateAssetImageBytes,
} from "./asset-editor.ts";
import {
  createIndexedDbImageStore,
  createMemoryImageStore,
  productImageKey,
  unavailableImageStore,
} from "./local-image-db.ts";
import { buildCustomProduct, productToEditDraft } from "./merchant.ts";
import { resolveMirrorProductSelection } from "./mirror-selection.ts";
import {
  WARDROBE_STORAGE_KEY,
  WardrobePersistenceError,
  commitWardrobeChange,
  commitWardrobeChangeWithReport,
  emptyWardrobe,
  hydrateWardrobe,
  hydrateWardrobeDetailed,
  type StorageLike,
} from "./wardrobe-storage.ts";

function pngBytes(): Uint8Array {
  return Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52);
}

function jpegBytes(): Uint8Array {
  return Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9);
}

function webpBytes(): Uint8Array {
  return Uint8Array.of(
    0x52, 0x49, 0x46, 0x46,
    0x24, 0x00, 0x00, 0x00,
    0x57, 0x45, 0x42, 0x50,
    0x56, 0x50, 0x38, 0x20,
  );
}

function createMemoryStorage(): StorageLike & {
  dump(key: string): string | null;
  failNextWrite(error?: Error): void;
} {
  const map = new Map<string, string>();
  let nextError: Error | null = null;
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      if (nextError) {
        const err = nextError;
        nextError = null;
        throw err;
      }
      map.set(key, value);
    },
    dump: (key) => map.get(key) ?? null,
    failNextWrite(error?: Error) {
      if (error) {
        nextError = error;
      } else {
        const quota = new Error("QuotaExceededError");
        quota.name = "QuotaExceededError";
        nextError = quota;
      }
    },
  };
}

function createFakeIdbFactory(opts?: {
  blockOpen?: boolean;
  errorOpen?: boolean;
  beforePut?: (key: string) => Promise<void> | void;
  failPutForKey?: (key: string) => Error | null;
  failGetForKey?: (key: string) => Error | null;
}): {
  factory: IDBFactory;
  records: Map<string, unknown>;
} {
  const records = new Map<string, unknown>();
  const storeNames = new Set<string>();

  const db = {
    objectStoreNames: {
      contains: (name: string) => storeNames.has(name),
    },
    close() {},
    onclose: null as null | (() => void),
    onversionchange: null as null | (() => void),
    createObjectStore(name: string) {
      storeNames.add(name);
      return {};
    },
    transaction(storeName: string, _mode: IDBTransactionMode) {
      if (!storeNames.has(storeName)) {
        throw new Error(`Object store ${storeName} does not exist.`);
      }
      const tx: {
        error: DOMException | Error | null;
        oncomplete: null | (() => void);
        onerror: null | (() => void);
        onabort: null | (() => void);
        objectStore: (name: string) => unknown;
      } = {
        error: null,
        oncomplete: null,
        onerror: null,
        onabort: null,
        objectStore() {
          return {
            get(key: string) {
              const req: { result?: unknown; error?: Error | null; onsuccess: null | (() => void); onerror: null | (() => void) } = {
                onsuccess: null,
                onerror: null,
              };
              queueMicrotask(() => {
                const err = opts?.failGetForKey?.(key) ?? null;
                if (err) {
                  req.error = err;
                  tx.error = err;
                  req.onerror?.();
                  return;
                }
                req.result = records.get(key);
                req.onsuccess?.();
              });
              return req;
            },
            put(value: unknown, key: string) {
              const req: { error?: Error | null; onerror: null | (() => void) } = {
                onerror: null,
              };
              void (async () => {
                await opts?.beforePut?.(key);
                const err = opts?.failPutForKey?.(key) ?? null;
                if (err) {
                  req.error = err;
                  tx.error = err;
                  req.onerror?.();
                  tx.onerror?.();
                  return;
                }
                records.set(key, value);
                tx.oncomplete?.();
              })();
              return req;
            },
            delete(key: string) {
              queueMicrotask(() => {
                records.delete(key);
                tx.oncomplete?.();
              });
              return {};
            },
          };
        },
      };
      return tx;
    },
  };

  const factory = {
    open(_name: string, _version?: number) {
      const req: {
        result: typeof db;
        error: Error | null;
        onupgradeneeded: null | (() => void);
        onsuccess: null | (() => void);
        onerror: null | (() => void);
        onblocked: null | (() => void);
      } = {
        result: db,
        error: null,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        onblocked: null,
      };
      queueMicrotask(() => {
        if (opts?.blockOpen) {
          req.onblocked?.();
          return;
        }
        if (opts?.errorOpen) {
          req.error = new Error("SecurityError: IDB blocked in private context.");
          req.onerror?.();
          return;
        }
        req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  } as unknown as IDBFactory;

  return { factory, records };
}

describe("mirror custom product hydration and selection", () => {
  it("waits cleanly instead of flashing shirt-linen before custom wardrobe hydration completes", async () => {
    const storage = createMemoryStorage();
    const { factory } = createFakeIdbFactory();
    const imageStore = createIndexedDbImageStore(factory);
    const png = validateAssetImageBytes(pngBytes());
    assert.equal(png.ok, true);
    if (!png.ok) return;

    const customBuilt = buildAssetEditorProduct({
      name: "Hard refresh dress",
      category: "dress",
      imageDataUrl: png.dataUrl,
      anchors: {
        shoulderL: { x: 0.3, y: 0.1 },
        shoulderR: { x: 0.7, y: 0.1 },
        hipL: { x: 0.32, y: 0.45 },
        hipR: { x: 0.68, y: 0.45 },
      },
      id: "custom-asset-99",
    });
    assert.equal(customBuilt.ok, true);
    if (!customBuilt.ok) return;

    await commitWardrobeChange(
      (current) => ({ ...current, products: [customBuilt.product, ...current.products] }),
      { storage, imageStore },
    );

    const preHydration = resolveMirrorProductSelection({
      products: emptyWardrobe().products,
      requestedProductId: "custom-asset-99",
      ready: false,
      selectedProductId: null,
    });
    assert.equal(preHydration.status, "hydrating");
    assert.equal(preHydration.product, null);

    const catalogBeforeReady = resolveMirrorProductSelection({
      products: emptyWardrobe().products,
      requestedProductId: "wig-bob",
      ready: false,
      selectedProductId: null,
    });
    assert.equal(catalogBeforeReady.status, "ready");
    assert.equal(catalogBeforeReady.product?.id, "wig-bob");

    const hydrated = await hydrateWardrobe({ storage, imageStore });
    const postHydration = resolveMirrorProductSelection({
      products: hydrated.products,
      requestedProductId: "custom-asset-99",
      ready: true,
      selectedProductId: null,
    });
    assert.equal(postHydration.status, "ready");
    assert.equal(postHydration.requestedMissing, false);
    assert.equal(postHydration.product?.id, "custom-asset-99");
    assert.equal(postHydration.product?.image, png.dataUrl);
    assert.equal(postHydration.product?.fittingAnchors?.points?.shoulderL?.x, 0.3);

    const trulyMissing = resolveMirrorProductSelection({
      products: hydrated.products,
      requestedProductId: "deleted-custom-id",
      ready: true,
      selectedProductId: null,
    });
    assert.equal(trulyMissing.status, "ready");
    assert.equal(trulyMissing.requestedMissing, true);
    assert.equal(trulyMissing.product?.id, "shirt-linen");

    const manualSwitch = resolveMirrorProductSelection({
      products: hydrated.products,
      requestedProductId: "custom-asset-99",
      ready: true,
      selectedProductId: "shirt-silk",
    });
    assert.equal(manualSwitch.status, "ready");
    assert.equal(manualSwitch.product?.id, "shirt-silk");
  });
});

describe("MerchantStudio editing preserves fittingAnchors and decoded imageBytes", () => {
  it("preserves fittingAnchors, unpriced state, MIME, and exact decoded byte size across edits", () => {
    for (const [bytes, expectedMime] of [
      [pngBytes(), "image/png"],
      [jpegBytes(), "image/jpeg"],
      [webpBytes(), "image/webp"],
    ] as const) {
      const checked = validateAssetImageBytes(bytes);
      assert.equal(checked.ok, true);
      if (!checked.ok) continue;

      const original = buildAssetEditorProduct({
        name: "Anchored shirt",
        category: "shirt",
        imageDataUrl: checked.dataUrl,
        anchors: {
          shoulderL: { x: 0.25, y: 0.14, confidence: 1 },
          shoulderR: { x: 0.75, y: 0.14, confidence: 1 },
          hipL: { x: 0.3, y: 0.88, confidence: 1 },
          hipR: { x: 0.7, y: 0.88, confidence: 1 },
        },
        id: `custom-edit-${expectedMime}`,
      });
      assert.equal(original.ok, true);
      if (!original.ok) continue;

      const editDraft = productToEditDraft(original.product);
      assert.equal(editDraft.imageType, expectedMime);
      assert.equal(editDraft.imageBytes, bytes.byteLength);
      assert.equal(editDraft.priceZar, null);
      assert.deepEqual(editDraft.fittingAnchors?.points?.shoulderL, { x: 0.25, y: 0.14, confidence: 1 });

      const updated = buildCustomProduct(
        {
          ...editDraft,
          name: "Anchored linen shirt",
          fabric: "Washed linen",
        },
        original.product.id,
      );
      assert.equal(updated.ok, true);
      if (!updated.ok) continue;

      assert.equal(updated.product.name, "Anchored linen shirt");
      assert.equal(updated.product.fabric, "Washed linen");
      assert.equal(updated.product.priceZar, undefined);
      assert.equal(updated.product.image, checked.dataUrl);
      assert.deepEqual(updated.product.fittingAnchors, original.product.fittingAnchors);
    }
  });
});

describe(".asset.json sidecar export, validation, and image reattachment", () => {
  const sampleAlpha = {
    version: "isibuko.anchors/1" as const,
    bounds: { left: 0.1, top: 0.05, right: 0.9, bottom: 0.95 },
    alphaCoverage: 0.62,
    confidence: 0.65,
    silhouette: [{ y: 0.5, left: 0.2, right: 0.8, center: 0.5, width: 0.6 }],
    centralOpeningCandidate: null,
  };

  it("exports metadata + anchors with imageIncluded: false and validates MIME across PNG, JPEG, and WebP", () => {
    for (const [bytes, mime, filename] of [
      [pngBytes(), "image/png", "shirt.png"],
      [jpegBytes(), "image/jpeg", "shirt.jpg"],
      [webpBytes(), "image/webp", "shirt.webp"],
    ] as const) {
      const exported = buildAssetExportPayload({
        name: "Sidecar shirt",
        category: "shirt",
        sourceImage: filename,
        imageSize: { width: 640, height: 800 },
        imageType: mime,
        imageBytes: bytes.byteLength,
        alphaGeometry: sampleAlpha,
        preparation: null,
        anchors: {
          shoulderL: { x: 0.22, y: 0.15, confidence: 1 },
          shoulderR: { x: 0.78, y: 0.15, confidence: 1 },
        },
      });
      assert.equal(exported.imageIncluded, false);
      assert.equal(exported.imageType, mime);

      const reparsed = parseAssetDraftJson(JSON.stringify(exported));
      assert.equal(reparsed.ok, true);
      if (!reparsed.ok) continue;
      assert.equal(reparsed.hasEmbeddedImage, false);
      assert.equal(reparsed.draft.imageIncluded, false);
      assert.equal(reparsed.draft.imageType, mime);
      assert.equal(reparsed.draft.imageBytes, bytes.byteLength);
      assert.deepEqual(reparsed.draft.fittingAnchors.points?.shoulderL, { x: 0.22, y: 0.15, confidence: 1 });

      const exactReattach = checkReattachedImageCompatibility(
        {
          sourceImage: reparsed.draft.sourceImage,
          imageType: reparsed.draft.imageType ?? null,
          imageBytes: reparsed.draft.imageBytes ?? 0,
          imageSize: reparsed.draft.imageSize,
        },
        { mime, size: bytes.byteLength, width: 640, height: 800 },
      );
      assert.equal(exactReattach.ok, true);
      if (exactReattach.ok) assert.equal(exactReattach.warning, null);

      const wrongMime = mime === "image/png" ? "image/jpeg" : "image/png";
      const mismatchReattach = checkReattachedImageCompatibility(
        {
          sourceImage: reparsed.draft.sourceImage,
          imageType: reparsed.draft.imageType ?? null,
          imageBytes: reparsed.draft.imageBytes ?? 0,
          imageSize: reparsed.draft.imageSize,
        },
        { mime: wrongMime, size: bytes.byteLength, width: 640, height: 800 },
      );
      assert.equal(mismatchReattach.ok, false);
    }
  });

  it("rejects malformed, incompatible, or MIME-spoofed asset metadata safely", () => {
    const validBase = buildAssetExportPayload({
      name: "Valid shirt",
      category: "shirt",
      sourceImage: "shirt.png",
      imageSize: { width: 500, height: 600 },
      imageType: "image/png",
      imageBytes: 16,
      alphaGeometry: sampleAlpha,
      preparation: null,
      anchors: { shoulderL: { x: 0.2, y: 0.2 } },
    });

    assert.equal(parseAssetDraftJson("{not valid json").ok, false);
    assert.equal(parseAssetDraftJson("[]").ok, false);
    assert.equal(parseAssetDraftJson(JSON.stringify({ ...validBase, version: "isibuko.asset-draft/99" })).ok, false);
    assert.equal(parseAssetDraftJson(JSON.stringify({ ...validBase, category: "shoes" })).ok, false);
    assert.equal(parseAssetDraftJson(JSON.stringify({ ...validBase, imageType: "image/svg+xml" })).ok, false);
    assert.equal(parseAssetDraftJson(JSON.stringify({ ...validBase, imageSize: { width: 0, height: 600 } })).ok, false);
    assert.equal(parseAssetDraftJson(JSON.stringify({ ...validBase, imageBytes: 2_000_000 })).ok, false);
    assert.equal(
      parseAssetDraftJson(
        JSON.stringify({
          ...validBase,
          fittingAnchors: { version: "isibuko.anchors/1", points: { shoulderL: { x: 1.4, y: 0.2 } } },
        }),
      ).ok,
      false,
    );
    assert.equal(parseAssetDraftJson(JSON.stringify({ ...validBase, imageIncluded: true })).ok, false);

    const png = validateAssetImageBytes(pngBytes());
    assert.equal(png.ok, true);
    if (png.ok) {
      const spoofed = parseAssetDraftJson(
        JSON.stringify({
          ...validBase,
          imageType: "image/webp",
          imageBytes: png.size,
          imageIncluded: true,
          imageDataUrl: png.dataUrl,
        }),
      );
      assert.equal(spoofed.ok, false);
    }
  });
});

describe("IndexedDB wardrobe storage, safety ordering, and failure handling", () => {
  it("reports accurate store kinds and never claims memory-only writes are persisted", async () => {
    const memoryStore = createMemoryImageStore();
    assert.equal(memoryStore.kind, "memory");
    assert.equal(unavailableImageStore.kind, "unavailable");

    const { factory } = createFakeIdbFactory();
    const idbStore = createIndexedDbImageStore(factory);
    assert.equal(idbStore.kind, "indexeddb");

    const png = validateAssetImageBytes(pngBytes());
    assert.equal(png.ok, true);
    if (!png.ok) return;

    const built = buildAssetEditorProduct({
      name: "Memory test shirt",
      category: "shirt",
      imageDataUrl: png.dataUrl,
      anchors: { shoulderL: { x: 0.2, y: 0.2 } },
      id: "custom-mem-1",
    });
    assert.equal(built.ok, true);
    if (!built.ok) return;

    await assert.rejects(
      commitWardrobeChange(
        (current) => ({ ...current, products: [...current.products, built.product] }),
        { storage: null, imageStore: memoryStore },
      ),
      (err: unknown) => err instanceof WardrobePersistenceError && err.code === "memory-only",
    );

    const storage = createMemoryStorage();
    const { report } = await commitWardrobeChangeWithReport(
      (current) => ({ ...current, products: [...current.products, built.product] }),
      { storage, imageStore: memoryStore },
    );
    assert.equal(report.indexedDbStatus, "memory-fallback");
    assert.equal(report.imageLocation, "localstorage");
    assert.equal((storage.dump(WARDROBE_STORAGE_KEY) ?? "").includes("imageRef"), false);
    assert.equal((storage.dump(WARDROBE_STORAGE_KEY) ?? "").includes(png.dataUrl), true);

    const memoryOnlyDraft = await persistAssetDraft(
      {
        name: "Draft",
        category: "shirt",
        sourceImage: "shirt.png",
        imageSize: { width: 100, height: 100 },
        imageType: "image/png",
        imageBytes: png.size,
        imageDataUrl: png.dataUrl,
        alphaGeometry: null,
        preparation: null,
        anchors: {},
      },
      { storage: null, imageStore: memoryStore },
    );
    assert.equal(memoryOnlyDraft.ok, false);
    if (!memoryOnlyDraft.ok) assert.equal(memoryOnlyDraft.reason, "memory-only");
  });

  it("stores image data in IndexedDB, keeps localStorage compact, preserves across edits, and deletes on removal", async () => {
    const storage = createMemoryStorage();
    const { factory } = createFakeIdbFactory();
    const imageStore = createIndexedDbImageStore(factory);
    const webp = validateAssetImageBytes(webpBytes());
    assert.equal(webp.ok, true);
    if (!webp.ok) return;

    const built = buildAssetEditorProduct({
      name: "IndexedDB Skirt",
      category: "skirt",
      imageDataUrl: webp.dataUrl,
      anchors: { hipL: { x: 0.3, y: 0.1 }, hipR: { x: 0.7, y: 0.1 } },
      id: "custom-idb-1",
    });
    assert.equal(built.ok, true);
    if (!built.ok) return;

    const { report } = await commitWardrobeChangeWithReport(
      (current) => ({ ...current, products: [...current.products, built.product] }),
      { storage, imageStore },
    );
    assert.equal(report.indexedDbStatus, "working");
    assert.equal(report.imageLocation, "indexeddb");
    assert.equal(report.warning, null);

    const rawLocalStorage = storage.dump(WARDROBE_STORAGE_KEY) ?? "";
    assert.equal(rawLocalStorage.includes("data:image/"), false);
    assert.equal(rawLocalStorage.includes('"imageRef":"indexeddb"'), true);
    assert.equal(await imageStore.getImage(productImageKey("custom-idb-1")), webp.dataUrl);

    await commitWardrobeChange((current) => ({ ...current, heightCm: 178 }), { storage, imageStore });
    const rehydrated = await hydrateWardrobe({ storage, imageStore });
    const found = rehydrated.products.find((item) => item.id === "custom-idb-1");
    assert.ok(found);
    assert.equal(found?.image, webp.dataUrl);
    assert.equal(rehydrated.heightCm, 178);

    await commitWardrobeChange(
      (current) => ({ ...current, products: current.products.filter((item) => item.id !== "custom-idb-1") }),
      { storage, imageStore },
    );
    assert.equal(await imageStore.getImage(productImageKey("custom-idb-1")), null);
  });

  it("prevents stale migration from overwriting overlapping user edits and cleans up concurrently deleted orphans", async () => {
    const storage = createMemoryStorage();
    const jpeg = validateAssetImageBytes(jpegBytes());
    const png = validateAssetImageBytes(pngBytes());
    assert.equal(jpeg.ok && png.ok, true);
    if (!jpeg.ok || !png.ok) return;

    const legacyA = buildAssetEditorProduct({
      name: "Legacy A",
      category: "shirt",
      imageDataUrl: jpeg.dataUrl,
      anchors: { shoulderL: { x: 0.2, y: 0.2 } },
      id: "custom-overlap-a",
    });
    const addedB = buildAssetEditorProduct({
      name: "Concurrent B",
      category: "dress",
      imageDataUrl: png.dataUrl,
      anchors: { shoulderL: { x: 0.3, y: 0.1 }, hipL: { x: 0.35, y: 0.5 } },
      id: "custom-overlap-b",
    });
    assert.equal(legacyA.ok && addedB.ok, true);
    if (!legacyA.ok || !addedB.ok) return;

    storage.setItem(
      WARDROBE_STORAGE_KEY,
      JSON.stringify({ v: 1, rev: 1, products: [legacyA.product], events: [], heightCm: 170 }),
    );

    let releaseFirstPut!: () => void;
    let firstPutStarted!: () => void;
    const firstPutBarrier = new Promise<void>((resolve) => {
      releaseFirstPut = resolve;
    });
    const firstPutArrived = new Promise<void>((resolve) => {
      firstPutStarted = resolve;
    });
    let pausedOnce = false;

    const { factory, records } = createFakeIdbFactory({
      beforePut: async (key) => {
        if (!pausedOnce && key === productImageKey("custom-overlap-a")) {
          pausedOnce = true;
          firstPutStarted();
          await firstPutBarrier;
        }
      },
    });
    const imageStore = createIndexedDbImageStore(factory);

    const migrationPromise = hydrateWardrobe({ storage, imageStore });
    await firstPutArrived;

    // Simulate overlapping user commit while migration is mid-await:
    // User edits Legacy A's name, changes heightCm, and adds Concurrent B.
    const editedA = { ...legacyA.product, name: "Edited A by user" };
    await imageStore.writeImage(productImageKey("custom-overlap-b"), png.dataUrl);
    storage.setItem(
      WARDROBE_STORAGE_KEY,
      JSON.stringify({
        v: 1,
        rev: 2,
        products: [editedA, { ...addedB.product, image: null, imageRef: "indexeddb" }],
        events: [],
        heightCm: 184,
      }),
    );

    releaseFirstPut();
    const result = await migrationPromise;

    assert.equal(result.heightCm, 184);
    assert.equal(result.products.find((p) => p.id === "custom-overlap-a")?.name, "Edited A by user");
    assert.equal(result.products.find((p) => p.id === "custom-overlap-b")?.image, png.dataUrl);
    assert.equal((storage.dump(WARDROBE_STORAGE_KEY) ?? "").includes("Edited A by user"), true);
    assert.equal((storage.dump(WARDROBE_STORAGE_KEY) ?? "").includes("custom-overlap-b"), true);

    // Also test concurrent deletion of the legacy item while migration is paused:
    storage.setItem(
      WARDROBE_STORAGE_KEY,
      JSON.stringify({ v: 1, rev: 1, products: [legacyA.product], events: [], heightCm: 170 }),
    );
    records.delete(productImageKey("custom-overlap-a"));

    let releaseSecondPut!: () => void;
    let secondPutStarted!: () => void;
    const secondPutBarrier = new Promise<void>((resolve) => {
      releaseSecondPut = resolve;
    });
    const secondPutArrived = new Promise<void>((resolve) => {
      secondPutStarted = resolve;
    });
    pausedOnce = false;
    const { factory: factory2 } = createFakeIdbFactory({
      beforePut: async (key) => {
        if (!pausedOnce && key === productImageKey("custom-overlap-a")) {
          pausedOnce = true;
          secondPutStarted();
          await secondPutBarrier;
        }
      },
    });
    const store2 = createIndexedDbImageStore(factory2);
    const mig2 = hydrateWardrobe({ storage, imageStore: store2 });
    await secondPutArrived;

    storage.setItem(
      WARDROBE_STORAGE_KEY,
      JSON.stringify({ v: 1, rev: 3, products: [], events: [], heightCm: 175 }),
    );
    releaseSecondPut();
    const res2 = await mig2;
    assert.equal(res2.products.some((p) => p.id === "custom-overlap-a"), false);
    assert.equal(await store2.getImage(productImageKey("custom-overlap-a")), null);
  });

  it("keeps IndexedDB intact on failed metadata write during product deletion and rolls back image replacement", async () => {
    const storage = createMemoryStorage();
    const { factory } = createFakeIdbFactory();
    const imageStore = createIndexedDbImageStore(factory);
    const png = validateAssetImageBytes(pngBytes());
    const webp = validateAssetImageBytes(webpBytes());
    assert.equal(png.ok && webp.ok, true);
    if (!png.ok || !webp.ok) return;

    const item = buildAssetEditorProduct({
      name: "Protected shirt",
      category: "shirt",
      imageDataUrl: png.dataUrl,
      anchors: { shoulderL: { x: 0.25, y: 0.15 } },
      id: "custom-protected-1",
    });
    assert.equal(item.ok, true);
    if (!item.ok) return;

    await commitWardrobeChange(
      (current) => ({ ...current, products: [...current.products, item.product] }),
      { storage, imageStore },
    );

    // 1. Failed metadata write during product deletion must NOT delete IDB image.
    storage.failNextWrite();
    await assert.rejects(
      commitWardrobeChange(
        (current) => ({
          ...current,
          products: current.products.filter((p) => p.id !== "custom-protected-1"),
        }),
        { storage, imageStore },
      ),
      (err: unknown) => err instanceof WardrobePersistenceError && err.code === "quota",
    );
    assert.equal(await imageStore.getImage(productImageKey("custom-protected-1")), png.dataUrl);
    const afterFailedDelete = await hydrateWardrobe({ storage, imageStore });
    assert.equal(afterFailedDelete.products.find((p) => p.id === "custom-protected-1")?.image, png.dataUrl);

    // 2. Failed metadata write after image replacement must roll back IndexedDB to previous image.
    storage.failNextWrite();
    await assert.rejects(
      commitWardrobeChange(
        (current) => ({
          ...current,
          products: current.products.map((p) =>
            p.id === "custom-protected-1" ? { ...p, name: "Replaced name", image: webp.dataUrl } : p,
          ),
        }),
        { storage, imageStore },
      ),
      (err: unknown) => err instanceof WardrobePersistenceError && err.code === "quota",
    );
    assert.equal(await imageStore.getImage(productImageKey("custom-protected-1")), png.dataUrl);
    const afterFailedReplace = await hydrateWardrobe({ storage, imageStore });
    assert.equal(afterFailedReplace.products.find((p) => p.id === "custom-protected-1")?.name, "Protected shirt");
    assert.equal(afterFailedReplace.products.find((p) => p.id === "custom-protected-1")?.image, png.dataUrl);
  });

  it("preserves an unreadable previous IndexedDB image when metadata replacement fails", async () => {
    const storage = createMemoryStorage();
    const png = validateAssetImageBytes(pngBytes());
    const webp = validateAssetImageBytes(webpBytes());
    assert.equal(png.ok && webp.ok, true);
    if (!png.ok || !webp.ok) return;

    let failReads = false;
    const { factory, records } = createFakeIdbFactory({
      failGetForKey: (key) =>
        failReads && key === productImageKey("custom-read-failure-1")
          ? new Error("Transient IndexedDB read failure")
          : null,
    });
    const imageStore = createIndexedDbImageStore(factory);
    const built = buildAssetEditorProduct({
      name: "Original image",
      category: "shirt",
      imageDataUrl: png.dataUrl,
      anchors: {},
      id: "custom-read-failure-1",
    });
    assert.equal(built.ok, true);
    if (!built.ok) return;

    await commitWardrobeChange(
      (current) => ({ ...current, products: [...current.products, built.product] }),
      { storage, imageStore },
    );
    assert.equal(await imageStore.getImage(productImageKey("custom-read-failure-1")), png.dataUrl);

    failReads = true;
    storage.failNextWrite();
    await assert.rejects(
      commitWardrobeChange(
        (current) => ({
          ...current,
          products: current.products.map((product) =>
            product.id === "custom-read-failure-1" ? { ...product, image: webp.dataUrl } : product,
          ),
        }),
        { storage, imageStore },
      ),
      (err: unknown) => err instanceof WardrobePersistenceError && err.code === "quota",
    );

    // The failed read must not be treated as proof that no prior image existed.
    const retainedRecord = records.get(productImageKey("custom-read-failure-1")) as { dataUrl?: string } | undefined;
    assert.equal(retainedRecord?.dataUrl, png.dataUrl);
    failReads = false;
    const hydrated = await hydrateWardrobe({ storage, imageStore });
    assert.equal(hydrated.products.find((product) => product.id === "custom-read-failure-1")?.image, png.dataUrl);
  });

  it("preserves migrated images when the localStorage recheck fails", async () => {
    const baseStorage = createMemoryStorage();
    let readCount = 0;

    // Initial read succeeds. The migration's second read fails.
    const storage: StorageLike = {
      getItem(key) {
        readCount += 1;

        if (readCount === 2) {
          throw new Error("Temporary localStorage read failure");
        }

        return baseStorage.getItem(key);
      },
      setItem(key, value) {
        baseStorage.setItem(key, value);
      },
    };

    const png = validateAssetImageBytes(pngBytes());
    assert.equal(png.ok, true);
    if (!png.ok) return;

    const built = buildAssetEditorProduct({
      name: "Migration protected shirt",
      category: "shirt",
      imageDataUrl: png.dataUrl,
      anchors: {},
      id: "custom-migration-read-failure",
    });

    assert.equal(built.ok, true);
    if (!built.ok) return;

    const originalRaw = JSON.stringify({
      v: 1,
      rev: 1,
      products: [built.product],
      events: [],
      heightCm: 170,
    });

    baseStorage.setItem(WARDROBE_STORAGE_KEY, originalRaw);

    const { factory } = createFakeIdbFactory();
    const imageStore = createIndexedDbImageStore(factory);

    const result = await hydrateWardrobeDetailed({
      storage,
      imageStore,
    });

    // The original metadata must remain unchanged.
    assert.equal(baseStorage.dump(WARDROBE_STORAGE_KEY), originalRaw);

    // The successfully migrated image must not be deleted.
    assert.equal(
      await imageStore.getImage(
        productImageKey("custom-migration-read-failure"),
      ),
      png.dataUrl,
    );

    // Hydration must retain the product and its image.
    const restored = result.wardrobe.products.find(
      (product) => product.id === "custom-migration-read-failure",
    );

    assert.ok(restored);
    assert.equal(restored?.image, png.dataUrl);

    // Failed recheck must not claim successful metadata compaction.
    assert.deepEqual(result.diagnostics.migratedIds, []);
    assert.equal(readCount, 2);
  });


  it("retries interrupted migration cleanly without losing images or metadata", async () => {
    const storage = createMemoryStorage();
    const jpeg = validateAssetImageBytes(jpegBytes());
    const png = validateAssetImageBytes(pngBytes());
    assert.equal(jpeg.ok && png.ok, true);
    if (!jpeg.ok || !png.ok) return;

    const p1 = buildAssetEditorProduct({
      name: "Retry A",
      category: "shirt",
      imageDataUrl: jpeg.dataUrl,
      anchors: {},
      id: "custom-retry-1",
    });
    const p2 = buildAssetEditorProduct({
      name: "Retry B",
      category: "skirt",
      imageDataUrl: png.dataUrl,
      anchors: {},
      id: "custom-retry-2",
    });
    assert.equal(p1.ok && p2.ok, true);
    if (!p1.ok || !p2.ok) return;

    storage.setItem(
      WARDROBE_STORAGE_KEY,
      JSON.stringify({ v: 1, products: [p1.product, p2.product], events: [], heightCm: 170 }),
    );

    let failSecondItemOnce = true;
    const { factory } = createFakeIdbFactory({
      failPutForKey: (key) => {
        if (failSecondItemOnce && key === productImageKey("custom-retry-2")) {
          failSecondItemOnce = false;
          return new Error("Transient IDB write abort");
        }
        return null;
      },
    });
    const imageStore = createIndexedDbImageStore(factory);

    // First run fails on p2 AND suppose localStorage compaction fails once (interrupted migration).
    storage.failNextWrite(new Error("Interrupted before compaction"));
    const firstPass = await hydrateWardrobeDetailed({ storage, imageStore });
    assert.equal(firstPass.diagnostics.indexedDbStatus, "failed");
    assert.deepEqual(firstPass.diagnostics.failedImageIds, ["custom-retry-2"]);
    assert.equal(firstPass.wardrobe.products.find((p) => p.id === "custom-retry-1")?.image, jpeg.dataUrl);
    assert.equal(firstPass.wardrobe.products.find((p) => p.id === "custom-retry-2")?.image, png.dataUrl);
    // Inline backup remained untouched in localStorage because compaction was interrupted.
    assert.equal((storage.dump(WARDROBE_STORAGE_KEY) ?? "").includes("data:image/"), true);

    // Second run retries cleanly and completes compaction for both items.
    const retryPass = await hydrateWardrobeDetailed({ storage, imageStore });
    assert.equal(retryPass.diagnostics.indexedDbStatus, "working");
    assert.deepEqual(retryPass.diagnostics.failedImageIds, []);
    assert.equal((storage.dump(WARDROBE_STORAGE_KEY) ?? "").includes("data:image/"), false);
    assert.equal(await imageStore.getImage(productImageKey("custom-retry-1")), jpeg.dataUrl);
    assert.equal(await imageStore.getImage(productImageKey("custom-retry-2")), png.dataUrl);
  });

  it("detects missing IndexedDB image records cleanly in wardrobe and asset draft loading", async () => {
    const storage = createMemoryStorage();
    const { factory, records } = createFakeIdbFactory();
    const imageStore = createIndexedDbImageStore(factory);
    const png = validateAssetImageBytes(pngBytes());
    assert.equal(png.ok, true);
    if (!png.ok) return;

    const item = buildAssetEditorProduct({
      name: "Evicted IDB shirt",
      category: "shirt",
      imageDataUrl: png.dataUrl,
      anchors: { shoulderL: { x: 0.2, y: 0.2 } },
      id: "custom-evicted-1",
    });
    assert.equal(item.ok, true);
    if (!item.ok) return;

    await commitWardrobeChange(
      (current) => ({ ...current, products: [...current.products, item.product] }),
      { storage, imageStore },
    );

    const draftSaved = await persistAssetDraft(
      {
        name: "Evicted draft",
        category: "shirt",
        sourceImage: "evicted.png",
        imageSize: { width: 100, height: 100 },
        imageType: "image/png",
        imageBytes: png.size,
        imageDataUrl: png.dataUrl,
        alphaGeometry: null,
        preparation: null,
        anchors: { shoulderL: { x: 0.2, y: 0.2 } },
      },
      { storage, imageStore },
    );
    assert.equal(draftSaved.ok, true);

    // Delete both IDB image records out-of-band, using a fresh in-memory cache via hydrateWardrobeDetailed.
    records.clear();

    const detailed = await hydrateWardrobeDetailed({ storage, imageStore, cache: new Map() });
    assert.equal(detailed.diagnostics.indexedDbStatus, "working");
    assert.deepEqual(detailed.diagnostics.missingImageIds, ["custom-evicted-1"]);
    assert.equal(detailed.wardrobe.products.find((p) => p.id === "custom-evicted-1")?.image, null);

    const draftLoaded = await loadSavedAssetDraft({ storage, imageStore });
    assert.equal(draftLoaded.ok, true);
    if (draftLoaded.ok) {
      assert.equal(draftLoaded.missingIdbImage, true);
      assert.equal(draftLoaded.storedImage, null);
      assert.ok(draftLoaded.warning);
      assert.deepEqual(draftLoaded.draft.fittingAnchors.points?.shoulderL, { x: 0.2, y: 0.2 });
    }
  });

  it("serializes concurrent saves to the same product without losing either update", async () => {
    const storage = createMemoryStorage();
    const { factory } = createFakeIdbFactory({
      beforePut: () => new Promise((resolve) => setTimeout(resolve, 10)),
    });
    const imageStore = createIndexedDbImageStore(factory);
    const png = validateAssetImageBytes(pngBytes());
    assert.equal(png.ok, true);
    if (!png.ok) return;

    const item = buildAssetEditorProduct({
      name: "Initial name",
      category: "shirt",
      imageDataUrl: png.dataUrl,
      anchors: { shoulderL: { x: 0.2, y: 0.2 } },
      id: "custom-concurrent-1",
    });
    assert.equal(item.ok, true);
    if (!item.ok) return;

    await commitWardrobeChange(
      (current) => ({ ...current, products: [...current.products, item.product] }),
      { storage, imageStore },
    );

    await Promise.all([
      commitWardrobeChange(
        (current) => ({
          ...current,
          products: current.products.map((p) =>
            p.id === "custom-concurrent-1" ? { ...p, fabric: "Organic cotton" } : p,
          ),
        }),
        { storage, imageStore },
      ),
      commitWardrobeChange(
        (current) => ({
          ...current,
          products: current.products.map((p) =>
            p.id === "custom-concurrent-1" ? { ...p, name: "Final concurrent name" } : p,
          ),
        }),
        { storage, imageStore },
      ),
    ]);

    const finalWardrobe = await hydrateWardrobe({ storage, imageStore });
    const finalItem = finalWardrobe.products.find((p) => p.id === "custom-concurrent-1");
    assert.equal(finalItem?.name, "Final concurrent name");
    assert.equal(finalItem?.fabric, "Organic cotton");
    assert.equal(finalItem?.image, png.dataUrl);
  });

  it("handles unavailable or blocked IndexedDB and surfaces localStorage quota errors visibly", async () => {
    const png = validateAssetImageBytes(pngBytes());
    assert.equal(png.ok, true);
    if (!png.ok) return;

    const item = buildAssetEditorProduct({
      name: "Blocked IDB piece",
      category: "shirt",
      imageDataUrl: png.dataUrl,
      anchors: { shoulderL: { x: 0.25, y: 0.2 } },
      id: "custom-blocked-1",
    });
    assert.equal(item.ok, true);
    if (!item.ok) return;

    // 1. Blocked IDB open request falls back cleanly to inline localStorage with an explicit warning.
    const { factory: blockedFactory } = createFakeIdbFactory({ blockOpen: true });
    const blockedStore = createIndexedDbImageStore(blockedFactory);
    const fallbackStorage = createMemoryStorage();

    const { report } = await commitWardrobeChangeWithReport(
      (current) => ({ ...current, products: [...current.products, item.product] }),
      { storage: fallbackStorage, imageStore: blockedStore },
    );
    assert.equal(report.indexedDbStatus, "unavailable");
    assert.equal(report.imageLocation, "localstorage");
    assert.ok(report.warning);

    const hydratedFallback = await hydrateWardrobe({
      storage: fallbackStorage,
      imageStore: unavailableImageStore,
    });
    assert.equal(hydratedFallback.products.find((p) => p.id === "custom-blocked-1")?.image, png.dataUrl);

    // 2. When IndexedDB is blocked AND localStorage throws QuotaExceededError, Asset Editor draft fails visibly
    // instead of silently discarding the image and claiming saved.
    const fullStorage = createMemoryStorage();
    fullStorage.failNextWrite();
    const draftQuotaFail = await persistAssetDraft(
      {
        name: "Quota draft",
        category: "shirt",
        sourceImage: "quota.png",
        imageSize: { width: 100, height: 100 },
        imageType: "image/png",
        imageBytes: png.size,
        imageDataUrl: png.dataUrl,
        alphaGeometry: null,
        preparation: null,
        anchors: { shoulderL: { x: 0.2, y: 0.2 } },
      },
      { storage: fullStorage, imageStore: blockedStore },
    );
    assert.equal(draftQuotaFail.ok, false);
    if (!draftQuotaFail.ok) {
      assert.equal(draftQuotaFail.reason, "quota");
    }
    assert.equal(fullStorage.dump("isibuko-garment-asset-draft-v1"), null);
  });
  it("keeps a successful wardrobe save successful when IndexedDB image cleanup fails", async () => {
    const storage = createMemoryStorage();
    const { factory } = createFakeIdbFactory();
    const baseImageStore = createIndexedDbImageStore(factory);
    const cache = new Map<string, string>();

    const imageStore = {
      ...baseImageStore,
      async removeImage() {
        return {
          ok: false as const,
          reason: "error" as const,
          message: "Simulated IndexedDB deletion failure",
        };
      },
    };

    const png = validateAssetImageBytes(pngBytes());
    assert.equal(png.ok, true);
    if (!png.ok) return;

    const built = buildAssetEditorProduct({
      name: "Cleanup failure shirt",
      category: "shirt",
      imageDataUrl: png.dataUrl,
      anchors: {},
      id: "custom-cleanup-failure",
    });
    assert.equal(built.ok, true);
    if (!built.ok) return;

    await commitWardrobeChange(
      (current) => ({
        ...current,
        products: [...current.products, built.product],
      }),
      { storage, imageStore: baseImageStore, cache },
    );

    const result = await commitWardrobeChangeWithReport(
      (current) => ({
        ...current,
        products: current.products.filter(
          (product) => product.id !== "custom-cleanup-failure",
        ),
      }),
      { storage, imageStore, cache },
    );

    assert.equal(
      result.wardrobe.products.some(
        (product) => product.id === "custom-cleanup-failure",
      ),
      false,
    );

    assert.equal(result.report.persistedDurably, true);
    assert.match(result.report.warning ?? "", /Simulated IndexedDB deletion failure/);
    assert.equal(cache.has("custom-cleanup-failure"), true);

    const saved = await hydrateWardrobe({ storage, imageStore: baseImageStore });
    assert.equal(
      saved.products.some((product) => product.id === "custom-cleanup-failure"),
      false,
    );
  });
});
