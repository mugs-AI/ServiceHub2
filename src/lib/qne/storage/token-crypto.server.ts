// WP2A — authenticated encryption at rest for Google OAuth token material.
//
// Uses platform Web Crypto (available in the Worker runtime) with AES-256-GCM.
// Ciphertext is versioned: "v1.<iv-b64url>.<ciphertext+tag-b64url>".
// The key is server-only and never leaves this module. Plaintext token
// material is never logged, returned to the browser or persisted.

const VERSION = "v1";

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(text: string): Uint8Array {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export class EncryptionKeyMissingError extends Error {
  constructor() {
    super(
      "GOOGLE_DRIVE_TOKEN_ENC_KEY is not configured. An administrator must add a base64 32-byte server-only key.",
    );
    this.name = "EncryptionKeyMissingError";
  }
}

export function tokenEncryptionConfigured(): boolean {
  return Boolean((process.env["GOOGLE_DRIVE_TOKEN_ENC_KEY"] ?? "").trim());
}

async function importKey(): Promise<CryptoKey> {
  const raw = (process.env["GOOGLE_DRIVE_TOKEN_ENC_KEY"] ?? "").trim();
  if (!raw) throw new EncryptionKeyMissingError();
  let bytes: Uint8Array;
  try {
    bytes = b64urlDecode(raw);
  } catch {
    throw new Error("GOOGLE_DRIVE_TOKEN_ENC_KEY is not valid base64.");
  }
  if (bytes.length !== 32) {
    throw new Error("GOOGLE_DRIVE_TOKEN_ENC_KEY must decode to exactly 32 bytes.");
  }
  return crypto.subtle.importKey("raw", bytes as unknown as ArrayBuffer, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptSecret(plaintext: string): Promise<string> {
  const key = await importKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(plaintext) as unknown as ArrayBuffer,
    ),
  );
  return `${VERSION}.${b64urlEncode(iv)}.${b64urlEncode(ct)}`;
}

export async function decryptSecret(stored: string | null | undefined): Promise<string | null> {
  if (!stored) return null;
  const parts = stored.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) {
    throw new Error("Stored credential uses an unsupported ciphertext version.");
  }
  const key = await importKey();
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64urlDecode(parts[1]) as unknown as ArrayBuffer },
    key,
    b64urlDecode(parts[2]) as unknown as ArrayBuffer,
  );
  return new TextDecoder().decode(plain);
}

/** SHA-256 hex — used so raw OAuth state values are never stored. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value) as unknown as ArrayBuffer,
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function randomUrlSafeToken(byteLength = 32): string {
  return b64urlEncode(crypto.getRandomValues(new Uint8Array(byteLength)));
}
