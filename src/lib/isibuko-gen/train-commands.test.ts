import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evalArtifact, importArtifact, kagglePackList, prepareManifest, syntheticManifest } from "./train-commands.ts";
import { FRAME_POLICY } from "../isibuko-ai/privacy.ts";

describe("train commands", () => {
  it("packages a synthetic manifest without training it", () => {
    assert.equal(FRAME_POLICY.externalInference, false);
    const manifest = syntheticManifest();
    assert.equal(manifest.trainable, false);
    const packed = prepareManifest(manifest);
    assert.equal(packed.ok, true);
    if (packed.ok) assert.match(packed.files?.["manifest-package.json"] ?? "", /"trained": false/);
  });

  it("refuses a weight file and parks a json note with the flag off", () => {
    const refused = importArtifact("model.safetensors", { id: "x" });
    assert.equal(refused.ok, false);
    const parked = importArtifact("note.json", { id: "note" });
    assert.equal(parked.ok, true);
    if (parked.ok) assert.match(parked.files?.["imported-flag.json"] ?? "", /"enabled": false/);
    const score = evalArtifact({ id: "none" });
    assert.equal(score.ok, true);
    if (score.ok) assert.match(score.lines.join(" "), /geometric-composite/);
    assert.ok(kagglePackList().some((item) => item.path.endsWith(".ipynb")));
  });
});
