// Isomorphic helper to read the JWT payload for DISPLAY ONLY.
// N3 signs the token; we never verify the signature in browser or server.
// The brief permits reading `tenantCode`, `email`, `name` from the payload
// as a fallback when BasicInfo does not expose them.

export interface JwtDisplayClaims {
  tenantCode?: string;
  email?: string;
  name?: string;
  displayName?: string;
  userName?: string;
  [k: string]: unknown;
}

function base64UrlDecode(input: string): string {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  const b64 = (input + pad).replace(/-/g, "+").replace(/_/g, "/");
  if (typeof atob === "function") {
    try {
      // atob returns latin1; decode as UTF-8.
      const bin = atob(b64);
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    } catch {
      return "";
    }
  }
  try {
    // Node / Workers
    return Buffer.from(b64, "base64").toString("utf-8");
  } catch {
    return "";
  }
}

export function decodeJwtPayload(token: string | null | undefined): JwtDisplayClaims {
  if (!token) return {};
  const parts = token.split(".");
  if (parts.length < 2) return {};
  const text = base64UrlDecode(parts[1]);
  if (!text) return {};
  try {
    return JSON.parse(text) as JwtDisplayClaims;
  } catch {
    return {};
  }
}
