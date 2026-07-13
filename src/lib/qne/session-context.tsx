import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { qneGet, UnauthorizedError } from "@/lib/qne/client";
import { decodeJwtPayload } from "@/lib/qne/jwt";
import { normalizeBasicInfo } from "@/lib/qne/session/basic-info";
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

export type CurrentUserReason =
  | "matched_administrators_role"
  | "matched_without_administrators_role"
  | "role_data_missing"
  | "no_matching_user"
  | "users_endpoint_failed"
  | "users_endpoint_unauthorized"
  | "users_endpoint_forbidden"
  | "basicinfo_user_identifier_missing"
  | "allowlist_fallback"
  | "bootstrap_fallback";

export interface CurrentUserDiagnostics {
  basicInfoUserIdentifier: string | null;
  matchedN3UserId: string | null;
  matchedDisplayName: string | null;
  reason: CurrentUserReason;
  usersEndpoint: {
    status: "ok" | "failed" | "unauthorized" | "forbidden";
    httpStatus: number | null;
    shape: string;
    count: number;
    error: string | null;
  };
}

export interface CurrentUserInfo {
  tenantCode: string;
  companyName: string;
  email: string;
  displayName: string;
  userCode: string | null;
  roleNames: string[];
  isAdministrator: boolean;
  adminGate: "n3_role" | "allowlist" | "bootstrap" | "none";
  diagnostics: CurrentUserDiagnostics | null;
}

interface SessionContextValue {
  ready: boolean;
  token: string | null;
  session: SessionInfo | null;
  currentUser: CurrentUserInfo | null;
  currentUserReady: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  applyToken: (token: string, session?: Partial<SessionInfo>) => Promise<void>;
  signOut: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

function normaliseBasicInfo(raw: unknown, token: string | null): SessionInfo {
  const r = (raw ?? {}) as Record<string, unknown>;
  const pick = (...keys: string[]): string => {
    for (const k of keys) {
      const v = r[k];
      if (typeof v === "string" && v.trim()) return v;
    }
    return "";
  };
  const claims = decodeJwtPayload(token);
  const claim = (k: keyof typeof claims): string => {
    const v = claims[k];
    return typeof v === "string" ? v.trim() : "";
  };
  return {
    companyName:
      pick("companyName", "company", "name", "companyDisplayName") ||
      (typeof claims.company === "string" ? (claims.company as string).trim() : ""),
    tenantCode:
      pick("tenantCode", "tenant", "tenantId", "code") || claim("tenantCode"),
    email:
      pick("email", "userEmail", "loginEmail", "userName") || claim("email"),
  };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [currentUser, setCurrentUser] = useState<CurrentUserInfo | null>(null);
  const [currentUserReady, setCurrentUserReady] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCurrentUser = useCallback(async (tok: string) => {
    setCurrentUserReady(false);
    try {
      const res = await fetch("/api/session/me", {
        headers: { Authorization: `Bearer ${tok}` },
      });
      if (res.ok) {
        setCurrentUser((await res.json()) as CurrentUserInfo);
      } else {
        setCurrentUser(null);
      }
    } catch {
      setCurrentUser(null);
    } finally {
      setCurrentUserReady(true);
    }
  }, []);

  const loadSession = useCallback(async () => {
    setError(null);
    const activeToken = getStoredToken();
    try {
      const raw = await qneGet<unknown>("main", "/api/companyprofile/BasicInfo");
      setSession(normaliseBasicInfo(raw, activeToken));
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        setToken(null);
        setSession(null);
        setCurrentUser(null);
        setCurrentUserReady(true);
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      // Even if BasicInfo failed, we can still derive display fields from JWT.
      setSession(normaliseBasicInfo({}, activeToken));
    }
    if (activeToken) await loadCurrentUser(activeToken);
  }, [loadCurrentUser]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const fromUrl = consumeTokenFromUrl();
      const stored = fromUrl ?? getStoredToken();
      if (stored) {
        setToken(stored);
        await loadSession();
      } else {
        setCurrentUserReady(true);
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadSession]);

  useEffect(() => {
    const onUnauthorized = () => {
      setToken(null);
      setSession(null);
      setCurrentUser(null);
      setCurrentUserReady(true);
    };
    window.addEventListener("qne:unauthorized", onUnauthorized);
    return () => window.removeEventListener("qne:unauthorized", onUnauthorized);
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      ready,
      token,
      session,
      currentUser,
      currentUserReady,
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
        await loadSession();
      },
      signOut: () => {
        clearStoredToken();
        setToken(null);
        setSession(null);
        setCurrentUser(null);
        setCurrentUserReady(true);
      },
    }),
    [ready, token, session, currentUser, currentUserReady, error, loadSession],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside <SessionProvider>");
  return ctx;
}
