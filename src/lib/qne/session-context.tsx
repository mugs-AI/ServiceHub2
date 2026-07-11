import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { qneGet, UnauthorizedError } from "@/lib/qne/client";
import {
  clearStoredToken,
  consumeTokenFromUrl,
  getStoredToken,
  setStoredToken,
} from "@/lib/qne/tokens";

export interface SessionInfo {
  companyName: string;
  tenantCode: string;
  email: string;
}

interface SessionContextValue {
  ready: boolean; // finished the initial token+session bootstrap
  token: string | null;
  session: SessionInfo | null;
  error: string | null;
  refresh: () => Promise<void>;
  applyToken: (token: string, session?: Partial<SessionInfo>) => Promise<void>;
  signOut: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/**
 * The BasicInfo payload uses a few possible field spellings depending on
 * the N3 tenant configuration; normalise them into a single shape.
 */
function normaliseBasicInfo(raw: unknown): SessionInfo {
  const r = (raw ?? {}) as Record<string, unknown>;
  const pick = (...keys: string[]): string => {
    for (const k of keys) {
      const v = r[k];
      if (typeof v === "string" && v.trim()) return v;
    }
    return "";
  };
  return {
    companyName: pick("companyName", "company", "name", "companyDisplayName"),
    tenantCode: pick("tenantCode", "tenant", "tenantId", "code"),
    email: pick("email", "userEmail", "loginEmail", "userName"),
  };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSession = async () => {
    setError(null);
    try {
      const raw = await qneGet<unknown>("main", "/api/companyprofile/BasicInfo");
      setSession(normaliseBasicInfo(raw));
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        setToken(null);
        setSession(null);
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setSession(null);
    }
  };

  // Initial bootstrap: consume ?token=, else use localStorage, else stay unauthenticated.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const fromUrl = consumeTokenFromUrl();
      const stored = fromUrl ?? getStoredToken();
      if (stored) {
        setToken(stored);
        await loadSession();
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Global 401 handler dispatched from the HTTP client.
  useEffect(() => {
    const onUnauthorized = () => {
      setToken(null);
      setSession(null);
    };
    window.addEventListener("qne:unauthorized", onUnauthorized);
    return () => window.removeEventListener("qne:unauthorized", onUnauthorized);
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      ready,
      token,
      session,
      error,
      refresh: loadSession,
      applyToken: async (newToken, hint) => {
        setStoredToken(newToken);
        setToken(newToken);
        if (hint) {
          setSession({
            companyName: hint.companyName ?? "",
            tenantCode: hint.tenantCode ?? "",
            email: hint.email ?? "",
          });
        }
        // Always re-fetch from N3 so the session header is authoritative.
        await loadSession();
      },
      signOut: () => {
        clearStoredToken();
        setToken(null);
        setSession(null);
      },
    }),
    [ready, token, session, error],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside <SessionProvider>");
  return ctx;
}
