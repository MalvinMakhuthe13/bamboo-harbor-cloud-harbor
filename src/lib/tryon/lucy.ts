import { createServerFn } from "@tanstack/react-start";

const TOKEN_URL = "https://api.decart.ai/v1/client/tokens";

export type LucyToken =
  | { ok: true; token: string; expiresAt: string }
  | { ok: false; error: string };

/** Short-lived client token. The permanent key never leaves the server. */
export const mintLucyToken = createServerFn({ method: "POST" }).handler(async (): Promise<LucyToken> => {
  const apiKey = process.env.DECART_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      error: "Live try-on needs a Decart key on the server. The photograph path still works.",
    };
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": apiKey,
    },
    body: JSON.stringify({
      expiresIn: 120,
      allowedModels: ["lucy-vton-latest", "lucy-vton-3.6"],
      constraints: { realtime: { maxSessionDuration: 180 } },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    return { ok: false, error: `Decart did not issue a live token (${res.status}).` };
  }
  const body = (await res.json()) as { apiKey?: string; expiresAt?: string };
  if (!body.apiKey) return { ok: false, error: "Decart returned an empty token." };
  return { ok: true, token: body.apiKey, expiresAt: body.expiresAt ?? "" };
});
