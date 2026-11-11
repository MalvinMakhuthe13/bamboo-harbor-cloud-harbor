/** Interpret the Python inference service. A refusal is never a generated image. */

export type InferBody = {
  ok: boolean;
  generated: boolean;
  code: string;
  image: string | null;
  modelId: string;
  weightsPresent: boolean;
};

export type RenderRoute = {
  mode: "generative" | "composite" | "refused";
  generated: boolean;
  code: string;
};

export function interpretInferResponse(body: InferBody): { useAsGenerated: boolean; code: string } {
  const useAsGenerated = body.ok === true && body.generated === true && body.weightsPresent === true && typeof body.image === "string" && body.image.length > 0;
  return { useAsGenerated, code: useAsGenerated ? "GENERATED" : body.code || "INFERENCE_FAILED" };
}

/** Generative mode must not fall through to the photographic composite and keep the generative label. */
export function routeRender(want: "composite" | "generative", service: InferBody | null): RenderRoute {
  if (want === "composite") return { mode: "composite", generated: false, code: "COMPOSITE" };
  if (!service) return { mode: "refused", generated: false, code: "SERVICE_UNREACHABLE" };
  const interpreted = interpretInferResponse(service);
  if (!interpreted.useAsGenerated) return { mode: "refused", generated: false, code: interpreted.code };
  return { mode: "generative", generated: true, code: "GENERATED" };
}
