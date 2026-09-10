// Pure state-transition core for the SessionProvider load cycle.
//
// Extracted so the 401 / 403 / failure transitions can be asserted directly as
// state transitions (token, session, currentUser, error) without a DOM.

import { classifyBasicInfoError, resolveSessionError } from "./basic-info-availability";

export interface SessionLoadDeps<TSession, TUser> {
  /** Stored N3 bearer token, if any. */
  getToken: () => string | null;
  /** Browser GET /api/companyprofile/BasicInfo. */
  fetchBasicInfo: () => Promise<unknown>;
  /** Server GET /api/session/me; null when it did not resolve a user. */
  fetchCurrentUser: (token: string) => Promise<TUser | null>;
  /** Builds the display session from BasicInfo (possibly empty) + token. */
  buildSession: (raw: unknown, token: string | null) => TSession;
  /** tenantCode claim carried by the JWT, if any. */
  readJwtTenantCode: (token: string | null) => string | null;
  /** tenantCode the server resolved for the current user, if any. */
  readUserTenantCode: (user: TUser) => string | null;
}

export interface SessionLoadState<TSession, TUser> {
  /** false => token cleared, secure N3 relaunch required. */
  tokenValid: boolean;
  session: TSession | null;
  currentUser: TUser | null;
  currentUserReady: boolean;
  error: string | null;
}

export async function runSessionLoad<TSession, TUser>(
  deps: SessionLoadDeps<TSession, TUser>,
): Promise<SessionLoadState<TSession, TUser>> {
  const activeToken = deps.getToken();
  let outcome = { kind: "ok" } as ReturnType<typeof classifyBasicInfoError>;
  let session: TSession | null = null;

  try {
    const raw = await deps.fetchBasicInfo();
    session = deps.buildSession(raw, activeToken);
  } catch (err) {
    outcome = classifyBasicInfoError(err);
    if (outcome.kind === "unauthorized") {
      // 401 is never suppressed: clear token, session and current user.
      return {
        tokenValid: false,
        session: null,
        currentUser: null,
        currentUserReady: true,
        error: null,
      };
    }
    // BasicInfo failed, but display fields can still come from the JWT.
    session = deps.buildSession({}, activeToken);
  }

  if (!activeToken) {
    return {
      tokenValid: true,
      session,
      currentUser: null,
      currentUserReady: true,
      error: resolveSessionError({
        outcome,
        jwtTenantCode: null,
        currentUserResolved: false,
        currentUserTenantCode: null,
      }),
    };
  }

  const user = await deps.fetchCurrentUser(activeToken);
  return {
    tokenValid: true,
    session,
    currentUser: user,
    currentUserReady: true,
    error: resolveSessionError({
      outcome,
      jwtTenantCode: deps.readJwtTenantCode(activeToken),
      currentUserResolved: !!user,
      currentUserTenantCode: user ? deps.readUserTenantCode(user) : null,
    }),
  };
}
