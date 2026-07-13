// Pure, side-effect-free helpers for resolving the current N3 user's
// ServiceHub Administrator status from the official N3 /api/Users response.
//
// Phase 0.9.7 rule (Owner-based ServiceHub Administration):
//   Administrator  ⇔  matched UserDto.isOwner === true
// The N3 "Administrators" role remains informational only.
//
// Field names come from the platform-v1 OpenAPI spec:
//   UserDto: { userId, userName, email, displayName, isOwner, isSupport,
//              isAccountant, roles: [{ id, name, displayName, isSystemRole }] }
//
// These helpers are free of Supabase / fetch / env access so they can be
// unit-tested in isolation.

export interface N3RoleDto {
  id?: string | null;
  name?: string | null;
  displayName?: string | null;
  isSystemRole?: boolean | null;
}

export interface N3UserDto {
  userId?: string | null;
  userName?: string | null;
  email?: string | null;
  displayName?: string | null;
  isOwner?: boolean | null;
  isSupport?: boolean | null;
  isAccountant?: boolean | null;
  roles?: N3RoleDto[] | null;
  // Some tenants may expose these; treat missing as "active".
  isActive?: boolean | null;
  isDisabled?: boolean | null;
  deactivated?: boolean | null;
}

/** Kept for informational display only — no longer the Administrator rule. */
export const ADMINISTRATOR_ROLE_NAME = "Administrators";

export function normaliseEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function roleNamesOf(user: N3UserDto | null | undefined): string[] {
  if (!user?.roles) return [];
  const out: string[] = [];
  for (const r of user.roles) {
    const name = (r?.name ?? "").trim();
    if (name) out.push(name);
  }
  return out;
}

/** Informational — not the primary Administrator rule (that's `isOwner`). */
export function hasAdministratorRole(user: N3UserDto | null | undefined): boolean {
  const target = ADMINISTRATOR_ROLE_NAME.toLowerCase();
  return roleNamesOf(user).some((n) => n.toLowerCase() === target);
}

/** Phase 0.9.7 primary rule — is this UserDto the tenant Owner? */
export function isOwnerUser(user: N3UserDto | null | undefined): boolean {
  return user?.isOwner === true;
}

/**
 * Only treat a user as inactive when the DTO EXPLICITLY marks them so.
 * When no active flag is present, treat as active.
 */
export function isUserActive(user: N3UserDto | null | undefined): boolean {
  if (!user) return false;
  if (user.isDisabled === true) return false;
  if (user.deactivated === true) return false;
  if (user.isActive === false) return false;
  return true;
}

export interface IdentityLookup {
  userId?: string | null;
  userCode?: string | null;
  email?: string | null;
  userName?: string | null;
}

/**
 * Match the authenticated user to an entry in /api/Users. Priority:
 * stable id → email → userName. Email and userName are cross-matched against
 * `UserDto.email` AND `UserDto.userName`, always trimmed and lowercased.
 */
export function matchCurrentUser(
  users: N3UserDto[],
  identity: IdentityLookup,
): N3UserDto | null {
  const wantId = (identity.userId ?? identity.userCode ?? "").trim();
  if (wantId) {
    for (const u of users) {
      if ((u.userId ?? "").trim() === wantId) return u;
    }
  }
  const wantEmail = normaliseEmail(identity.email);
  const wantUserName = normaliseEmail(identity.userName);
  if (!wantEmail && !wantUserName) return null;
  for (const u of users) {
    const uEmail = normaliseEmail(u.email);
    const uUser = normaliseEmail(u.userName);
    if (wantEmail && (uEmail === wantEmail || uUser === wantEmail)) return u;
    if (wantUserName && (uEmail === wantUserName || uUser === wantUserName)) {
      return u;
    }
  }
  return null;
}

export type AdminGate = "n3_owner" | "allowlist" | "bootstrap" | "none";

export type UsersEndpointStatus = "ok" | "failed" | "unauthorized" | "forbidden";

export type AdminDecisionReason =
  | "matched_owner"
  | "matched_not_owner"
  | "no_matching_user"
  | "users_endpoint_failed"
  | "users_endpoint_unauthorized"
  | "users_endpoint_forbidden"
  | "identity_missing"
  | "allowlist_fallback"
  | "bootstrap_fallback";

export interface AdminDecision {
  isAdministrator: boolean;
  adminGate: AdminGate;
  roleNames: string[];
  matchedUserId: string | null;
  matchedDisplayName: string | null;
  isOwner: boolean;
  reason: AdminDecisionReason;
}

export interface UsersLoad {
  users: N3UserDto[] | null;
  status: UsersEndpointStatus;
}

/**
 * Decide Administrator status from official N3 data.
 *
 * Precedence:
 *   1. Matched UserDto with isOwner === true → adminGate = "n3_owner"
 *   2. Tenant allowlist (emergency fallback, disabled by default) → "allowlist"
 *   3. Bootstrap (first user this tenant, disabled by default)     → "bootstrap"
 *   4. Otherwise                                                   → "none"
 */
export async function decideAdmin(
  usersLoad: UsersLoad,
  identity: IdentityLookup,
  allowlist: {
    isAllowlisted: (email: string) => Promise<boolean> | boolean;
    tryBootstrap?: (email: string) => Promise<boolean> | boolean;
  },
): Promise<AdminDecision> {
  const email = (identity.email ?? "").trim();
  const userName = (identity.userName ?? "").trim();
  const userId = (identity.userId ?? "").trim();
  const userCode = (identity.userCode ?? "").trim();
  const hasIdentity = Boolean(email || userName || userId || userCode);

  let matched: N3UserDto | null = null;
  let roleNames: string[] = [];
  let ownerFlag = false;
  let reason: AdminDecisionReason = "no_matching_user";

  if (usersLoad.status !== "ok") {
    reason =
      usersLoad.status === "unauthorized"
        ? "users_endpoint_unauthorized"
        : usersLoad.status === "forbidden"
          ? "users_endpoint_forbidden"
          : "users_endpoint_failed";
  } else if (!hasIdentity) {
    reason = "identity_missing";
  } else if (!usersLoad.users || usersLoad.users.length === 0) {
    reason = "no_matching_user";
  } else {
    matched = matchCurrentUser(usersLoad.users, identity);
    if (matched) {
      roleNames = roleNamesOf(matched);
      ownerFlag = isOwnerUser(matched);
      if (isUserActive(matched) && ownerFlag) {
        return {
          isAdministrator: true,
          adminGate: "n3_owner",
          roleNames,
          matchedUserId: (matched.userId ?? "").trim() || null,
          matchedDisplayName: (matched.displayName ?? "").trim() || null,
          isOwner: true,
          reason: "matched_owner",
        };
      }
      reason = "matched_not_owner";
    } else {
      reason = "no_matching_user";
    }
  }

  // Emergency fallback — tenant allowlist. Disabled by default; only fires
  // when a runtime opt-in is present (see current-user.server.ts).
  if (email && (await allowlist.isAllowlisted(email))) {
    return {
      isAdministrator: true,
      adminGate: "allowlist",
      roleNames,
      matchedUserId: (matched?.userId ?? "").trim() || null,
      matchedDisplayName: (matched?.displayName ?? "").trim() || null,
      isOwner: ownerFlag,
      reason: "allowlist_fallback",
    };
  }
  if (email && allowlist.tryBootstrap && (await allowlist.tryBootstrap(email))) {
    return {
      isAdministrator: true,
      adminGate: "bootstrap",
      roleNames,
      matchedUserId: (matched?.userId ?? "").trim() || null,
      matchedDisplayName: (matched?.displayName ?? "").trim() || null,
      isOwner: ownerFlag,
      reason: "bootstrap_fallback",
    };
  }

  return {
    isAdministrator: false,
    adminGate: "none",
    roleNames,
    matchedUserId: (matched?.userId ?? "").trim() || null,
    matchedDisplayName: (matched?.displayName ?? "").trim() || null,
    isOwner: ownerFlag,
    reason,
  };
}
