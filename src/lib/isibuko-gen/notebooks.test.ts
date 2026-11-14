import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const NOTEBOOKS = [
  "training/kaggle/isibuko-motion-tune.ipynb",
  "training/kaggle/isibuko-cutout-classifier.ipynb",
  "training/kaggle/isibuko-nail-segment.ipynb",
];

describe("training notebooks", () => {
  it("runs the guarded stubs as __main__ so the cells are not empty", () => {
    for (const path of NOTEBOOKS) {
      const source = readFileSync(path, "utf8");
      assert.match(source, /run_name=\\"__main__\\"/);
      assert.equal(/runpy\.run_path\(str\(script\)\)/.test(source), false);
    }
  });
});
