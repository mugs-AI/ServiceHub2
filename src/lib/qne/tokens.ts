// Client-side JWT storage helpers for the N3 Open API access token.
// The token is persisted in localStorage under `qne_access_token` so it
// survives page reloads, dev server restarts, and full rebuilds.

export const QNE_TOKEN_KEY = "qne_access_token";

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(QNE_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(QNE_TOKEN_KEY, token);
  } catch {
    /* ignore */
  }
}

export function clearStoredToken(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(QNE_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Read `?token=<jwt>` from the URL on startup (Path A launch from
 * N3 "My Apps"). If present, persist it and strip it from the address
 * bar so the JWT doesn't leak via referrer/back-button/screenshots.
 */
export function consumeTokenFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  if (!token) return null;
  setStoredToken(token);
  try {
    window.history.replaceState({}, "", window.location.pathname);
  } catch {
    /* ignore */
  }
  return token;
}
