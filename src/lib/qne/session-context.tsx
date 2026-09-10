import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { qneGet } from "@/lib/qne/client";
import { decodeJwtPayload } from "@/lib/qne/jwt";
import { normalizeBasicInfo } from "@/lib/qne/session/basic-info";
import {
  classifyBasicInfoError,
  resolveSessionError,
} from "@/lib/qne/session/basic-info-availability";
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
  | "matched_owner"
  | "matched_not_owner"
  | "no_matching_user"
  | "users_endpoint_failed"
  | "users_endpoint_unauthorized"
  | "users_endpoint_forbidden"
  | "identity_missing"
  | "allowlist_fallback"
  | "bootstrap_fallback";

export interface CurrentUserDiagnostics {
  identitySource: "n3_jwt" | "n3_jwt+basicinfo" | "unknown";
  identityUserIdentifier: string | null;
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
  isOwner: boolean;
  adminGate: "n3_owner" | "allowlist" | "bootstrap" | "none";
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
  const n = normalizeBasicInfo(raw);
  const claims = decodeJwtPayload(token);
  const claim = (k: keyof typeof claims): string => {
    const v = claims[k];
    return typeof v === "string" ? v.trim() : "";
  };
  return {
    companyName:
      n.companyName ||
      (typeof claims.company === "string" ? (claims.company as string).trim() : ""),
    tenantCode: n.tenantCode || claim("tenantCode"),
    // Header displays whichever official identifier BasicInfo surfaced —
    // same value the server-side matcher receives.
    email: n.email || n.userName || claim("email"),
  };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [currentUser, setCurrentUser] = useState<CurrentUserInfo | null>(null);
  const [currentUserReady, setCurrentUserReady] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCurrentUser = useCallback(async (tok: string): Promise<CurrentUserInfo | null> => {
    setCurrentUserReady(false);
    try {
      const res = await fetch("/api/session/me", {
        headers: { Authorization: `Bearer ${tok}` },
      });
      if (res.ok) {
        const user = (await res.json()) as CurrentUserInfo;
        setCurrentUser(user);
        return user;
      }
      setCurrentUser(null);
      return null;
    } catch {
      setCurrentUser(null);
      return null;
    } finally {
      setCurrentUserReady(true);
    }
  }, []);

  const loadSession = useCallback(async () => {
    setError(null);
    const next = await runSessionLoad<SessionInfo, CurrentUserInfo>({
      getToken: getStoredToken,
      fetchBasicInfo: () => qneGet<unknown>("main", "/api/companyprofile/BasicInfo"),
      fetchCurrentUser: loadCurrentUser,
      buildSession: normaliseBasicInfo,
      readJwtTenantCode: (tok) => {
        const claims = decodeJwtPayload(tok);
        return typeof claims.tenantCode === "string" ? claims.tenantCode.trim() : null;
      },
      readUserTenantCode: (user) => user.tenantCode ?? null,
    });
    if (!next.tokenValid) {
      setToken(null);
      setSession(null);
      setCurrentUser(null);
      setCurrentUserReady(true);
      setError(null);
      return;
    }
    setSession(next.session);
    setCurrentUserReady(true);
    setError(next.error);
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
