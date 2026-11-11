import { conditionProduct } from "./condition.ts";
import type { Category, Product } from "./types.ts";

/** Where a product fact came from. A guess is never stored as a verified fact. */
export type FactOrigin = "merchant" | "catalogue" | "rule" | "detected" | "human-verified";

export type FactSource =
  | { kind: "catalogue"; field: string }
  | { kind: "merchant"; field: string }
  | { kind: "rule"; id: "condition.cut" | "unsupported-attribute" | "template-not-measured" }
  | { kind: "detected"; method: string }
  | { kind: "human"; field: string; acceptedBy: string; acceptedAt: number; priorOrigin: Exclude<FactOrigin, "human-verified"> };

export type ProductFact = {
  field: string;
  value: string | number | boolean | null;
  origin: FactOrigin;
  confidence: number | null;
  verified: boolean;
  source: FactSource;
};

export type FactDraft = {
  field: string;
  value: string | number | boolean | null;
  origin: Exclude<FactOrigin, "human-verified">;
  confidence: number | null;
  verified: boolean;
  source: Exclude<FactSource, { kind: "human" }>;
};

export type FactRefusal = { ok: false; reason: string };

const CATEGORIES: readonly Category[] = [
  "wig", "hat", "nails", "glasses", "earrings", "necklace", "watch", "ring",
  "shirt", "jacket", "dress", "pants", "skirt", "bracelet",
];

const READ_KEYS = ["productId", "name", "category", "custom", "fabric", "photograph", "swatchName", "sizeCount"] as const;

export type CatalogueReadInput = {
  productId: string;
  name: string;
  category: Category;
  custom: boolean;
  fabric: string | null;
  photograph: boolean;
  swatchName: string | null;
  sizeCount: number;
};

export const FIELD_LABEL: Record<string, string> = {
  category: "Category",
  name: "Name",
  fabric: "Fabric",
  colour: "Colour",
  photograph: "Photograph",
  sizeChart: "Size chart",
  cut: "Placement cut",
  pattern: "Pattern",
  logo: "Logo",
  texture: "Texture",
  sleeveLength: "Sleeve length",
  extractedMeasurements: "Measurements from the photograph",
};

export const ORIGIN_LABEL: Record<FactOrigin, string> = {
  merchant: "Supplied by the merchant. Not an independent check.",
  catalogue: "From the catalogue.",
  rule: "Based on an Isibuko category rule, not on the photograph.",
  detected: "Detected. Not verified.",
  "human-verified": "Accepted by a person.",
};

function refusal(reason: string): FactRefusal {
  return { ok: false, reason };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

export function validateFact(fact: ProductFact): { ok: true } | FactRefusal {
  if (!fact || typeof fact.field !== "string" || fact.field.length === 0) return refusal("A fact needs a field.");
  if (fact.origin === "merchant" || fact.origin === "catalogue" || fact.origin === "rule") {
    if (fact.confidence !== null) return refusal("A catalogue, merchant, or rule fact cannot carry a confidence score.");
    if (fact.verified !== false) return refusal("A catalogue, merchant, or rule fact is not an independent verification.");
  } else if (fact.origin === "detected") {
    if (typeof fact.confidence !== "number" || !Number.isFinite(fact.confidence) || fact.confidence < 0 || fact.confidence > 1) {
      return refusal("A detected fact needs a confidence between 0 and 1.");
    }
    if (fact.verified !== false) return refusal("A detected fact cannot verify itself.");
  } else if (fact.origin === "human-verified") {
    if (fact.verified !== true) return refusal("A human-verified fact must record the acceptance.");
    if (fact.confidence !== null) return refusal("Acceptance is not a confidence score.");
    if (fact.source.kind !== "human" || fact.source.acceptedBy.trim().length === 0 || !Number.isFinite(fact.source.acceptedAt)) {
      return refusal("Human verification needs the person and the time of acceptance.");
    }
  } else {
    return refusal("The fact origin is not recognised.");
  }
  if (fact.origin !== "human-verified" && fact.source.kind === "human") return refusal("Only an accepted fact can use a human source.");
  if (fact.origin === "detected" && fact.source.kind !== "detected") return refusal("A detected fact cannot be labelled as catalogue or merchant data.");
  if ((fact.origin === "catalogue" || fact.origin === "merchant" || fact.origin === "rule") && fact.source.kind !== fact.origin) {
    return refusal("The fact source does not match its origin.");
  }
  return { ok: true };
}

/** Build a fact. Human acceptance is not a boolean on this call. */
export function factFrom(draft: FactDraft): { ok: true; fact: ProductFact } | FactRefusal {
  const fact: ProductFact = {
    field: draft.field,
    value: draft.value,
    origin: draft.origin,
    confidence: draft.confidence,
    verified: draft.verified,
    source: draft.source,
  };
  const checked = validateFact(fact);
  if (!checked.ok) return checked;
  return { ok: true, fact };
}

/** A person accepts or corrects a fact. The previous fact is not mutated, and a detected fact cannot flip its own verified flag. */
export function acceptFact(fact: ProductFact, acceptance: { by: string; at: number }): { ok: true; fact: ProductFact } | FactRefusal {
  const checked = validateFact(fact);
  if (!checked.ok) return checked;
  const by = acceptance.by.trim();
  if (by.length === 0 || !Number.isFinite(acceptance.at)) return refusal("Name the person and the time of the correction.");
  const priorOrigin = fact.origin === "human-verified" ? fact.source.kind === "human" ? fact.source.priorOrigin : null : fact.origin;
  if (priorOrigin === null) return refusal("The earlier origin of this fact is missing.");
  const accepted: ProductFact = {
    field: fact.field,
    value: fact.value,
    origin: "human-verified",
    confidence: null,
    verified: true,
    source: { kind: "human", field: fact.field, acceptedBy: by, acceptedAt: acceptance.at, priorOrigin },
  };
  return { ok: true, fact: accepted };
}

function knownFact(draft: FactDraft): ProductFact {
  const made = factFrom(draft);
  if (!made.ok) throw new Error(made.reason);
  return made.fact;
}

function recordOrigin(custom: boolean): "merchant" | "catalogue" {
  return custom ? "merchant" : "catalogue";
}

function parseRead(input: CatalogueReadInput): CatalogueReadInput | FactRefusal {
  if (!isPlainObject(input)) return refusal("The product facts request was refused.");
  for (const key of Object.keys(input)) {
    if (!READ_KEYS.includes(key as (typeof READ_KEYS)[number])) return refusal("The product facts request contained something other than product metadata.");
  }
  if (typeof input.productId !== "string" || input.productId.length === 0) return refusal("The product facts request was refused.");
  if (typeof input.name !== "string" || input.name.length === 0) return refusal("The product facts request was refused.");
  if (!CATEGORIES.includes(input.category)) return refusal("The product facts request was refused.");
  if (typeof input.custom !== "boolean") return refusal("The product facts request was refused.");
  if (input.fabric != null && typeof input.fabric !== "string") return refusal("The product facts request was refused.");
  if (typeof input.photograph !== "boolean") return refusal("The product facts request was refused.");
  if (input.swatchName != null && typeof input.swatchName !== "string") return refusal("The product facts request was refused.");
  if (typeof input.sizeCount !== "number" || !Number.isInteger(input.sizeCount) || input.sizeCount < 0) return refusal("The product facts request was refused.");
  return {
    productId: input.productId,
    name: input.name,
    category: input.category,
    custom: input.custom,
    fabric: input.fabric,
    photograph: input.photograph,
    swatchName: input.swatchName,
    sizeCount: input.sizeCount,
  };
}

function cutForCategory(category: Category): ProductFact["value"] {
  const probe: Product = {
    id: "rule-probe",
    name: "rule-probe",
    category,
    blurb: "",
    image: null,
    priceZar: 0,
    sizes: [],
    swatches: [],
    nail: "almond",
  };
  return conditionProduct(probe, null).cut;
}

function unknown(field: string): ProductFact {
  return knownFact({
    field,
    value: null,
    origin: "rule",
    confidence: null,
    verified: false,
    source: { kind: "rule", id: "unsupported-attribute" },
  });
}

export type ProductReader = {
  id: string;
  read(input: CatalogueReadInput): { ok: true; facts: ProductFact[] } | FactRefusal;
};

export const disabledReader: ProductReader = {
  id: "isibuko.facts-disabled",
  read(input) {
    const parsed = parseRead(input);
    if ("reason" in parsed) return parsed;
    return { ok: true, facts: [] };
  },
};

export const catalogueReader: ProductReader = {
  id: "isibuko.catalogue-facts",
  read(input) {
    const parsed = parseRead(input);
    if ("reason" in parsed) return parsed;
    const origin = recordOrigin(parsed.custom);
    const fabric = parsed.fabric?.trim() ? parsed.fabric.trim() : null;
    const colour = parsed.swatchName?.trim() ? parsed.swatchName.trim() : null;
    const facts = [
      knownFact({ field: "category", value: parsed.category, origin, confidence: null, verified: false, source: { kind: origin, field: "category" } }),
      knownFact({ field: "name", value: parsed.name, origin, confidence: null, verified: false, source: { kind: origin, field: "name" } }),
      fabric
        ? knownFact({ field: "fabric", value: fabric, origin, confidence: null, verified: false, source: { kind: origin, field: "fabric" } })
        : unknown("fabric"),
      colour
        ? knownFact({ field: "colour", value: colour, origin, confidence: null, verified: false, source: { kind: origin, field: "colour" } })
        : unknown("colour"),
      knownFact({ field: "photograph", value: parsed.photograph, origin, confidence: null, verified: false, source: { kind: origin, field: "photograph" } }),
      parsed.sizeCount > 0
        ? knownFact({ field: "sizeChart", value: "template-chart", origin, confidence: null, verified: false, source: { kind: origin, field: "sizeChart" } })
        : unknown("sizeChart"),
      knownFact({ field: "cut", value: cutForCategory(parsed.category), origin: "rule", confidence: null, verified: false, source: { kind: "rule", id: "condition.cut" } }),
      knownFact({ field: "extractedMeasurements", value: null, origin: "rule", confidence: null, verified: false, source: { kind: "rule", id: "template-not-measured" } }),
      unknown("pattern"),
      unknown("logo"),
      unknown("texture"),
      unknown("sleeveLength"),
    ];
    return { ok: true, facts };
  },
};

export function selectReader(id?: string | null): ProductReader {
  if (id === catalogueReader.id) return catalogueReader;
  return disabledReader;
}

export const defaultReader = disabledReader;

export function factText(fact: ProductFact): string {
  if (fact.value === null) return "Unknown";
  if (fact.field === "sizeChart" && fact.value === "template-chart") return "Template chart, not a measurement from the photograph";
  if (fact.field === "photograph") return fact.value === true ? "Present" : "None";
  return String(fact.value);
}
