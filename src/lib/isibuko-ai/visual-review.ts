import { acceptFact, validateFact, type ProductFact } from "./product-facts.ts";
import { readPhotograph } from "./photo-heuristic.ts";

/** Separate from the wardrobe. This key must not be written into isibuko.live.v1. */
export const VISUAL_REVIEW_KEY = "isibuko.visual-review.v1";
export const WARDROBE_KEY = "isibuko.live.v1";

export type ReviewStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export type ReviewRecord = {
  imageHash: string;
  pending: ProductFact[];
  accepted: ProductFact[];
  /** A typed name. Not an account and not an independent check. */
  reviewerIdentity: "self-reported";
};

type ReviewFile = { v: 1; byProductId: Record<string, ReviewRecord> };

export type ReviewScan =
  | { ok: true; hash: string; pending: ProductFact[]; note: string }
  | { ok: false; code: string; reason: string; hash: string | null };

const HASH = /^[a-f0-9]{64}$/;

function emptyFile(): ReviewFile {
  return { v: 1, byProductId: {} };
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function cleanFact(value: unknown, kind: "pending" | "accepted"): ProductFact | null {
  if (!isPlainObject(value)) return null;
  const fact = value as ProductFact;
  if (validateFact(fact).ok !== true) return null;
  if (kind === "pending" && (fact.origin !== "detected" || fact.verified !== false)) return null;
  if (kind === "accepted" && fact.origin !== "human-verified") return null;
  if (typeof fact.value === "string" && (fact.value.includes("data:image") || fact.value.length > 180)) return null;
  return {
    field: fact.field,
    value: fact.value,
    origin: fact.origin,
    confidence: fact.confidence,
    verified: fact.verified,
    source: fact.source,
  };
}

function cleanRecord(value: unknown): ReviewRecord | null {
  if (!isPlainObject(value)) return null;
  if (typeof value.imageHash !== "string" || !HASH.test(value.imageHash)) return null;
  if (value.reviewerIdentity !== "self-reported") return null;
  if (!Array.isArray(value.pending) || !Array.isArray(value.accepted)) return null;
  return {
    imageHash: value.imageHash,
    pending: value.pending.map((fact) => cleanFact(fact, "pending")).filter((fact): fact is ProductFact => fact !== null),
    accepted: value.accepted.map((fact) => cleanFact(fact, "accepted")).filter((fact): fact is ProductFact => fact !== null),
    reviewerIdentity: "self-reported",
  };
}

export function readReviewFile(storage: ReviewStorage): ReviewFile {
  try {
    const raw = storage.getItem(VISUAL_REVIEW_KEY);
    if (!raw) return emptyFile();
    const parsed = JSON.parse(raw) as unknown;
    if (!isPlainObject(parsed) || parsed.v !== 1 || !isPlainObject(parsed.byProductId)) return emptyFile();
    const byProductId: Record<string, ReviewRecord> = {};
    for (const [id, record] of Object.entries(parsed.byProductId)) {
      if (!id || id.length > 80) continue;
      const clean = cleanRecord(record);
      if (clean) byProductId[id] = clean;
    }
    return { v: 1, byProductId };
  } catch {
    return emptyFile();
  }
}

function writeReviewFile(storage: ReviewStorage, file: ReviewFile): void {
  storage.setItem(VISUAL_REVIEW_KEY, JSON.stringify({ v: 1, byProductId: file.byProductId }));
}

export function readProductReview(storage: ReviewStorage, productId: string): ReviewRecord | null {
  return readReviewFile(storage).byProductId[productId] ?? null;
}

export function writeProductReview(storage: ReviewStorage, productId: string, record: ReviewRecord): void {
  if (!productId || productId.length > 80) return;
  const clean = cleanRecord(record);
  if (!clean) return;
  const file = readReviewFile(storage);
  file.byProductId[productId] = clean;
  writeReviewFile(storage, file);
}

export function deleteProductReview(storage: ReviewStorage, productId: string): void {
  const file = readReviewFile(storage);
  delete file.byProductId[productId];
  writeReviewFile(storage, file);
}

/** Scan one selected file. The returned record has a hash and facts, never the bytes. */
export async function reviewPhotograph(input: unknown): Promise<ReviewScan> {
  if (!isPlainObject(input)) {
    return { ok: false, code: "UNEXPECTED_INPUT", reason: "Camera frames, landmarks, measurements, and addresses are not accepted.", hash: null };
  }
  for (const key of Object.keys(input)) {
    if (key !== "bytes") {
      return { ok: false, code: "UNEXPECTED_INPUT", reason: "Camera frames, landmarks, measurements, and addresses are not accepted.", hash: null };
    }
  }
  const bytes = input.bytes;
  if (!(bytes instanceof Uint8Array)) {
    return { ok: false, code: "UNEXPECTED_INPUT", reason: "The photograph must be the file bytes, not a path or an address.", hash: null };
  }
  const hash = await sha256(bytes);
  const scanned = readPhotograph({ bytes });
  if (!scanned.ok) return { ok: false, code: scanned.code, reason: scanned.reason, hash };
  return { ok: true, hash, pending: scanned.facts.filter((fact) => fact.origin === "detected" && fact.verified === false), note: scanned.note };
}

/** The same photograph keeps the review. A new hash drops pending and accepted facts. */
export function replacePhotograph(current: ReviewRecord | null, hash: string, pending: ProductFact[]): ReviewRecord {
  if (current && current.imageHash === hash) return current;
  return {
    imageHash: hash,
    pending: pending.filter((fact) => fact.origin === "detected" && fact.verified === false),
    accepted: [],
    reviewerIdentity: "self-reported",
  };
}

export function acceptPending(
  record: ReviewRecord,
  field: string,
  reviewerName: string,
  at: number,
): { ok: true; record: ReviewRecord } | { ok: false; reason: string } {
  const fact = record.pending.find((item) => item.field === field);
  if (!fact) return { ok: false, reason: "That observation is not pending." };
  const accepted = acceptFact(fact, { by: reviewerName, at });
  if (!accepted.ok) return accepted;
  return {
    ok: true,
    record: {
      imageHash: record.imageHash,
      reviewerIdentity: "self-reported",
      pending: record.pending.filter((item) => item.field !== field),
      accepted: [...record.accepted.filter((item) => item.field !== field), accepted.fact],
    },
  };
}

export function rejectPending(record: ReviewRecord, field: string): ReviewRecord {
  return {
    imageHash: record.imageHash,
    reviewerIdentity: "self-reported",
    pending: record.pending.filter((item) => item.field !== field),
    accepted: record.accepted,
  };
}
