import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { findProduct, DEFAULT_PRODUCTS } from "./catalog.ts";
import { FRAME_POLICY } from "./privacy.ts";
import {
  acceptFact,
  catalogueReader,
  defaultReader,
  disabledReader,
  factFrom,
  factText,
  selectReader,
  validateFact,
  type CatalogueReadInput,
  type ProductFact,
} from "./product-facts.ts";

function fromProduct(id: string, swatchName: string | null): CatalogueReadInput {
  const product = findProduct(DEFAULT_PRODUCTS, id);
  const swatch = swatchName ? product.swatches.find((item) => item.name === swatchName) : undefined;
  return {
    productId: product.id,
    name: product.name,
    category: product.category,
    custom: product.custom === true,
    fabric: product.fabric ?? null,
    photograph: Boolean(product.image),
    swatchName: swatch?.name ?? swatchName,
    sizeCount: product.sizes.length,
  };
}

function field(facts: ProductFact[], name: string): ProductFact {
  const found = facts.find((fact) => fact.field === name);
  assert.ok(found, name);
  return found;
}

describe("product facts", () => {
  it("keeps the disabled reader as the default and does not call a model", () => {
    assert.equal(defaultReader, disabledReader);
    assert.equal(selectReader(null), disabledReader);
    assert.equal(selectReader("gemini"), disabledReader);
    assert.equal(selectReader(catalogueReader.id), catalogueReader);
    assert.equal(FRAME_POLICY.externalInference, false);
    const read = disabledReader.read(fromProduct("shirt-linen", "As photographed"));
    assert.equal(read.ok, true);
    if (read.ok) assert.deepEqual(read.facts, []);
  });

  it("reads a house shirt from the catalogue fields that already exist", () => {
    const read = catalogueReader.read(fromProduct("shirt-linen", "Ink"));
    assert.equal(read.ok, true);
    if (!read.ok) return;
    const category = field(read.facts, "category");
    assert.equal(category.value, "shirt");
    assert.equal(category.origin, "catalogue");
    assert.equal(category.confidence, null);
    assert.equal(category.verified, false);
    assert.deepEqual(category.source, { kind: "catalogue", field: "category" });
    assert.equal(field(read.facts, "name").value, "Sand linen");
    assert.equal(field(read.facts, "colour").value, "Ink");
    assert.equal(field(read.facts, "colour").origin, "catalogue");
    assert.equal(field(read.facts, "photograph").value, true);
    assert.equal(field(read.facts, "fabric").value, null);
    assert.equal(factText(field(read.facts, "fabric")), "Unknown");
  });

  it("uses the selected swatch and does not invent a colour from the other swatches", () => {
    const natural = catalogueReader.read(fromProduct("shirt-linen", "As photographed"));
    const white = catalogueReader.read(fromProduct("shirt-linen", "White"));
    assert.equal(natural.ok && white.ok, true);
    if (!natural.ok || !white.ok) return;
    assert.equal(field(natural.facts, "colour").value, "As photographed");
    assert.equal(field(white.facts, "colour").value, "White");
  });

  it("labels a studio product as merchant-supplied and does not call that an independent check", () => {
    const read = catalogueReader.read({
      productId: "custom-1",
      name: "Studio linen",
      category: "shirt",
      custom: true,
      fabric: "linen",
      photograph: true,
      swatchName: "Ink",
      sizeCount: 3,
    });
    assert.equal(read.ok, true);
    if (!read.ok) return;
    const fabric = field(read.facts, "fabric");
    assert.equal(fabric.value, "linen");
    assert.equal(fabric.origin, "merchant");
    assert.equal(fabric.verified, false);
    assert.equal(fabric.confidence, null);
    const checked = validateFact({ ...fabric, verified: true });
    assert.equal(checked.ok, false);
  });

  it("labels placement cut as a category rule", () => {
    const shirt = catalogueReader.read(fromProduct("shirt-linen", "As photographed"));
    const wig = catalogueReader.read(fromProduct("wig-bob", "As photographed"));
    const nails = catalogueReader.read(fromProduct("nails-glass", "Petal"));
    assert.equal(shirt.ok && wig.ok && nails.ok, true);
    if (!shirt.ok || !wig.ok || !nails.ok) return;
    assert.equal(field(shirt.facts, "cut").value, "sleeved");
    assert.equal(field(shirt.facts, "cut").origin, "rule");
    assert.deepEqual(field(shirt.facts, "cut").source, { kind: "rule", id: "condition.cut" });
    assert.equal(field(wig.facts, "cut").value, "hair");
    assert.equal(field(nails.facts, "cut").value, "nails");
  });

  it("leaves unsupported attributes unknown and does not treat a template chart as a body measurement", () => {
    const read = catalogueReader.read(fromProduct("shirt-linen", "As photographed"));
    assert.equal(read.ok, true);
    if (!read.ok) return;
    for (const name of ["pattern", "logo", "texture", "sleeveLength"]) {
      const fact = field(read.facts, name);
      assert.equal(fact.value, null);
      assert.equal(fact.origin, "rule");
      assert.equal(factText(fact), "Unknown");
    }
    const chart = field(read.facts, "sizeChart");
    assert.equal(chart.value, "template-chart");
    assert.equal(chart.origin, "catalogue");
    assert.match(factText(chart), /not a measurement from the photograph/);
    const extracted = field(read.facts, "extractedMeasurements");
    assert.equal(extracted.value, null);
    assert.deepEqual(extracted.source, { kind: "rule", id: "template-not-measured" });
    const hoop = catalogueReader.read(fromProduct("earring-hoop", "As photographed"));
    assert.equal(hoop.ok, true);
    if (hoop.ok) assert.equal(field(hoop.facts, "sizeChart").value, null);
  });

  it("rejects a detected fact that tries to verify itself, and requires a person to accept one", () => {
    const forged = factFrom({
      field: "pattern",
      value: "stripe",
      origin: "detected",
      confidence: 0.8,
      verified: true,
      source: { kind: "detected", method: "none" },
    });
    assert.equal(forged.ok, false);
    const detected = factFrom({
      field: "pattern",
      value: "stripe",
      origin: "detected",
      confidence: 0.8,
      verified: false,
      source: { kind: "detected", method: "none" },
    });
    assert.equal(detected.ok, true);
    if (!detected.ok) return;
    assert.equal(validateFact({ ...detected.fact, verified: true }).ok, false);
    const accepted = acceptFact(detected.fact, { by: "merchant reviewer", at: 1_700_000_000_000 });
    assert.equal(accepted.ok, true);
    if (!accepted.ok) return;
    assert.equal(accepted.fact.origin, "human-verified");
    assert.equal(accepted.fact.verified, true);
    assert.equal(accepted.fact.confidence, null);
    assert.equal(detected.fact.verified, false);
    assert.equal(acceptFact(detected.fact, { by: " ", at: 1 }).ok, false);
  });

  it("rejects images, frames, landmarks and measurements before reading facts", () => {
    const base = fromProduct("wig-bob", "As photographed");
    for (const extra of [
      { image: "/catalog/wig-bob.png" },
      { frame: new Uint8Array([1]) },
      { landmarks: [{ x: 0, y: 0 }] },
      { pixels: [1, 2, 3] },
      { measurements: { headCircCm: 55 } },
      { camera: "stream" },
    ]) {
      const read = catalogueReader.read({ ...base, ...extra } as CatalogueReadInput);
      assert.equal(read.ok, false);
      if (!read.ok) assert.match(read.reason, /product metadata/);
    }
  });

  it("does not put the photograph or the original object into the facts", () => {
    const input = fromProduct("shirt-linen", "Ink");
    const read = catalogueReader.read(input);
    assert.equal(read.ok, true);
    if (!read.ok) return;
    const encoded = JSON.stringify(read.facts);
    assert.equal(encoded.includes("/catalog/"), false);
    assert.equal(encoded.includes("data:image"), false);
    assert.equal(encoded.includes("headCircCm"), false);
  });

  it("leaves the mirror frame request independent of product facts", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../routes/mirror.tsx"), "utf8");
    assert.match(source, /const \[productFacts, setProductFacts\] = useState\(false\)/);
    assert.match(source, /image: active\.image/);
    assert.match(source, /const fit = useMemo\(\s*\(\) => \(metrics \? matchSize\(active\.sizes, metrics\.body\) : null\)/);
    assert.match(source, /aria-live="polite"/);
    assert.doesNotMatch(source, /requestRef\.current = \{[^}]*facts/s);
  });
});
