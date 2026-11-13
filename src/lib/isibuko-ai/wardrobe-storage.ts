import { DEFAULT_PRODUCTS } from "./catalog.ts";
import {
  getDefaultImageStore,
  isQuotaError,
  productImageKey,
  type LocalImageStore,
} from "./local-image-db.ts";
import type { Product, TryEvent, Wardrobe } from "./types.ts";

export const WARDROBE_STORAGE_KEY = "isibuko.live.v1";
export const WARDROBE_EVENT = "isibuko-live-change";

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

type StoredCustomProduct = Product & { imageRef?: "indexeddb" };

type StoredWardrobePayload = {
  v: 1;
  rev?: number;
  products: StoredCustomProduct[];
  events: TryEvent[];
  heightCm: number;
};

export type WardrobeStorageDeps = {
  storage?: StorageLike | null;
  imageStore?: LocalImageStore;
  cache?: Map<string, string>;
  dispatchEvent?: boolean;
};

export type WardrobeHydrationDiagnostics = {
  indexedDbStatus: "working" | "unavailable" | "memory-fallback" | "failed";
  missingImageIds: string[];
  failedImageIds: string[];
  migratedIds: string[];
};

export type WardrobeCommitReport = {
  indexedDbStatus: "working" | "unavailable" | "memory-fallback" | "failed";
  imageLocation: "indexeddb" | "localstorage" | "none";
  persistedDurably: boolean;
  warning: string | null;
};

export class WardrobePersistenceError extends Error {
  readonly code: "quota" | "storage-unavailable" | "memory-only" | "write-failed";

  constructor(
    code: "quota" | "storage-unavailable" | "memory-only" | "write-failed",
    message: string,
  ) {
    super(message);
    this.name = "WardrobePersistenceError";
    this.code = code;
  }
}

const defaultImageCache = new Map<string, string>();
let defaultCommitQueue: Promise<unknown> = Promise.resolve();
const storageCommitQueues = new WeakMap<StorageLike, Promise<unknown>>();

function cloneProducts(): Product[] {
  return DEFAULT_PRODUCTS.map((product) => ({
    ...product,
    sizes: product.sizes.map((row) => ({ ...row })),
    swatches: product.swatches.map((swatch) => ({
      ...swatch,
      tint: swatch.tint ? ([...swatch.tint] as [number, number, number]) : null,
    })),
  }));
}

function stripInternalProductFields(item: StoredCustomProduct): Product {
  const { imageRef: _ignored, ...rest } = item;
  return rest;
}

export function emptyWardrobe(): Wardrobe {
  return { v: 1, products: cloneProducts(), events: [], heightCm: 170 };
}

function defaultBrowserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function resolveDeps(deps?: WardrobeStorageDeps) {
  const isCustomDeps = Boolean(
    deps?.storage !== undefined || deps?.imageStore !== undefined || deps?.cache !== undefined,
  );
  const storage = deps?.storage !== undefined ? deps.storage : defaultBrowserStorage();
  const imageStore = deps?.imageStore ?? getDefaultImageStore();
  const cache = deps?.cache ?? (isCustomDeps ? new Map<string, string>() : defaultImageCache);
  const dispatchEvent = deps?.dispatchEvent ?? !isCustomDeps;
  return { storage, imageStore, cache, dispatchEvent, isCustomDeps };
}

function parseStoredWardrobeRaw(raw: string | null): StoredWardrobePayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredWardrobePayload>;
    if (parsed.v !== 1 || !Array.isArray(parsed.products)) return null;
    const custom = parsed.products.filter((item): item is StoredCustomProduct =>
      Boolean(item && item.custom && item.id && item.name && item.category),
    );
    return {
      v: 1,
      rev: typeof parsed.rev === "number" && Number.isFinite(parsed.rev) ? parsed.rev : 0,
      products: custom,
      events: Array.isArray(parsed.events) ? (parsed.events as TryEvent[]).slice(0, 80) : [],
      heightCm:
        typeof parsed.heightCm === "number" && Number.isFinite(parsed.heightCm)
          ? parsed.heightCm
          : 170,
    };
  } catch {
    return null;
  }
}

type StoredWardrobeSnapshot = {
  status: "empty" | "valid" | "invalid" | "unavailable" | "error";
  raw: string | null;
  parsed: StoredWardrobePayload | null;
  error?: unknown;
};

function readStoredWardrobeSnapshot(storage: StorageLike | null): StoredWardrobeSnapshot {
  if (!storage) {
    return { status: "unavailable", raw: null, parsed: null };
  }

  try {
    const raw = storage.getItem(WARDROBE_STORAGE_KEY);

    if (raw === null) {
      return { status: "empty", raw: null, parsed: null };
    }

    const parsed = parseStoredWardrobeRaw(raw);

    if (!parsed) {
      return { status: "invalid", raw, parsed: null };
    }

    return { status: "valid", raw, parsed };
  } catch (error) {
    return { status: "error", raw: null, parsed: null, error };
  }
}

export function loadWardrobe(deps?: WardrobeStorageDeps): Wardrobe {
  const { storage, cache } = resolveDeps(deps);
  const { parsed } = readStoredWardrobeSnapshot(storage);
  if (!parsed) return emptyWardrobe();
  const custom = parsed.products.map((item) => {
    const clean = stripInternalProductFields(item);
    if (!clean.image && item.imageRef === "indexeddb") {
      const cached = cache.get(clean.id);
      if (cached) clean.image = cached;
    } else if (typeof clean.image === "string" && clean.image.startsWith("data:")) {
      cache.set(clean.id, clean.image);
    }
    return clean;
  });
  return {
    v: 1,
    products: [...cloneProducts(), ...custom],
    events: parsed.events,
    heightCm: parsed.heightCm,
  };
}

async function resolveProductsForPayload(
  payload: StoredWardrobePayload,
  imageStore: LocalImageStore,
  cache: Map<string, string>,
): Promise<{
  products: Product[];
  missingImageIds: string[];
  failedImageIds: string[];
  hadIdbFailure: boolean;
}> {
  const hydratedCustom: Product[] = [];
  const missingImageIds: string[] = [];
  const failedImageIds: string[] = [];
  let hadIdbFailure = false;

  for (const item of payload.products) {
    const clean = stripInternalProductFields(item);
    if (typeof item.image === "string" && item.image.startsWith("data:")) {
      cache.set(item.id, item.image);
      hydratedCustom.push(clean);
      continue;
    }

    if (item.imageRef === "indexeddb" || (item.image === null && item.category !== "nails")) {
      if (imageStore.kind === "indexeddb") {
        const readRes = await imageStore.readImage(productImageKey(item.id));
        if (readRes.ok) {
          if (readRes.dataUrl) {
            cache.set(item.id, readRes.dataUrl);
            clean.image = readRes.dataUrl;
          } else {
            missingImageIds.push(item.id);
            clean.image = cache.get(item.id) ?? null;
          }
        } else {
          hadIdbFailure = true;
          failedImageIds.push(item.id);
          clean.image = cache.get(item.id) ?? null;
        }
      } else {
        failedImageIds.push(item.id);
        clean.image = cache.get(item.id) ?? null;
      }
      hydratedCustom.push(clean);
      continue;
    }

    hydratedCustom.push(clean);
  }

  return { products: hydratedCustom, missingImageIds, failedImageIds, hadIdbFailure };
}

export async function hydrateWardrobeDetailed(deps?: WardrobeStorageDeps): Promise<{
  wardrobe: Wardrobe;
  diagnostics: WardrobeHydrationDiagnostics;
}> {
  const { storage, imageStore, cache } = resolveDeps(deps);
  const initialSnapshot = readStoredWardrobeSnapshot(storage);
  const { raw: initialRaw, parsed: initialParsed } = initialSnapshot;

  if (initialSnapshot.status === "unavailable" || initialSnapshot.status === "error") {
    throw new WardrobePersistenceError(
      "storage-unavailable",
      "The saved wardrobe could not be read. Existing wardrobe data has been left untouched.",
    );
  }

  if (initialSnapshot.status === "invalid") {
    throw new WardrobePersistenceError(
      "storage-unavailable",
      "The saved wardrobe data could not be interpreted. Existing data has been left untouched.",
    );
  }
  const initialStatus: WardrobeHydrationDiagnostics["indexedDbStatus"] =
    imageStore.kind === "unavailable"
      ? "unavailable"
      : imageStore.kind === "memory"
        ? "memory-fallback"
        : "working";

  if (initialSnapshot.status === "empty") {
    return {
      wardrobe: emptyWardrobe(),
      diagnostics: {
        indexedDbStatus: initialStatus,
        missingImageIds: [],
        failedImageIds: [],
        migratedIds: [],
      },
    };
  }

  if (!initialParsed) {
    throw new WardrobePersistenceError(
      "storage-unavailable",
      "The saved wardrobe could not be loaded safely.",
    );
  }

  const migratedImages = new Map<string, string>();
  const missingImageIds: string[] = [];
  const failedImageIds: string[] = [];
  const hydratedCustom: Product[] = [];
  let hadIdbFailure = false;

  for (const item of initialParsed.products) {
    const clean = stripInternalProductFields(item);
    if (typeof item.image === "string" && item.image.startsWith("data:")) {
      cache.set(item.id, item.image);
      if (imageStore.kind === "indexeddb") {
        const writeRes = await imageStore.writeImage(productImageKey(item.id), item.image);
        if (writeRes.ok) {
          migratedImages.set(item.id, item.image);
        } else {
          hadIdbFailure = true;
          failedImageIds.push(item.id);
        }
      }
      hydratedCustom.push(clean);
      continue;
    }

    if (item.imageRef === "indexeddb" || (item.image === null && item.category !== "nails")) {
      if (imageStore.kind === "indexeddb") {
        const readRes = await imageStore.readImage(productImageKey(item.id));
        if (readRes.ok) {
          if (readRes.dataUrl) {
            cache.set(item.id, readRes.dataUrl);
            clean.image = readRes.dataUrl;
          } else {
            missingImageIds.push(item.id);
            clean.image = cache.get(item.id) ?? null;
          }
        } else {
          hadIdbFailure = true;
          failedImageIds.push(item.id);
          clean.image = cache.get(item.id) ?? null;
        }
      } else {
        failedImageIds.push(item.id);
        clean.image = cache.get(item.id) ?? null;
      }
      hydratedCustom.push(clean);
      continue;
    }

    hydratedCustom.push(clean);
  }

  const migratedIds: string[] = [];

  if (migratedImages.size > 0 && storage) {
    // Compare-and-swap check right before localStorage rewrite so migration
    // never overwrites an overlapping user commit or concurrent tab edit.
    const latestSnapshot = readStoredWardrobeSnapshot(storage);

    if (latestSnapshot.status === "valid" && latestSnapshot.raw === initialRaw) {
      const nextStoredCustom = initialParsed.products.map((item) => {
        if (migratedImages.has(item.id)) {
          migratedIds.push(item.id);
          return {
            ...stripInternalProductFields(item),
            image: null,
            imageRef: "indexeddb" as const,
          };
        }
        return item;
      });
      try {
        storage.setItem(
          WARDROBE_STORAGE_KEY,
          JSON.stringify({
            v: 1,
            rev: (initialParsed.rev ?? 0) + 1,
            products: nextStoredCustom,
            events: initialParsed.events,
            heightCm: initialParsed.heightCm,
          }),
        );
      } catch {
        // Best-effort metadata compaction; inline localStorage copy remains valid.
      }
    } else if (latestSnapshot.status === "empty") {
      // Wardrobe was cleared during migration: clean up the newly written IDB images.
      for (const id of migratedImages.keys()) {
        await imageStore.removeImage(productImageKey(id));
      }
      return {
        wardrobe: emptyWardrobe(),
        diagnostics: {
          indexedDbStatus: hadIdbFailure ? "failed" : initialStatus,
          missingImageIds: [],
          failedImageIds,
          migratedIds: [],
        },
      };
    } else if (latestSnapshot.status === "valid" && latestSnapshot.parsed) {
      const latestParsed = latestSnapshot.parsed;
      const latestIds = new Set(latestParsed.products.map((item) => item.id));
      const orphanIds: string[] = [];

      for (const id of migratedImages.keys()) {
        if (!latestIds.has(id)) orphanIds.push(id);
      }

      let compactedConcurrent = false;
      const mergedProducts = latestParsed.products.map((item) => {
        const migratedUrl = migratedImages.get(item.id);
        if (migratedUrl && typeof item.image === "string" && item.image === migratedUrl) {
          compactedConcurrent = true;
          migratedIds.push(item.id);
          return {
            ...stripInternalProductFields(item),
            image: null,
            imageRef: "indexeddb" as const,
          };
        }
        return item;
      });

      if (compactedConcurrent) {
        try {
          // Synchronous CAS guard immediately before writing merged compaction.
          if (storage.getItem(WARDROBE_STORAGE_KEY) === latestSnapshot.raw) {
            storage.setItem(
              WARDROBE_STORAGE_KEY,
              JSON.stringify({
                v: 1,
                rev: (latestParsed.rev ?? 0) + 1,
                products: mergedProducts,
                events: latestParsed.events,
                heightCm: latestParsed.heightCm,
              }),
            );
          }
        } catch {
          // Concurrent commit stays intact; uncompacted item remains inline until next load.
        }
      }

      for (const id of orphanIds) {
        await imageStore.removeImage(productImageKey(id));
      }

      const refreshed = await resolveProductsForPayload(latestParsed, imageStore, cache);
      return {
        wardrobe: {
          v: 1,
          products: [...cloneProducts(), ...refreshed.products],
          events: latestParsed.events,
          heightCm: latestParsed.heightCm,
        },
        diagnostics: {
          indexedDbStatus: hadIdbFailure || refreshed.hadIdbFailure ? "failed" : initialStatus,
          missingImageIds: refreshed.missingImageIds,
          failedImageIds: [...new Set([...failedImageIds, ...refreshed.failedImageIds])],
          migratedIds,
        },
      };
    } else {
      // Storage could not be verified after migration.
      // Preserve the original metadata and migrated IndexedDB images.
      return {
        wardrobe: {
          v: 1,
          products: [...cloneProducts(), ...hydratedCustom],
          events: initialParsed.events,
          heightCm: initialParsed.heightCm,
        },
        diagnostics: {
          indexedDbStatus: hadIdbFailure ? "failed" : initialStatus,
          missingImageIds,
          failedImageIds,
          migratedIds: [],
        },
      };
    }
  }

  return {
    wardrobe: {
      v: 1,
      products: [...cloneProducts(), ...hydratedCustom],
      events: initialParsed.events,
      heightCm: initialParsed.heightCm,
    },
    diagnostics: {
      indexedDbStatus: hadIdbFailure ? "failed" : initialStatus,
      missingImageIds,
      failedImageIds,
      migratedIds,
    },
  };
}

export async function hydrateWardrobe(deps?: WardrobeStorageDeps): Promise<Wardrobe> {
  const { wardrobe } = await hydrateWardrobeDetailed(deps);
  return wardrobe;
}

async function performCommit(
  fn: (current: Wardrobe) => Wardrobe,
  deps?: WardrobeStorageDeps,
): Promise<{ wardrobe: Wardrobe; report: WardrobeCommitReport }> {
  const { storage, imageStore, cache, dispatchEvent } = resolveDeps(deps);
  if (!storage && imageStore.kind === "memory") {
    throw new WardrobePersistenceError(
      "memory-only",
      "Durable browser storage is unavailable; garment changes only existed in memory and were not persisted.",
    );
  }
  const { wardrobe: current, diagnostics } = await hydrateWardrobeDetailed({
    storage,
    imageStore,
    cache,
    dispatchEvent: false,
  });
  const preCommitSnapshot = readStoredWardrobeSnapshot(storage);

  if (preCommitSnapshot.status !== "valid" && preCommitSnapshot.status !== "empty") {
    throw new WardrobePersistenceError(
      "storage-unavailable",
      "The saved wardrobe could not be verified before committing changes.",
    );
  }

  const preCommitById = new Map(
    (preCommitSnapshot.parsed?.products ?? []).map((item) => [item.id, item]),
  );
  const failedReadSet = new Set(diagnostics.failedImageIds);

  const next = fn(current);

  const prevCustom = current.products.filter((item) => item.custom);
  const nextCustom = next.products.filter((item) => item.custom);
  const nextIds = new Set(nextCustom.map((item) => item.id));

  // Defer IndexedDB deletions until AFTER localStorage metadata commit succeeds,
  // so a failed metadata write never leaves an existing product pointing at a deleted image.
  const deferredDeleteIds: string[] = [];
  for (const prev of prevCustom) {
    if (!nextIds.has(prev.id)) {
      deferredDeleteIds.push(prev.id);
    }
  }

  type RollbackEntry = { key: string; prevDataUrl: string | null };
  const rollbacks: RollbackEntry[] = [];
  const committedCacheUpdates = new Map<string, string>();
  const storedCustom: StoredCustomProduct[] = [];
  const cleanCustom: Product[] = [];

  let idbStatus: WardrobeCommitReport["indexedDbStatus"] =
    imageStore.kind === "unavailable"
      ? "unavailable"
      : imageStore.kind === "memory"
        ? "memory-fallback"
        : "working";
  let hasImages = false;
  let storedInIdbCount = 0;
  let storedInlineCount = 0;
  let idbFailureMessage: string | null = null;

  for (const item of nextCustom) {
    const clean = stripInternalProductFields(item);
    cleanCustom.push(clean);

    if (typeof clean.image === "string" && clean.image.startsWith("data:")) {
      hasImages = true;
      const key = productImageKey(clean.id);

      if (imageStore.kind === "indexeddb") {
        const prevRead = await imageStore.readImage(key);
        // Never overwrite an existing IndexedDB record unless we have successfully
        // read its previous value. Without that backup, a later metadata failure
        // could make rollback delete an image we failed to inspect.
        if (!prevRead.ok) {
          idbStatus = prevRead.reason === "unavailable" ? "unavailable" : "failed";
          idbFailureMessage = prevRead.message;
          storedInlineCount += 1;
          storedCustom.push(clean);
          continue;
        }
        const prevDataUrl = prevRead.dataUrl;
        if (prevDataUrl === clean.image) {
          committedCacheUpdates.set(clean.id, clean.image);
          storedInIdbCount += 1;
          storedCustom.push({ ...clean, image: null, imageRef: "indexeddb" });
          continue;
        }

        const writeRes = await imageStore.writeImage(key, clean.image);
        if (writeRes.ok) {
          rollbacks.push({ key, prevDataUrl });
          committedCacheUpdates.set(clean.id, clean.image);
          storedInIdbCount += 1;
          storedCustom.push({ ...clean, image: null, imageRef: "indexeddb" });
          continue;
        }

        idbStatus = writeRes.reason === "unavailable" ? "unavailable" : "failed";
        idbFailureMessage = writeRes.message;
        storedInlineCount += 1;
        storedCustom.push(clean);
      } else if (imageStore.kind === "memory") {
        idbStatus = "memory-fallback";
        const prevRead = await imageStore.readImage(key);
        const prevDataUrl = prevRead.ok ? prevRead.dataUrl : null;
        if (prevDataUrl !== clean.image) {
          await imageStore.writeImage(key, clean.image);
          rollbacks.push({ key, prevDataUrl });
        }
        storedInlineCount += 1;
        storedCustom.push(clean);
      } else {
        idbStatus = "unavailable";
        storedInlineCount += 1;
        storedCustom.push(clean);
      }
    } else if (clean.image === null) {
      const prevMeta = preCommitById.get(clean.id);
      if (prevMeta?.imageRef === "indexeddb" && failedReadSet.has(clean.id)) {
        // Preserve existing IndexedDB reference when the earlier read failed rather than intentionally clearing.
        storedCustom.push({ ...clean, image: null, imageRef: "indexeddb" });
      } else {
        if (prevMeta?.imageRef === "indexeddb") {
          deferredDeleteIds.push(clean.id);
        }
        storedCustom.push({ ...clean, image: null });
      }
    } else {
      storedCustom.push(clean);
    }
  }

  async function rollbackIndexedDbWrites() {
    for (let i = rollbacks.length - 1; i >= 0; i -= 1) {
      const entry = rollbacks[i]!;
      if (entry.prevDataUrl !== null) {
        await imageStore.writeImage(entry.key, entry.prevDataUrl);
      } else {
        await imageStore.removeImage(entry.key);
      }
    }
  }

  if (!storage) {
    await rollbackIndexedDbWrites();
    if (imageStore.kind === "memory") {
      throw new WardrobePersistenceError(
        "memory-only",
        "Durable browser storage is unavailable; garment changes only existed in memory and were not persisted.",
      );
    }
    throw new WardrobePersistenceError(
      "storage-unavailable",
      "Browser localStorage is unavailable; wardrobe changes could not be saved.",
    );
  }

  const events = next.events.slice(0, 80);
  const latestBeforeCommit = readStoredWardrobeSnapshot(storage);

  if (latestBeforeCommit.status !== "valid" && latestBeforeCommit.status !== "empty") {
    await rollbackIndexedDbWrites();

    throw new WardrobePersistenceError(
      "storage-unavailable",
      "The saved wardrobe could not be verified before saving. Changes were not committed.",
    );
  }

  if (latestBeforeCommit.raw !== preCommitSnapshot.raw) {
    await rollbackIndexedDbWrites();

    throw new WardrobePersistenceError(
      "write-failed",
      "The wardrobe changed while this update was being prepared. Please retry.",
    );
  }

  const nextRev =
    Math.max(preCommitSnapshot.parsed?.rev ?? 0, latestBeforeCommit.parsed?.rev ?? 0) + 1;

  try {
    storage.setItem(
      WARDROBE_STORAGE_KEY,
      JSON.stringify({
        v: 1,
        rev: nextRev,
        products: storedCustom,
        events,
        heightCm: next.heightCm,
      }),
    );
  } catch (error) {
    await rollbackIndexedDbWrites();
    if (isQuotaError(error)) {
      const quotaDetail = idbFailureMessage
        ? `IndexedDB write failed (${idbFailureMessage}) and browser localStorage quota was exceeded.`
        : "Browser storage quota was exceeded; the wardrobe was not updated.";
      throw new WardrobePersistenceError("quota", quotaDetail);
    }
    throw new WardrobePersistenceError(
      "write-failed",
      error instanceof Error
        ? `Could not write wardrobe metadata to localStorage: ${error.message}`
        : "Could not write wardrobe metadata to localStorage.",
    );
  }

  // Metadata write succeeded: now it is safe to delete removed/cleared IDB images and update cache.
  // Metadata write succeeded. Cleanup is now best-effort: a failed image
  // deletion must not turn an already-committed wardrobe save into a failure.
  const cleanupWarnings: string[] = [];

  for (const id of deferredDeleteIds) {
    try {
      const result = await imageStore.removeImage(productImageKey(id));

      if (result.ok) {
        cache.delete(id);
      } else {
        cleanupWarnings.push(`Could not clean up image for ${id}: ${result.message}`);
      }
    } catch (error) {
      cleanupWarnings.push(
        `Could not clean up image for ${id}: ${
          error instanceof Error ? error.message : "Unknown deletion error"
        }`,
      );
    }
  }
  for (const [id, dataUrl] of committedCacheUpdates) {
    cache.set(id, dataUrl);
  }

  if (dispatchEvent && typeof window !== "undefined") {
    window.dispatchEvent(new Event(WARDROBE_EVENT));
  }

  const imageLocation: WardrobeCommitReport["imageLocation"] =
    storedInIdbCount > 0 && storedInlineCount === 0
      ? "indexeddb"
      : storedInlineCount > 0
        ? "localstorage"
        : hasImages
          ? "localstorage"
          : "none";

  let warning: string | null = null;
  if (storedInlineCount > 0) {
    if (idbStatus === "failed") {
      warning = `IndexedDB write failed (${idbFailureMessage ?? "storage error"}); the photograph was saved inline in localStorage instead.`;
    } else if (idbStatus === "unavailable") {
      warning =
        "IndexedDB is unavailable in this browser; the photograph was saved inline in localStorage.";
    } else if (idbStatus === "memory-fallback") {
      warning =
        "IndexedDB was bypassed by an in-memory fallback; the photograph was persisted in localStorage.";
    }
  }

  if (cleanupWarnings.length > 0) {
    warning = [warning, ...cleanupWarnings].filter(Boolean).join(" ");
  }

  return {
    wardrobe: {
      v: 1,
      products: [...cloneProducts(), ...cleanCustom],
      events,
      heightCm: next.heightCm,
    },
    report: {
      indexedDbStatus: idbStatus,
      imageLocation,
      persistedDurably: true,
      warning,
    },
  };
}

function enqueueForStorage<T>(storage: StorageLike | null, run: () => Promise<T>): Promise<T> {
  if (!storage) {
    const queued = defaultCommitQueue.then(run, run);
    defaultCommitQueue = queued.catch(() => undefined);
    return queued;
  }
  const prev = storageCommitQueues.get(storage) ?? Promise.resolve();
  const queued = prev.then(run, run);
  storageCommitQueues.set(
    storage,
    queued.catch(() => undefined),
  );
  return queued;
}

export async function commitWardrobeChangeWithReport(
  fn: (current: Wardrobe) => Wardrobe,
  deps?: WardrobeStorageDeps,
): Promise<{ wardrobe: Wardrobe; report: WardrobeCommitReport }> {
  const { storage, isCustomDeps } = resolveDeps(deps);
  if (isCustomDeps && storage) {
    return enqueueForStorage(storage, () => performCommit(fn, deps));
  }
  if (isCustomDeps) {
    return performCommit(fn, deps);
  }
  const run = () => performCommit(fn, deps);
  const queued = defaultCommitQueue.then(run, run);
  defaultCommitQueue = queued.catch(() => undefined);
  return queued;
}

export async function commitWardrobeChange(
  fn: (current: Wardrobe) => Wardrobe,
  deps?: WardrobeStorageDeps,
): Promise<Wardrobe> {
  const { wardrobe } = await commitWardrobeChangeWithReport(fn, deps);
  return wardrobe;
}
