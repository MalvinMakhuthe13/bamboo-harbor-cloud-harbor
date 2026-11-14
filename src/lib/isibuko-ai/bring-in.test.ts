import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchProductPicture, guessFromPicture, readableImageUrl } from "./bring-in.ts";

describe("bring a picture in", () => {
  it("guesses from shape and says the confidence is low", () => {
    const tall = guessFromPicture({ width: 200, height: 600, transparentRatio: 0, cornerUniform: false });
    assert.equal(tall.category, "dress");
    assert.equal(tall.confidence, "low");
    const band = guessFromPicture({ width: 600, height: 80, transparentRatio: 0, cornerUniform: true });
    assert.equal(band.category, "bracelet");
    assert.equal(band.cutout, "corner-key");
  });

  it("fetches a public picture and refuses a private one", async () => {
    assert.equal(readableImageUrl("http://127.0.0.1/a.jpg").ok, false);
    const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0);
    const fetched = await fetchProductPicture("https://shop.example/linen.png", async () =>
      new Response(png, { status: 200, headers: { "content-type": "image/png" } }),
    );
    assert.equal(fetched.ok, true);
    if (fetched.ok) assert.equal(fetched.mime, "image/png");
  });
});
