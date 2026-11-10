import test from "node:test";
import assert from "node:assert/strict";
import { createWearerTrackers } from "./wearer-tracking.ts";

test("exports browser tracker factory", () => {
  assert.equal(typeof createWearerTrackers, "function");
});
