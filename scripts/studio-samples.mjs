/**
 * Draws labelled studio samples. These are flat pictures for the mirror,
 * not photographs of garments and not a model output.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const FONT = {
  S: ["01110", "10001", "10000", "01110", "00001", "10001", "01110"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
};

function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    rgba.copy(raw, row + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(12 + body.length);
    out.writeUInt32BE(body.length - 4, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), out.length - 4);
    return out;
  };
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function crc(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function stamp(rgba, width, text, x0, y0, scale, color) {
  let x = x0;
  for (const ch of text) {
    const rows = FONT[ch];
    if (!rows) continue;
    for (let row = 0; row < rows.length; row++) {
      for (let col = 0; col < rows[row].length; col++) {
        if (rows[row][col] !== "1") continue;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const px = x + col * scale + sx;
            const py = y0 + row * scale + sy;
            const i = (py * width + px) * 4;
            if (i < 0 || i + 3 >= rgba.length) continue;
            rgba[i] = color[0];
            rgba[i + 1] = color[1];
            rgba[i + 2] = color[2];
            rgba[i + 3] = 255;
          }
        }
      }
    }
    x += 6 * scale;
  }
}

function canvas(width, height) {
  return Buffer.alloc(width * height * 4);
}

function fill(rgba, width, x, y, color) {
  if (x < 0 || y < 0) return;
  const i = (y * width + x) * 4;
  if (i < 0 || i + 3 >= rgba.length) return;
  rgba[i] = color[0];
  rgba[i + 1] = color[1];
  rgba[i + 2] = color[2];
  rgba[i + 3] = color[3];
}

function vest(width, height) {
  const rgba = canvas(width, height);
  const clay = [176, 122, 90, 255];
  const shade = [140, 92, 66, 255];
  for (let y = 0; y < height; y++) {
    const v = y / (height - 1);
    const neck = v < 0.16 ? (0.16 - v) / 0.16 : 0;
    const half = width * (0.3 - neck * 0.12 + Math.sin(Math.PI * Math.min(v, 1)) * 0.04);
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width - 0.5;
      const armhole = v < 0.42 && Math.abs(u) > 0.16 + v * 0.22;
      if (Math.abs(u * width) > half || armhole) continue;
      const band = Math.abs(u) > 0.08 && Math.abs(u) < 0.11 ? shade : clay;
      fill(rgba, width, x, y, band);
    }
  }
  stamp(rgba, width, "SAMPLE", 18, 24, 3, [72, 42, 28]);
  return rgba;
}

function shortSleeve(width, height) {
  const rgba = canvas(width, height);
  const linen = [214, 196, 166, 255];
  const crease = [186, 164, 132, 255];
  for (let y = 0; y < height; y++) {
    const v = y / (height - 1);
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width - 0.5;
      const body = Math.abs(u) < 0.22 + v * 0.04 && v > 0.08 && v < 0.96;
      const sleeve = v > 0.16 && v < 0.4 && Math.abs(u) < 0.42 && Math.abs(u) > 0.18;
      if (!body && !sleeve) continue;
      const fold = Math.abs(Math.sin(u * 28 + v * 6)) > 0.92 ? crease : linen;
      fill(rgba, width, x, y, fold);
    }
  }
  stamp(rgba, width, "SAMPLE", 16, 20, 3, [90, 64, 36]);
  return rgba;
}

function skirt(width, height) {
  const rgba = canvas(width, height);
  const olive = [92, 104, 72, 255];
  const band = [70, 80, 54, 255];
  for (let y = 0; y < height; y++) {
    const v = y / (height - 1);
    const half = width * (0.18 + v * 0.24);
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width - 0.5;
      if (Math.abs(u * width) > half || v < 0.06) continue;
      const pleat = Math.floor((u + 0.5) * 7) % 2 === 0 ? olive : band;
      fill(rgba, width, x, y, pleat);
    }
  }
  stamp(rgba, width, "SAMPLE", 16, 18, 3, [236, 228, 206]);
  return rgba;
}

function bracelet(width, height) {
  const rgba = canvas(width, height);
  const metal = [176, 138, 78, 255];
  const edge = [112, 82, 40, 255];
  const cy = (height - 1) / 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nx = (x + 0.5) / width;
      const ny = (y - cy) / (height * 0.28);
      const ring = Math.abs(ny) < 1 && nx > 0.08 && nx < 0.92;
      if (!ring) continue;
      fill(rgba, width, x, y, Math.abs(ny) > 0.72 ? edge : metal);
    }
  }
  stamp(rgba, width, "SAMPLE", 12, 8, 2, [64, 42, 18]);
  return rgba;
}

const files = [
  ["public/catalog/shirt-vest-sample.png", 320, 420, vest],
  ["public/catalog/shirt-short-sample.png", 360, 420, shortSleeve],
  ["public/catalog/skirt-studio-sample.png", 320, 420, skirt],
  ["public/catalog/bracelet-studio-sample.png", 280, 96, bracelet],
];

for (const [path, width, height, draw] of files) {
  writeFileSync(path, png(width, height, draw(width, height)));
}
