import { matchSize } from "./fit.ts";
import type { Category, SizeRow } from "./types.ts";

/** Future capabilities. Only fit is implemented, and only on the device. */
export const AI_CAPABILITIES = ["attributes", "fit", "recommend", "generate"] as const;
export type AiCapability = (typeof AI_CAPABILITIES)[number];

export type MeasurementKey =
  | "chestCm"
  | "waistCm"
  | "shoulderCm"
  | "headCircCm"
  | "wristCm"
  | "fingerCm"
  | "faceWidthCm"
  | "hipCm";

export type FitMeasurements = Partial<Record<MeasurementKey, number | null>>;

/**
 * Required measurements taken from the house catalogue charts.
 * Categories with an empty list have no chart. Nothing is invented for them.
 */
export const CATEGORY_REQUIRED: Record<Category, readonly MeasurementKey[]> = {
  shirt: ["chestCm", "waistCm", "shoulderCm"],
  jacket: ["chestCm", "waistCm", "shoulderCm"],
  dress: ["chestCm", "waistCm", "shoulderCm"],
  pants: ["waistCm", "hipCm"],
  skirt: [],
  wig: ["headCircCm"],
  hat: ["headCircCm"],
  glasses: ["faceWidthCm"],
  earrings: [],
  necklace: [],
  watch: ["wristCm"],
  bracelet: [],
  ring: ["fingerCm"],
  nails: [],
};

const RANGE_KEY: Record<string, MeasurementKey> = {
  chest: "chestCm",
  waist: "waistCm",
  shoulder: "shoulderCm",
  head: "headCircCm",
  wrist: "wristCm",
  finger: "fingerCm",
  face: "faceWidthCm",
  hip: "hipCm",
};

const MEASUREMENT_LABEL: Record<MeasurementKey, string> = {
  chestCm: "chest",
  waistCm: "waist",
  shoulderCm: "shoulder",
  headCircCm: "head",
  wristCm: "wrist",
  fingerCm: "finger",
  faceWidthCm: "face width",
  hipCm: "hip",
};

export type FitRequest = {
  productId: string;
  category: Category;
  sizes: SizeRow[];
  measurements: FitMeasurements;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type FitAdvice = {
  ok: true;
  capability: "fit";
  source: "local-measurements";
  providerId: string;
  productId: string;
  size: string;
  warning: string | null;
  detail: string;
  explanation: string;
};

export type AdvisorRefusal = {
  ok: false;
  capability: AiCapability;
  source: "disabled" | "refused";
  providerId: string;
  code: "DISABLED" | "MISSING_MEASUREMENTS" | "TIMEOUT" | "ABORTED" | "NOT_AVAILABLE" | "UNEXPECTED_INPUT";
  reason: string;
};

export type AiProvider = {
  id: string;
  runsOnDevice: boolean;
  capabilities: readonly AiCapability[];
  adviseFit(input: FitRequest): FitAdvice | AdvisorRefusal | Promise<FitAdvice | AdvisorRefusal>;
};

const DEFAULT_TIMEOUT_MS = 1500;
const MEASUREMENT_KEYS = Object.keys(MEASUREMENT_LABEL) as MeasurementKey[];
const REQUEST_KEYS = ["productId", "category", "sizes", "measurements", "signal", "timeoutMs"] as const;
const SIZE_KEYS = ["label", "chest", "waist", "shoulder", "head", "wrist", "finger", "face", "hip"] as const;
const CATEGORIES = Object.keys(CATEGORY_REQUIRED) as Category[];

function refusal(
  providerId: string,
  capability: AiCapability,
  code: AdvisorRefusal["code"],
  reason: string,
): AdvisorRefusal {
  return {
    ok: false,
    capability,
    source: code === "DISABLED" ? "disabled" : "refused",
    providerId,
    code,
    reason,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function chartMeasurementKeys(sizes: readonly SizeRow[]): MeasurementKey[] {
  const found = new Set<MeasurementKey>();
  for (const row of sizes) {
    for (const [rangeName, measurement] of Object.entries(RANGE_KEY)) {
      if (row[rangeName as keyof SizeRow] != null) found.add(measurement);
    }
  }
  return MEASUREMENT_KEYS.filter((key) => found.has(key));
}

export function requiredMeasurements(category: Category, sizes: readonly SizeRow[]): MeasurementKey[] {
  const required = new Set<MeasurementKey>(CATEGORY_REQUIRED[category]);
  for (const key of chartMeasurementKeys(sizes)) required.add(key);
  return MEASUREMENT_KEYS.filter((key) => required.has(key));
}

type ParsedRequest = {
  productId: string;
  category: Category;
  sizes: SizeRow[];
  measurements: FitMeasurements;
};

function unexpected(providerId: string): AdvisorRefusal {
  return refusal(
    providerId,
    "fit",
    "UNEXPECTED_INPUT",
    "The fit request contained something other than product measurements. It was refused.",
  );
}

function parseRequest(providerId: string, input: FitRequest): ParsedRequest | AdvisorRefusal {
  if (!isPlainObject(input)) return unexpected(providerId);
  for (const key of Object.keys(input)) {
    if (!REQUEST_KEYS.includes(key as (typeof REQUEST_KEYS)[number])) return unexpected(providerId);
  }
  if (typeof input.productId !== "string" || input.productId.length === 0) return unexpected(providerId);
  if (!CATEGORIES.includes(input.category)) return unexpected(providerId);
  if (input.timeoutMs != null && typeof input.timeoutMs !== "number") return unexpected(providerId);
  if (input.signal != null && !(input.signal instanceof AbortSignal)) return unexpected(providerId);
  if (!isPlainObject(input.measurements)) return unexpected(providerId);
  for (const key of Object.keys(input.measurements)) {
    if (!MEASUREMENT_KEYS.includes(key as MeasurementKey)) return unexpected(providerId);
    const value = input.measurements[key as MeasurementKey];
    if (value != null && finiteNumber(value) === null) return unexpected(providerId);
  }
  if (!Array.isArray(input.sizes)) return unexpected(providerId);

  const sizes: SizeRow[] = [];
  for (const row of input.sizes) {
    if (!isPlainObject(row)) return unexpected(providerId);
    for (const key of Object.keys(row)) {
      if (!SIZE_KEYS.includes(key as (typeof SIZE_KEYS)[number])) return unexpected(providerId);
    }
    if (typeof row.label !== "string" || row.label.length === 0) return unexpected(providerId);
    const record = row as Record<string, unknown>;
    const clean: SizeRow = { label: row.label };
    for (const rangeName of Object.keys(RANGE_KEY)) {
      const range = record[rangeName];
      if (range == null) continue;
      if (!Array.isArray(range) || range.length !== 2 || finiteNumber(range[0]) === null || finiteNumber(range[1]) === null) {
        return unexpected(providerId);
      }
      (clean as unknown as Record<string, [number, number]>)[rangeName] = [range[0], range[1]];
    }
    sizes.push(clean);
  }

  const measurements: FitMeasurements = {};
  for (const key of MEASUREMENT_KEYS) {
    const value = finiteNumber(input.measurements[key]);
    if (value !== null) measurements[key] = value;
  }
  return { productId: input.productId, category: input.category, sizes, measurements };
}

function missingMeasurements(providerId: string, category: Category, sizes: readonly SizeRow[], measurements: FitMeasurements): AdvisorRefusal | null {
  const required = requiredMeasurements(category, sizes);
  if (required.length === 0) {
    return refusal(
      providerId,
      "fit",
      "MISSING_MEASUREMENTS",
      "This product has no size chart, so no size was suggested.",
    );
  }
  const missing = required.filter((key) => finiteNumber(measurements[key]) === null);
  if (missing.length === 0) return null;
  const names = missing.map((key) => MEASUREMENT_LABEL[key]).join(", ");
  return refusal(
    providerId,
    "fit",
    "MISSING_MEASUREMENTS",
    `Fit help needs ${names}. The missing measurement was not guessed.`,
  );
}

function adviseFromChart(providerId: string, parsed: ParsedRequest): FitAdvice | AdvisorRefusal {
  const missing = missingMeasurements(providerId, parsed.category, parsed.sizes, parsed.measurements);
  if (missing) return missing;
  const fit = matchSize(parsed.sizes, parsed.measurements);
  if (!fit) {
    return refusal(
      providerId,
      "fit",
      "MISSING_MEASUREMENTS",
      "The size chart has no range that these measurements can be compared with.",
    );
  }
  const compared = requiredMeasurements(parsed.category, parsed.sizes).map((key) => MEASUREMENT_LABEL[key]).join(", ");
  return {
    ok: true,
    capability: "fit",
    source: "local-measurements",
    providerId,
    productId: parsed.productId,
    size: fit.size,
    warning: fit.warning,
    detail: fit.detail,
    explanation: `Compared ${compared}, already on this device, with the product size chart. No image left the device.`,
  };
}

export const disabledProvider: AiProvider = {
  id: "isibuko.disabled",
  runsOnDevice: true,
  capabilities: [],
  adviseFit() {
    return refusal(
      disabledProvider.id,
      "fit",
      "DISABLED",
      "Fit help is off. The mirror is unchanged and nothing was sent.",
    );
  },
};

export const localFitProvider: AiProvider = {
  id: "isibuko.local-fit",
  runsOnDevice: true,
  capabilities: ["fit"],
  adviseFit(input) {
    const parsed = parseRequest(localFitProvider.id, input);
    if ("code" in parsed) return parsed;
    return adviseFromChart(localFitProvider.id, parsed);
  },
};

/** Unknown ids stay on the disabled provider. The mirror never requires a remote model. */
export function selectProvider(id?: string | null): AiProvider {
  if (id === localFitProvider.id) return localFitProvider;
  return disabledProvider;
}

export const defaultProvider = disabledProvider;

export function requestCapability(
  provider: AiProvider,
  capability: AiCapability,
  input: FitRequest,
): Promise<FitAdvice | AdvisorRefusal> {
  if (capability !== "fit") {
    return Promise.resolve(
      refusal(
        provider.id,
        capability,
        "NOT_AVAILABLE",
        `${capability} is not available. The mirror is unchanged and nothing was sent.`,
      ),
    );
  }
  return requestFit(provider, input);
}

export function requestFit(provider: AiProvider, input: FitRequest): Promise<FitAdvice | AdvisorRefusal> {
  const timeoutMs =
    typeof input?.timeoutMs === "number" && Number.isFinite(input.timeoutMs) && input.timeoutMs > 0
      ? input.timeoutMs
      : DEFAULT_TIMEOUT_MS;
  return new Promise((resolve) => {
    let settled = false;
    const linked = new AbortController();
    const stopLinked = () => {
      if (!linked.signal.aborted) linked.abort();
    };
    const finish = (result: FitAdvice | AdvisorRefusal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input?.signal?.removeEventListener("abort", onCallerAbort);
      resolve(result);
    };
    const timer = setTimeout(() => {
      stopLinked();
      finish(refusal(provider.id, "fit", "TIMEOUT", `Fit help did not answer within ${timeoutMs} ms. Nothing was sent.`));
    }, timeoutMs);
    const onCallerAbort = () => {
      stopLinked();
      finish(refusal(provider.id, "fit", "ABORTED", "The fit request was cancelled. Nothing was sent."));
    };
    if (input?.signal?.aborted) {
      stopLinked();
      finish(refusal(provider.id, "fit", "ABORTED", "The fit request was cancelled. Nothing was sent."));
      return;
    }
    input?.signal?.addEventListener("abort", onCallerAbort);

    const parsed = parseRequest(provider.id, input);
    if ("code" in parsed) {
      finish(parsed);
      return;
    }
    if (!provider.capabilities.includes("fit")) {
      finish(
        refusal(
          provider.id,
          "fit",
          provider.id === disabledProvider.id ? "DISABLED" : "NOT_AVAILABLE",
          provider.id === disabledProvider.id
            ? "Fit help is off. The mirror is unchanged and nothing was sent."
            : "This provider cannot give fit help. Nothing was sent.",
        ),
      );
      return;
    }
    const missing = missingMeasurements(provider.id, parsed.category, parsed.sizes, parsed.measurements);
    if (missing) {
      finish(missing);
      return;
    }
    const providerInput: FitRequest = {
      productId: parsed.productId,
      category: parsed.category,
      sizes: parsed.sizes,
      measurements: parsed.measurements,
      signal: linked.signal,
      timeoutMs,
    };
    Promise.resolve()
      .then(() => provider.adviseFit(providerInput))
      .then((result) => finish(result))
      .catch(() => {
        finish(refusal(provider.id, "fit", "NOT_AVAILABLE", "Fit help failed. Nothing was sent."));
      });
  });
}
