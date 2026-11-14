/**
 * Plug point for a later checkpoint.
 * The live mirror does not call this. The geometric composite stays on.
 * No weights are loaded here.
 */
export const TRAINED_ARTIFACTS = {
  enabled: false,
  fallback: "geometric-composite",
} as const;

export type RendererChoice = "geometric-composite" | "trained-checkpoint";

function artifactsEnabled(): boolean {
  return TRAINED_ARTIFACTS.enabled;
}

export function resolveRenderer(request?: { allowTrained?: boolean; checkpointId?: string | null }): RendererChoice {
  if (!artifactsEnabled()) return "geometric-composite";
  if (request?.allowTrained === true && request.checkpointId) return "trained-checkpoint";
  return "geometric-composite";
}
