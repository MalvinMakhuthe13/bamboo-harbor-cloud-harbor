import assert from "node:assert/strict";
import { crc32, deflateSync } from "node:zlib";
import { describe, it } from "node:test";
import {
  HEURISTIC_CONFIDENCE,
  PHOTO_LIMITS,
  livePixelBuffersHeld,
  readPhotograph,
} from "./photo-heuristic.ts";

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

function png(width: number, height: number, colorType: number, pixels?: Uint8Array): Uint8Array {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  const parts = [Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), chunk("IHDR", ihdr)];
  if (pixels) {
    const stride = width * (colorType === 6 ? 4 : 3);
    const raw = new Uint8Array(height * (stride + 1));
    for (let y = 0; y < height; y += 1) raw.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
    parts.push(chunk("IDAT", deflateSync(raw)));
  }
  parts.push(chunk("IEND", new Uint8Array()));
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function rgba(width: number, height: number, paint: (x: number, y: number) => [number, number, number, number]): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [red, green, blue, alpha] = paint(x, y);
      const index = (y * width + x) * 4;
      pixels[index] = red;
      pixels[index + 1] = green;
      pixels[index + 2] = blue;
      pixels[index + 3] = alpha;
    }
  }
  return png(width, height, 6, pixels);
}

function jpeg(width: number, height: number): Uint8Array {
  return Uint8Array.of(
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08,
    (height >> 8) & 255, height & 255,
    (width >> 8) & 255, width & 255,
    0x01, 0x01, 0x11, 0x00, 0xff, 0xd9,
  );
}

function webp(width: number, height: number): Uint8Array {
  const data = new Uint8Array(10);
  const w = width - 1;
  const h = height - 1;
  data[4] = w & 255;
  data[5] = (w >> 8) & 255;
  data[6] = (w >> 16) & 255;
  data[7] = h & 255;
  data[8] = (h >> 8) & 255;
  data[9] = (h >> 16) & 255;
  const body = new Uint8Array(18);
  body.set([0x56, 0x50, 0x38, 0x58, 10, 0, 0, 0]);
  body.set(data, 8);
  const out = new Uint8Array(12 + body.length);
  out.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  out.set(body, 12);
  const size = out.length - 8;
  out[4] = size & 255;
  out[5] = (size >> 8) & 255;
  out[6] = (size >> 16) & 255;
  out[7] = (size >> 24) & 255;
  return out;
}

const cutout = rgba(4, 4, (x, y) => {
  const inside = x >= 1 && x <= 2 && y >= 1 && y <= 2;
  return inside ? [9, 8, 7, 17] : [1, 2, 3, 16];
});

describe("local photo heuristic", () => {
  it("reads bounds and median colour from a transparent PNG", () => {
    const report = readPhotograph({ bytes: cutout });
    assert.equal(report.ok, true);
    if (!report.ok) return;
    assert.equal(report.learned, false);
    assert.equal(report.modelExecuted, null);
    assert.equal(report.method, "handcrafted-photograph");
    const colour = report.facts.find((fact) => fact.field === "observedColour");
    const bounds = report.facts.find((fact) => fact.field === "foregroundBounds");
    assert.equal(colour?.value, "rgb(9, 8, 7)");
    assert.equal(bounds?.value, "1,1,2,2");
    assert.match(report.note, /Not a learned model/);
  });

  it("treats alpha 16 as background and does not guess a product from an opaque image", () => {
    const opaque = readPhotograph({ bytes: rgba(4, 4, () => [20, 20, 20, 255]) });
    const barely = readPhotograph({ bytes: rgba(4, 4, () => [20, 20, 20, 17]) });
    assert.equal(opaque.ok && barely.ok, true);
    if (!opaque.ok || !barely.ok) return;
    assert.deepEqual(opaque.facts, []);
    assert.deepEqual(barely.facts, []);
    assert.match(opaque.note, /No separated foreground/);
  });

  it("returns no detected facts for JPEG or WebP", () => {
    const jpegReport = readPhotograph({ bytes: jpeg(8, 8) });
    const webpReport = readPhotograph({ bytes: webp(8, 8) });
    assert.equal(jpegReport.ok && webpReport.ok, true);
    if (!jpegReport.ok || !webpReport.ok) return;
    assert.deepEqual(jpegReport.facts, []);
    assert.deepEqual(webpReport.facts, []);
    assert.match(jpegReport.note, /No separated foreground/);
    assert.match(webpReport.note, /No separated foreground/);
  });

  it("rejects invalid bytes, unsupported formats, and files over 1.5 MB", () => {
    assert.equal(readPhotograph({ bytes: Uint8Array.of(1, 2, 3, 4) }).ok, false);
    const gif = readPhotograph({ bytes: Uint8Array.of(0x47, 0x49, 0x46, 0x38, 0x39, 0x61) });
    assert.equal(gif.ok, false);
    if (!gif.ok) assert.equal(gif.code, "INVALID_IMAGE");
    const huge = new Uint8Array(PHOTO_LIMITS.maxBytes + 1);
    huge.set(jpeg(8, 8));
    const sized = readPhotograph({ bytes: huge });
    assert.equal(sized.ok, false);
    if (!sized.ok) assert.equal(sized.code, "TOO_LARGE");
  });

  it("refuses a declared image that is too large before keeping a pixel buffer", () => {
    const oversized = png(100_000, 100_000, 6);
    const report = readPhotograph({ bytes: oversized });
    assert.equal(report.ok, false);
    if (!report.ok) assert.equal(report.code, "DIMENSIONS");
    assert.equal(livePixelBuffersHeld(), 0);
    const wide = readPhotograph({ bytes: webp(PHOTO_LIMITS.maxEdge + 1, 8) });
    assert.equal(wide.ok, false);
    if (!wide.ok) assert.equal(wide.code, "DIMENSIONS");
  });

  it("never emits category, fabric, pattern, logo, or sleeve facts, and cannot verify itself", () => {
    const report = readPhotograph({ bytes: cutout });
    assert.equal(report.ok, true);
    if (!report.ok) return;
    const fields = report.facts.map((fact) => fact.field);
    for (const name of ["category", "fabric", "pattern", "logo", "sleeveLength", "material", "garmentType", "productColour"]) {
      assert.equal(fields.includes(name), false);
    }
    for (const fact of report.facts) {
      assert.equal(fact.origin, "detected");
      assert.equal(fact.verified, false);
      assert.equal(fact.confidence, HEURISTIC_CONFIDENCE);
      assert.ok((fact.confidence ?? 1) <= 0.5);
      assert.equal(fact.source.kind, "detected");
    }
  });

  it("rejects frames, landmarks, streams, measurements, paths, and addresses", () => {
    const bytes = cutout;
    for (const extra of [
      { frame: bytes },
      { landmarks: [{ x: 0, y: 0 }] },
      { stream: {} },
      { measurements: { headCircCm: 55 } },
      { path: "/tmp/photo.png" },
      { url: "https://example.com/photo.png" },
    ]) {
      const report = readPhotograph({ bytes, ...extra });
      assert.equal(report.ok, false);
      if (!report.ok) assert.equal(report.code, "UNEXPECTED_INPUT");
    }
    const addressed = readPhotograph({ bytes: "https://example.com/photo.png" });
    assert.equal(addressed.ok, false);
    if (!addressed.ok) assert.equal(addressed.code, "UNEXPECTED_INPUT");
  });

  it("releases the pixel buffer after every scan, including a broken PNG", () => {
    const broken = png(4, 4, 6, new Uint8Array(64));
    broken.set(Uint8Array.of(1, 2, 3, 4), 40);
    for (let time = 0; time < 6; time += 1) {
      readPhotograph({ bytes: cutout });
      readPhotograph({ bytes: broken });
      assert.equal(livePixelBuffersHeld(), 0);
    }
  });
});
