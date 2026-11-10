/**
 * What the mirror is allowed to do with a frame or a merchant URL.
 * Camera frames are not fetched or posted by this module.
 */

export const FRAME_POLICY = {
  leavesDevice: false,
  consent: "explicit-getUserMedia",
  externalInference: false,
  productSwitchRestartsCamera: false,
} as const;

const PRIVATE_HOST = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|metadata\.google\.internal)$/i;

function isPrivateIpv6(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (!bare.includes(":")) return false;
  if (bare === "::1" || bare === "::") return true;
  return bare.startsWith("fe80:") || bare.startsWith("fc") || bare.startsWith("fd");
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;
  return false;
}

/** A merchant link the shopper may open. Isibuko does not fetch it. */
export function publicHttpUrl(raw: string): { ok: true; url: string } | { ok: false; reason: string } {
  const text = raw.trim();
  if (!text) return { ok: false, reason: "The merchant link is empty." };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, reason: "The merchant link is not a URL." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: "The merchant link must be http or https." };
  }
  if (url.username || url.password) return { ok: false, reason: "The merchant link must not carry a password." };
  const host = url.hostname.replace(/\.$/, "");
  if (host.startsWith("127.") || /^\d+$/.test(host) || PRIVATE_HOST.test(host) || isPrivateIpv4(host) || isPrivateIpv6(host) || host.endsWith(".local") || host.endsWith(".internal")) {
    return { ok: false, reason: "The merchant link must be a public site, not this machine or a private network." };
  }
  return { ok: true, url: url.toString() };
}

export function assertProductImage(file: { type: string; size: number }): { ok: true } | { ok: false; reason: string } {
  const type = file.type.toLowerCase();
  if (type !== "image/jpeg" && type !== "image/png" && type !== "image/webp") {
    return { ok: false, reason: "Use a JPEG, PNG, or WebP photograph. SVG files are refused." };
  }
  if (file.size <= 0) return { ok: false, reason: "The photograph is empty." };
  if (file.size > 1_500_000) return { ok: false, reason: "Use a photograph under 1.5 MB. It stays in this browser." };
  return { ok: true };
}

/** Magic bytes only. The browser-reported MIME type is not trusted. */
export function imageMagic(bytes: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}
