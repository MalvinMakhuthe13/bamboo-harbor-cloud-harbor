export const LOCAL_IMAGE_DB_NAME = "isibuko-local-assets-v1";
export const LOCAL_IMAGE_STORE_NAME = "images";
export const ASSET_DRAFT_IMAGE_KEY = "asset-editor-draft";

export type ImageStoreStatus = "indexeddb" | "memory" | "unavailable";

export type ImageGetResult =
  | { ok: true; dataUrl: string | null; source: ImageStoreStatus }
  | { ok: false; reason: "unavailable" | "error"; message: string };

export type ImagePutResult =
  | { ok: true; persistedTo: "indexeddb" | "memory" }
  | { ok: false; reason: "unavailable" | "quota" | "error"; message: string };

export type ImageDeleteResult =
  | { ok: true }
  | { ok: false; reason: "unavailable" | "error"; message: string };

export type LocalImageStore = {
  readonly kind: ImageStoreStatus;
  getImage(key: string): Promise<string | null>;
  putImage(key: string, dataUrl: string): Promise<boolean>;
  deleteImage(key: string): Promise<void>;
  readImage(key: string): Promise<ImageGetResult>;
  writeImage(key: string, dataUrl: string): Promise<ImagePutResult>;
  removeImage(key: string): Promise<ImageDeleteResult>;
};

type StoredImageRecord = {
  dataUrl: string;
  updatedAt: number;
};

export function productImageKey(productId: string): string {
  return `product:${productId}`;
}

export function isQuotaError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String((error as { name?: unknown }).name) : "";
  const code = "code" in error ? (error as { code?: unknown }).code : undefined;
  return name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED" || code === 22 || code === 1014;
}

export const unavailableImageStore: LocalImageStore = {
  kind: "unavailable",
  async getImage() {
    return null;
  },
  async putImage() {
    return false;
  },
  async deleteImage() {},
  async readImage() {
    return { ok: false, reason: "unavailable", message: "IndexedDB is unavailable in this browser." };
  },
  async writeImage() {
    return { ok: false, reason: "unavailable", message: "IndexedDB is unavailable in this browser." };
  },
  async removeImage() {
    return { ok: false, reason: "unavailable", message: "IndexedDB is unavailable in this browser." };
  },
};

export function createMemoryImageStore(initial?: Record<string, string>): LocalImageStore {
  const map = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    kind: "memory",
    async getImage(key) {
      return map.get(key) ?? null;
    },
    async putImage(key, dataUrl) {
      map.set(key, dataUrl);
      return true;
    },
    async deleteImage(key) {
      map.delete(key);
    },
    async readImage(key) {
      return { ok: true, dataUrl: map.get(key) ?? null, source: "memory" };
    },
    async writeImage(key, dataUrl) {
      map.set(key, dataUrl);
      return { ok: true, persistedTo: "memory" };
    },
    async removeImage(key) {
      map.delete(key);
      return { ok: true };
    },
  };
}

function readStoredValue(raw: unknown): string | null {
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object" && "dataUrl" in raw && typeof (raw as StoredImageRecord).dataUrl === "string") {
    return (raw as StoredImageRecord).dataUrl;
  }
  return null;
}

export function createIndexedDbImageStore(idbFactory?: IDBFactory | null): LocalImageStore {
  const factory =
    idbFactory !== undefined
      ? idbFactory
      : typeof window !== "undefined" && "indexedDB" in window
        ? window.indexedDB
        : null;

  if (!factory) return unavailableImageStore;

  let dbPromise: Promise<{ db: IDBDatabase; reason?: undefined } | { db: null; reason: "unavailable" | "error"; message: string }> | null = null;

  function openDb(): Promise<{ db: IDBDatabase; reason?: undefined } | { db: null; reason: "unavailable" | "error"; message: string }> {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      try {
        const request = factory!.open(LOCAL_IMAGE_DB_NAME, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(LOCAL_IMAGE_STORE_NAME)) {
            db.createObjectStore(LOCAL_IMAGE_STORE_NAME);
          }
        };
        request.onsuccess = () => {
          const db = request.result;
          db.onclose = () => {
            dbPromise = null;
          };
          db.onversionchange = () => {
            db.close();
            dbPromise = null;
          };
          resolve({ db });
        };
        request.onerror = () => {
          dbPromise = null;
          resolve({
            db: null,
            reason: "unavailable",
            message: request.error?.message || "IndexedDB could not be opened in this browser.",
          });
        };
        request.onblocked = () => {
          dbPromise = null;
          resolve({
            db: null,
            reason: "unavailable",
            message: "IndexedDB open request was blocked by another tab or storage lock.",
          });
        };
      } catch (error) {
        dbPromise = null;
        resolve({
          db: null,
          reason: "unavailable",
          message: error instanceof Error ? error.message : "IndexedDB is unavailable in this browser.",
        });
      }
    });
    return dbPromise;
  }

  async function readImage(key: string): Promise<ImageGetResult> {
    const opened = await openDb();
    if (!opened.db) return { ok: false, reason: opened.reason, message: opened.message };
    const db = opened.db;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(LOCAL_IMAGE_STORE_NAME, "readonly");
        const req = tx.objectStore(LOCAL_IMAGE_STORE_NAME).get(key);
        req.onsuccess = () => resolve({ ok: true, dataUrl: readStoredValue(req.result), source: "indexeddb" });
        req.onerror = () =>
          resolve({
            ok: false,
            reason: "error",
            message: req.error?.message || "Failed to read image from IndexedDB.",
          });
        tx.onabort = () =>
          resolve({
            ok: false,
            reason: "error",
            message: tx.error?.message || "IndexedDB read transaction aborted.",
          });
      } catch (error) {
        resolve({
          ok: false,
          reason: "error",
          message: error instanceof Error ? error.message : "Failed to start IndexedDB read transaction.",
        });
      }
    });
  }

  async function writeImage(key: string, dataUrl: string): Promise<ImagePutResult> {
    const opened = await openDb();
    if (!opened.db) return { ok: false, reason: opened.reason, message: opened.message };
    const db = opened.db;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(LOCAL_IMAGE_STORE_NAME, "readwrite");
        const value: StoredImageRecord = { dataUrl, updatedAt: Date.now() };
        const req = tx.objectStore(LOCAL_IMAGE_STORE_NAME).put(value, key);
        req.onerror = () => {
          const err = req.error ?? tx.error;
          resolve({
            ok: false,
            reason: isQuotaError(err) ? "quota" : "error",
            message: isQuotaError(err)
              ? "IndexedDB storage quota was exceeded while saving the photograph."
              : err?.message || "Failed to write photograph to IndexedDB.",
          });
        };
        tx.oncomplete = () => resolve({ ok: true, persistedTo: "indexeddb" });
        tx.onerror = () => {
          const err = tx.error ?? req.error;
          resolve({
            ok: false,
            reason: isQuotaError(err) ? "quota" : "error",
            message: isQuotaError(err)
              ? "IndexedDB storage quota was exceeded while saving the photograph."
              : err?.message || "IndexedDB write transaction failed.",
          });
        };
        tx.onabort = () => {
          const err = tx.error ?? req.error;
          resolve({
            ok: false,
            reason: isQuotaError(err) ? "quota" : "error",
            message: isQuotaError(err)
              ? "IndexedDB storage quota was exceeded while saving the photograph."
              : err?.message || "IndexedDB write transaction aborted.",
          });
        };
      } catch (error) {
        resolve({
          ok: false,
          reason: isQuotaError(error) ? "quota" : "error",
          message: isQuotaError(error)
            ? "IndexedDB storage quota was exceeded while saving the photograph."
            : error instanceof Error
              ? error.message
              : "Failed to write photograph to IndexedDB.",
        });
      }
    });
  }

  async function removeImage(key: string): Promise<ImageDeleteResult> {
    const opened = await openDb();
    if (!opened.db) return { ok: false, reason: opened.reason, message: opened.message };
    const db = opened.db;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(LOCAL_IMAGE_STORE_NAME, "readwrite");
        tx.objectStore(LOCAL_IMAGE_STORE_NAME).delete(key);
        tx.oncomplete = () => resolve({ ok: true });
        tx.onerror = () =>
          resolve({ ok: false, reason: "error", message: tx.error?.message || "Failed to delete image from IndexedDB." });
        tx.onabort = () =>
          resolve({ ok: false, reason: "error", message: tx.error?.message || "IndexedDB delete transaction aborted." });
      } catch (error) {
        resolve({
          ok: false,
          reason: "error",
          message: error instanceof Error ? error.message : "Failed to delete image from IndexedDB.",
        });
      }
    });
  }

  return {
    kind: "indexeddb",
    readImage,
    writeImage,
    removeImage,
    async getImage(key) {
      const res = await readImage(key);
      return res.ok ? res.dataUrl : null;
    },
    async putImage(key, dataUrl) {
      const res = await writeImage(key, dataUrl);
      return res.ok;
    },
    async deleteImage(key) {
      await removeImage(key);
    },
  };
}

let defaultStore: LocalImageStore | null = null;

export function getDefaultImageStore(): LocalImageStore {
  if (typeof window === "undefined") return unavailableImageStore;
  if (!defaultStore || defaultStore.kind === "unavailable") {
    defaultStore = createIndexedDbImageStore();
  }
  return defaultStore;
}
