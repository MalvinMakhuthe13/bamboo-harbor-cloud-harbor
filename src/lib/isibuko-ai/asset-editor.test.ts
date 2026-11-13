import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAssetEditorProduct,
  createMirrorFrameRequest,
  describeGarmentImageAnchor,
  validateAssetDataUrl,
  validateAssetImageBytes,
} from "./asset-editor.ts";
import { buildDressMesh } from "./dress-mesh.ts";
import { buildShirtMesh } from "./garment-mesh.ts";
import { buildLowerBodyMesh } from "./lower-body-mesh.ts";
import { buildCustomProduct } from "./merchant.ts";
import { assertProductImage } from "./privacy.ts";
import type { Category, ProductAnchorPoint } from "@/lib/isibuko-ai/types";

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

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

const bodyAnchors = {
  shoulderL: { x: 0.35, y: 0.28 },
  shoulderR: { x: 0.65, y: 0.28 },
  hipL: { x: 0.4, y: 0.56 },
  hipR: { x: 0.6, y: 0.56 },
  elbowL: { x: 0.25, y: 0.44 },
  elbowR: { x: 0.75, y: 0.44 },
  wristL: { x: 0.22, y: 0.6 },
  wristR: { x: 0.78, y: 0.6 },
  kneeL: { x: 0.41, y: 0.78 },
  kneeR: { x: 0.59, y: 0.78 },
  ankleL: { x: 0.41, y: 0.96 },
  ankleR: { x: 0.59, y: 0.96 },
};

describe("asset editor image and MIME validation", () => {
  it("validates PNG, JPEG, and WebP bytes and generates matching local data URLs", () => {
    for (const [bytes, expectedMime] of [
      [pngBytes(), "image/png"],
      [jpegBytes(), "image/jpeg"],
      [webpBytes(), "image/webp"],
    ] as const) {
      const checked = validateAssetImageBytes(bytes);
      assert.equal(checked.ok, true);
      if (!checked.ok) continue;
      assert.equal(checked.mime, expectedMime);
      assert.equal(checked.size, bytes.byteLength);
      assert.ok(checked.dataUrl.startsWith(`data:${expectedMime};base64,`));
      assert.equal(assertProductImage({ type: checked.mime, size: checked.size }).ok, true);

      const reparsed = validateAssetDataUrl(checked.dataUrl);
      assert.equal(reparsed.ok, true);
      if (reparsed.ok) {
        assert.equal(reparsed.mime, expectedMime);
        assert.equal(reparsed.size, bytes.byteLength);
      }
    }
  });

  it("refuses SVG, spoofed MIME types, remote URLs, and oversized files", () => {
    const svg = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>");
    assert.equal(validateAssetImageBytes(svg).ok, false);

    const webpAsPngDataUrl = `data:image/png;base64,${toBase64(webpBytes())}`;
    assert.equal(validateAssetDataUrl(webpAsPngDataUrl).ok, false);
    assert.equal(validateAssetDataUrl("https://shop.example/shirt.png").ok, false);

    const mismatchedDraft = buildCustomProduct(
      {
        name: "Mismatch shirt",
        category: "shirt",
        fabric: "",
        colourName: "",
        colourHex: "",
        merchantUrl: "",
        image: `data:image/webp;base64,${toBase64(webpBytes())}`,
        imageType: "image/png",
        imageBytes: webpBytes().byteLength,
      },
      "custom-mismatch",
    );
    assert.equal(mismatchedDraft.ok, false);

    const tooLarge = new Uint8Array(1_500_001);
    tooLarge.set(pngBytes());
    assert.equal(validateAssetImageBytes(tooLarge).ok, false);
  });
});

describe("asset editor to wardrobe workflow", () => {
  it("builds unpriced local products for PNG, JPEG, and WebP without inventing price or commercial metadata", () => {
    const webp = validateAssetImageBytes(webpBytes());
    assert.equal(webp.ok, true);
    if (!webp.ok) return;

    const built = buildAssetEditorProduct({
      name: "Indigo camp shirt",
      category: "shirt",
      imageDataUrl: webp.dataUrl,
      anchors: {
        shoulderL: { x: 0.24, y: 0.12, confidence: 1 },
        shoulderR: { x: 0.76, y: 0.12, confidence: 1 },
        hipL: { x: 0.28, y: 0.9, confidence: 1 },
        hipR: { x: 0.72, y: 0.9, confidence: 1 },
      },
      id: "asset-webp-1",
    });
    assert.equal(built.ok, true);
    if (!built.ok) return;
    assert.equal(built.product.id, "asset-webp-1");
    assert.equal(built.product.name, "Indigo camp shirt");
    assert.equal(built.product.priceZar, undefined);
    assert.equal(built.product.fabric, undefined);
    assert.equal(built.product.merchantUrl, undefined);
    assert.equal(built.product.custom, true);
    assert.equal(built.product.image, webp.dataUrl);
    assert.equal(built.product.swatches.length, 1);
    assert.equal(built.product.swatches[0]?.tint, null);
    assert.equal(built.product.fittingAnchors?.version, "isibuko.anchors/1");
  });

  it("refuses missing names instead of inventing a placeholder name", () => {
    const png = validateAssetImageBytes(pngBytes());
    assert.equal(png.ok, true);
    if (!png.ok) return;
    const built = buildAssetEditorProduct({
      name: "   ",
      category: "shirt",
      imageDataUrl: png.dataUrl,
      anchors: {},
    });
    assert.equal(built.ok, false);
  });

  it("distinguishes garment-image anchors on the photo from live wearer landmarks", () => {
    const shoulder = describeGarmentImageAnchor("shoulderL");
    assert.match(shoulder.label, /Garment/i);
    assert.match(shoulder.imageHint, /product photo/i);
    assert.match(shoulder.bodyTarget, /wearer/i);
  });

  it("preserves garment-image fitting anchors in FrameRequest for shirt, trouser, and dress assets", () => {
    const jpeg = validateAssetImageBytes(jpegBytes());
    assert.equal(jpeg.ok, true);
    if (!jpeg.ok) return;

    const cases: {
      name: string;
      category: Category;
      id: string;
      anchors: Record<string, ProductAnchorPoint>;
    }[] = [
      {
        name: "Studio shirt",
        category: "shirt" as const,
        id: "shirt-1",
        anchors: {
          shoulderL: { x: 0.26, y: 0.14 },
          shoulderR: { x: 0.74, y: 0.14 },
          hipL: { x: 0.28, y: 0.86 },
          hipR: { x: 0.72, y: 0.86 },
        },
      },
      {
        name: "Studio trousers",
        category: "pants" as const,
        id: "pants-1",
        anchors: {
          hipL: { x: 0.35, y: 0.08 },
          hipR: { x: 0.85, y: 0.08 },
        },
      },
      {
        name: "Studio slip dress",
        category: "dress" as const,
        id: "dress-1",
        anchors: {
          shoulderL: { x: 0.3, y: 0.08 },
          shoulderR: { x: 0.7, y: 0.08 },
          hipL: { x: 0.32, y: 0.44 },
          hipR: { x: 0.68, y: 0.44 },
          kneeL: { x: 0.22, y: 0.92 },
          kneeR: { x: 0.78, y: 0.92 },
        },
      },
    ];

    for (const item of cases) {
      const built = buildAssetEditorProduct({
        name: item.name,
        category: item.category,
        imageDataUrl: jpeg.dataUrl,
        anchors: item.anchors,
        id: item.id,
      });

      assert.equal(built.ok, true);
      if (!built.ok) continue;

      const request = createMirrorFrameRequest(built.product);

      assert.deepEqual(
        request.fittingAnchors,
        built.product.fittingAnchors,
        `${item.category} fitting anchors must survive FrameRequest creation`,
      );
    }
  });
});
