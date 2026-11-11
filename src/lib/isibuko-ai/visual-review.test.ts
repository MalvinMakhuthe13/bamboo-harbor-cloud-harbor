import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { deflateSync, crc32 } from "node:zlib";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { acceptFact } from "./product-facts.ts";
import { WARDROBE_KEY, acceptPending, deleteProductReview, readProductReview, readReviewFile, rejectPending, replacePhotograph, reviewPhotograph, writeProductReview, type ReviewRecord, type ReviewStorage } from "./visual-review.ts";

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out[4] = type.charCodeAt(0);
  out[5] = type.charCodeAt(1);
  out[6] = type.charCodeAt(2);
  out[7] = type.charCodeAt(3);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)) >>> 0);
  return out;
}

function transparentPng(): Uint8Array {
  const width = 4;
  const height = 4;
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inside = x >= 1 && x <= 2 && y >= 1 && y <= 2;
      const index = (y * width + x) * 4;
      pixels[index] = 9;
      pixels[index + 1] = 8;
      pixels[index + 2] = 7;
      pixels[index + 3] = inside ? 255 : 0;
    }
  }
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, width);
  new DataView(ihdr.buffer).setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) raw.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  const parts = [
    Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function jpeg(): Uint8Array {
  return Uint8Array.of(0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x08, 0x00, 0x08, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9);
}

function memory(): ReviewStorage & { dump(): string } {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    dump: () => values.get("isibuko.visual-review.v1") ?? "",
  };
}

describe("merchant visual review", () => {
  it("keeps a transparent scan pending and records nothing from an opaque JPEG", async () => {
    const png = await reviewPhotograph({ bytes: transparentPng() });
    const opaque = await reviewPhotograph({ bytes: jpeg() });
    assert.equal(png.ok, true);
    assert.equal(opaque.ok, true);
    if (!png.ok || !opaque.ok) return;
    assert.equal(png.pending.length > 0, true);
    assert.equal(png.pending.every((fact) => fact.verified === false && fact.origin === "detected"), true);
    assert.deepEqual(opaque.pending, []);
    assert.equal(JSON.stringify(png).includes("data:image"), false);
  });

  it("accepts through acceptFact without changing the detected fact, and records a self-reported name", async () => {
    const scan = await reviewPhotograph({ bytes: transparentPng() });
    assert.equal(scan.ok, true);
    if (!scan.ok) return;
    const opened = replacePhotograph(null, scan.hash, scan.pending);
    const original = opened.pending[0];
    assert.ok(original);
    const before = JSON.parse(JSON.stringify(original)) as typeof original;
    const expected = acceptFact(original, { by: "Amahle", at: 10 });
    const accepted = acceptPending(opened, original.field, "Amahle", 10);
    assert.equal(accepted.ok, true);
    if (!accepted.ok) return;
    assert.deepEqual(original, before);
    assert.deepEqual(accepted.record.accepted[0], expected.ok ? expected.fact : null);
    assert.equal(accepted.record.reviewerIdentity, "self-reported");
    assert.equal(accepted.record.accepted[0]?.source.kind === "human" && accepted.record.accepted[0].source.acceptedBy, "Amahle");
    assert.equal(acceptPending(opened, original.field, "  ", 10).ok, false);
  });

  it("discards a rejected observation and does not keep it", async () => {
    const scan = await reviewPhotograph({ bytes: transparentPng() });
    assert.equal(scan.ok, true);
    if (!scan.ok) return;
    const opened = replacePhotograph(null, scan.hash, scan.pending);
    const field = opened.pending[0]?.field ?? "";
    const rejected = rejectPending(opened, field);
    assert.equal(rejected.pending.some((fact) => fact.field === field), false);
    assert.deepEqual(rejected.accepted, []);
  });

  it("drops a review when the photograph hash changes and keeps it when the hash matches", async () => {
    const scan = await reviewPhotograph({ bytes: transparentPng() });
    assert.equal(scan.ok, true);
    if (!scan.ok) return;
    const opened = replacePhotograph(null, scan.hash, scan.pending);
    const accepted = acceptPending(opened, opened.pending[0]?.field ?? "", "Amahle", 10);
    assert.equal(accepted.ok, true);
    if (!accepted.ok) return;
    const same = replacePhotograph(accepted.record, scan.hash, []);
    assert.equal(same.accepted.length, 1);
    assert.equal(same.pending.length, accepted.record.pending.length);
    const changed = replacePhotograph(accepted.record, "ab".repeat(32), scan.pending);
    assert.deepEqual(changed.accepted, []);
    assert.equal(changed.imageHash, "ab".repeat(32));
  });

  it("ignores malformed storage, stores no image bytes, and deletes a removed product", async () => {
    const store = memory();
    store.setItem(WARDROBE_KEY, "wardrobe-before");
    store.setItem("isibuko.visual-review.v1", "{");
    assert.deepEqual(readReviewFile(store).byProductId, {});
    store.setItem("isibuko.visual-review.v1", JSON.stringify({ v: 1, byProductId: { bad: { imageHash: "nope", pending: [{}], accepted: [] } } }));
    assert.equal(readProductReview(store, "bad"), null);
    const scan = await reviewPhotograph({ bytes: transparentPng() });
    assert.equal(scan.ok, true);
    if (!scan.ok) return;
    const record: ReviewRecord = replacePhotograph(null, scan.hash, scan.pending);
    writeProductReview(store, "custom-1", record);
    const saved = store.dump();
    assert.equal(saved.includes("data:image"), false);
    assert.equal(saved.includes(scan.hash), true);
    assert.equal(store.getItem(WARDROBE_KEY), "wardrobe-before");
    deleteProductReview(store, "custom-1");
    assert.equal(readProductReview(store, "custom-1"), null);
    assert.equal(store.getItem(WARDROBE_KEY), "wardrobe-before");
  });

  it("rejects frames, landmarks, streams, and measurements before a review is stored", async () => {
    const bytes = transparentPng();
    for (const extra of [{ frame: bytes }, { landmarks: [] }, { stream: {} }, { measurements: { chestCm: 90 } }, { pixels: [1] }]) {
      const refused = await reviewPhotograph({ bytes, ...extra });
      assert.equal(refused.ok, false);
      if (!refused.ok) assert.equal(refused.hash, null);
    }
  });

  it("leaves product creation and the wardrobe draft untouched", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../components/studio/MerchantStudio.tsx"), "utf8");
    const body = source.slice(source.indexOf("const body: ProductDraft"), source.indexOf("const built"));
    for (const field of ["name: draft.name", "category: draft.category", "priceZar: draft.price", "fabric: draft.fabric", "colourName: draft.colourName", "colourHex: draft.colourHex", "merchantUrl: draft.merchantUrl", "image: draft.image", "imageType: draft.imageType", "imageBytes: draft.imageBytes"]) {
      assert.match(body, new RegExp(field.replace(/[.]/g, "\\.")));
    }
    assert.doesNotMatch(body, /review|observedColour|imageHash/);
    assert.match(source, /reviewPhotograph\(\{ bytes \}\)/);
    assert.match(source, /readProductReview\(window\.localStorage, product\.id\)/);
    assert.match(source, /deleteProductReview\(window\.localStorage, product\.id\)/);
    assert.match(source, /self-reported/);
    const editing = source.slice(source.indexOf("setEditing(product.id)"), source.indexOf("Editing. The photograph"));
    assert.doesNotMatch(editing, /reviewPhotograph|readPhotograph/);
  });
});
