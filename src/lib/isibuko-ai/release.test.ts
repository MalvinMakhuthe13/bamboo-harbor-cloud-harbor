import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { liveAdapter, shirtAdapter } from "../isibuko-gen/adapter.ts";
import { landmarkJitter, latencyWithin } from "../isibuko-gen/evaluate.ts";
import { DEFAULT_PRODUCTS } from "./catalog.ts";
import { conditionProduct } from "./condition.ts";
import { buildCustomProduct, canAddCustom, hexTint } from "./merchant.ts";
import { braceletSprite, clothingQuad, watchSprite } from "./placement.ts";
import { FRAME_POLICY, assertProductImage, imageMagic, publicHttpUrl } from "./privacy.ts";
import { applySessionEvent, cameraErrorMessage, reuseLiveCamera } from "./session.ts";

const body = {
  shoulderL: { x: 0.4, y: 0.3 },
  shoulderR: { x: 0.6, y: 0.3 },
  hipL: { x: 0.42, y: 0.55 },
  hipR: { x: 0.58, y: 0.55 },
  ankleL: { x: 0.42, y: 0.95 },
  ankleR: { x: 0.58, y: 0.95 },
  scale: 1,
};

describe("camera session", () => {
  it("keeps the same session when the product, colour, or size changes", () => {
    const open = applySessionEvent({ session: 0, source: "off" }, "camera");
    const next = applySessionEvent(open, "product");
    const colour = applySessionEvent(next, "colour");
    const size = applySessionEvent(colour, "size");
    assert.equal(open.restarted, true);
    assert.equal(size.session, open.session);
    assert.equal(size.source, "camera");
    assert.equal(size.restarted, false);
    const stopped = applySessionEvent(size, "stop");
    assert.equal(stopped.source, "off");
    assert.equal(stopped.session, open.session);
    const again = applySessionEvent(stopped, "camera");
    assert.equal(again.session, open.session + 1);
    assert.equal(again.restarted, true);
  });

  it("does not open a second camera while the first track is live", () => {
    assert.equal(reuseLiveCamera("camera", [{ readyState: "live" }]), true);
    assert.equal(reuseLiveCamera("camera", [{ readyState: "ended" }]), false);
    assert.equal(reuseLiveCamera("studio", [{ readyState: "live" }]), false);
  });

  it("explains a denied camera without pretending a studio photo is live", () => {
    const message = cameraErrorMessage({ name: "NotAllowedError" });
    assert.match(message, /permission/i);
    assert.match(message, /test/i);
    assert.match(cameraErrorMessage({ name: "NotFoundError" }), /No camera/);
  });
});

describe("privacy", () => {
  it("does not upload frames and refuses private merchant links", () => {
    assert.equal(FRAME_POLICY.leavesDevice, false);
    assert.equal(FRAME_POLICY.externalInference, false);
    assert.equal(FRAME_POLICY.productSwitchRestartsCamera, false);
    assert.equal(publicHttpUrl("https://shop.example/linen").ok, true);
    assert.equal(publicHttpUrl("http://127.0.0.1/admin").ok, false);
    assert.equal(publicHttpUrl("http://192.168.0.8/cam").ok, false);
    assert.equal(publicHttpUrl("file:///etc/passwd").ok, false);
    assert.equal(publicHttpUrl("javascript:alert(1)").ok, false);
    assert.equal(publicHttpUrl("http://user:secret@shop.example").ok, false);
    assert.equal(publicHttpUrl("http://10.0.0.5/x").ok, false);
    assert.equal(publicHttpUrl("http://127.1/").ok, false);
    assert.equal(publicHttpUrl("http://2130706433/").ok, false);
    assert.equal(publicHttpUrl("http://[fd00::1]/").ok, false);
    assert.equal(assertProductImage({ type: "image/svg+xml", size: 100 }).ok, false);
    assert.equal(assertProductImage({ type: "image/png", size: 2_000_000 }).ok, false);
    assert.equal(assertProductImage({ type: "image/jpeg", size: 20_000 }).ok, true);
    assert.equal(imageMagic(Uint8Array.of(0xff, 0xd8, 0xff, 0x00)), "image/jpeg");
    assert.equal(imageMagic(Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)), "image/png");
    assert.equal(imageMagic(Uint8Array.of(0x3c, 0x73, 0x76, 0x67)), null);
  });
});

describe("product condition", () => {
  it("keeps the merchant shirt identity and says a photograph is not a measurement", () => {
    const shirt = DEFAULT_PRODUCTS.find((item) => item.id === "shirt-linen");
    assert.ok(shirt);
    if (!shirt) return;
    const condition = conditionProduct(shirt, [0.1, 0.1, 0.1]);
    assert.equal(condition.productId, "shirt-linen");
    assert.equal(condition.cut, "sleeved");
    assert.equal(condition.photographIsNotAMeasurement, true);
    assert.ok(condition.missing.some((line) => /not a garment measurement/i.test(line)));
  });

  it("fits a skirt above the ankle and a bracelet off the watch face", () => {
    const skirt = clothingQuad({ ...body, category: "skirt" });
    const pants = clothingQuad({ ...body, category: "pants" });
    assert.ok(skirt.botL.y < pants.botL.y);
    assert.ok(skirt.botL.y < 0.85);
    const elbow = { x: 0.2, y: 0.4 };
    const wrist = { x: 0.2, y: 0.7 };
    const watch = watchSprite(elbow, wrist, 1, 1);
    const bracelet = braceletSprite(elbow, wrist, 1, 1);
    assert.ok(Math.hypot(bracelet.cx - watch.cx, bracelet.cy - watch.cy) > 0.01);
    assert.ok(bracelet.h < watch.h);
  });
});

describe("merchant draft", () => {
  it("accepts a public skirt and refuses a private link and a full studio", () => {
    const saved = buildCustomProduct(
      {
        name: "Olive wrap",
        category: "skirt",
        priceZar: 700,
        fabric: "Cotton",
        colourName: "Olive",
        colourHex: "#5c6b3a",
        merchantUrl: "https://shop.example/skirt",
        image: "data:image/png;base64,aaaa",
        imageType: "image/png",
        imageBytes: 1200,
      },
      "custom-1",
    );
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    assert.equal(saved.product.category, "skirt");
    assert.equal(saved.product.sizes.length > 0, true);
    assert.equal(saved.product.merchantUrl, "https://shop.example/skirt");
    assert.ok(hexTint("#5c6b3a"));
    const blocked = buildCustomProduct(
      {
        name: "Bad",
        category: "bracelet",
        priceZar: 10,
        fabric: "",
        colourName: "",
        colourHex: "",
        merchantUrl: "http://10.0.0.5/x",
        image: "data:image/png;base64,aaaa",
        imageType: "image/png",
        imageBytes: 100,
      },
      "custom-2",
    );
    assert.equal(blocked.ok, false);
    assert.equal(canAddCustom(24, false), false);
    assert.equal(canAddCustom(24, true), true);
  });
});

describe("model adapter", () => {
  it("does not generate, and the untrained shirt adapter is not the live mirror", () => {
    const live = liveAdapter().run({
      category: "shirt",
      productId: "shirt-linen",
      image: "/catalog/shirt-linen.png",
      frameWidth: 720,
      frameHeight: 960,
      poseTracked: true,
      clothesMask: true,
      source: "camera",
    });
    assert.equal(live.generated, false);
    assert.equal(live.output, null);
    assert.equal(live.usedComposite, false);
    const shirt = shirtAdapter.run({
      category: "shirt",
      productId: "shirt-linen",
      image: "/catalog/shirt-linen.png",
      frameWidth: 720,
      frameHeight: 960,
      poseTracked: true,
      clothesMask: true,
      source: "camera",
    });
    assert.equal(shirt.trained, false);
    assert.equal(shirt.live, false);
    assert.equal(shirt.generated, false);
    assert.equal(shirt.output, null);
    const jitter = landmarkJitter([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ]);
    assert.equal(jitter, 0);
    assert.equal(latencyWithin(12, 30).pass, true);
    assert.equal(latencyWithin(80, 30).pass, false);
  });
});
