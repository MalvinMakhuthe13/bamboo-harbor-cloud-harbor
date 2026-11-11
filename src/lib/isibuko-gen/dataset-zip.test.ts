import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { packageImageName, safePackageId, storeZip } from "./dataset-zip.ts";

describe("dataset zip", () => {
  it("uses a safe image path and refuses traversal", () => {
    assert.equal(packageImageName("shirt photo.png-abcd1234", "shirt photo.png"), "images/shirt_photo_png-abcd1234.png");
    assert.equal(safePackageId("../secret"), "secret");
    const zip = storeZip([{ name: "session.json", data: new TextEncoder().encode("{\"version\":1}") }]);
    assert.equal(zip[0], 0x50);
    assert.equal(zip[1], 0x4b);
    assert.throws(() => storeZip([{ name: "../secret.txt", data: new Uint8Array([1]) }]), /Path traversal/);
  });
});
