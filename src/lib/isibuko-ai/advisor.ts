import { matchSize } from "./fit.ts";
import type { SizeRow } from "./types.ts";

/** Future capabilities. Only fit is implemented, and only on the device. */
export const AI_CAPABILITIES = ["attributes", "fit", "recommend", "generate"] as const;
export type AiCapability = (typeof AI_CAPABILITIES)[number];

export type FitMeasurements = {
  chestCm?: number | null;
  waistCm?: number | null;
  shoulderCm?: number | null;
  headCircCm?: number | null;
  wristCm?: number | null;
  fingerCm?: number | null;
  faceWidthCm?: number | null;
  hipCm?: number | null;
};

export type FitRequest = {
  productId: string;
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
  code: "DISABLED" | "MISSING_MEASUREMENTS" | "TIMEOUT" | "ABORTED" | "NOT_AVAILABLE" | "FRAMES_REFUSED";
  reason: string;
};

export type AiProvider = {
  id: string;
  runsOnDevice: boolean;
  capabilities: readonly AiCapability[];
  adviseFit(input: FitRequest): FitAdvice | AdvisorRefusal | Promise<FitAdvice | AdvisorRefusal>;
};

const DEFAULT_TIMEOUT_MS = 1500;
const MEASUREMENT_KEYS = [
  "chestCm",
  "waistCm",
  "shoulderCm",
  "headCircCm",
  "wristCm",
  "fingerCm",
  "faceWidthCm",
  "hipCm",
] as const;
const BLOCKED_KEYS = ["image", "frame", "frames", "landmarks", "faceLandmarks", "pixels", "video", "canvas", "photo"] as const;

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

function hasBlockedPayload(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return BLOCKED_KEYS.some((key) => record[key] != null);
}

function onlyMeasurements(measurements: FitMeasurements): FitMeasurements {
  const picked: FitMeasurements = {};
  const record = measurements as FitMeasurements & Record<string, unknown>;
  for (const key of MEASUREMENT_KEYS) {
    const value = record[key];
    if (typeof value === "number" || value === null) picked[key] = value;
  }
  return picked;
}

function hasMeasurement(measurements: FitMeasurements): boolean {
  return MEASUREMENT_KEYS.some((key) => {
    const value = measurements[key];
    return typeof value === "number" && Number.isFinite(value);
  });
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
    if (hasBlockedPayload(input) || hasBlockedPayload(input.measurements)) {
      return refusal(
        localFitProvider.id,
        "fit",
        "FRAMES_REFUSED",
        "Camera frames and facial landmarks are not accepted.",
      );
    }
    const measurements = onlyMeasurements(input.measurements ?? {});
    if (!hasMeasurement(measurements)) {
      return refusal(
        localFitProvider.id,
        "fit",
        "MISSING_MEASUREMENTS",
        "There is no on-device measurement for this product yet.",
      );
    }
    const fit = matchSize(input.sizes, measurements);
    if (!fit) {
      return refusal(
        localFitProvider.id,
        "fit",
        "MISSING_MEASUREMENTS",
        "The size chart has no range that these measurements can be compared with.",
      );
    }
    return {
      ok: true,
      capability: "fit",
      source: "local-measurements",
      providerId: localFitProvider.id,
      productId: input.productId,
      size: fit.size,
      warning: fit.warning,
      detail: fit.detail,
      explanation: "Compared measurements already on this device with the product size chart. No image left the device.",
    };
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
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: FitAdvice | AdvisorRefusal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", onAbort);
      resolve(result);
    };
    const timer = setTimeout(() => {
      finish(
        refusal(provider.id, "fit", "TIMEOUT", `Fit help did not answer within ${timeoutMs} ms. Nothing was sent.`),
      );
    }, timeoutMs);
    const onAbort = () => {
      finish(refusal(provider.id, "fit", "ABORTED", "The fit request was cancelled. Nothing was sent."));
    };
    if (input.signal?.aborted) {
      finish(refusal(provider.id, "fit", "ABORTED", "The fit request was cancelled. Nothing was sent."));
      return;
    }
    input.signal?.addEventListener("abort", onAbort);
    if (hasBlockedPayload(input) || hasBlockedPayload(input.measurements)) {
      finish(
        refusal(provider.id, "fit", "FRAMES_REFUSED", "Camera frames and facial landmarks are not accepted."),
      );
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
    Promise.resolve()
      .then(() => provider.adviseFit(input))
      .then((result) => finish(result))
      .catch(() => {
        finish(refusal(provider.id, "fit", "NOT_AVAILABLE", "Fit help failed. Nothing was sent."));
      });
  });
}
