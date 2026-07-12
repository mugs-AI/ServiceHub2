// Pure, side-effect-free helpers for resolving the current N3 user's
// Administrator status from the official N3 /api/Users response.
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

/** Official ServiceHub Administrator role name (exact, case-insensitive). */
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

/** Exact, case-insensitive match on the official "Administrators" role. */
export function hasAdministratorRole(user: N3UserDto | null | undefined): boolean {
  const target = ADMINISTRATOR_ROLE_NAME.toLowerCase();
  return roleNamesOf(user).some((n) => n.toLowerCase() === target);
}

/**
 * Only treat a user as inactive when the DTO EXPLICITLY marks them so.
 * When no active flag is present, treat as active (per Phase 0.9.4 rules).
 */
export function isUserActive(user: N3UserDto | null | undefined): boolean {
  if (!user) return false;
  if (user.isDisabled === true) return false;
  if (user.deactivated === true) return false;
  if (user.isActive === false) return false;
  return true;
}

/**
 * Match the authenticated user (identified by BasicInfo) to an entry in
 * /api/Users. Priority: userId → email → userName. Email and userName are
 * cross-matched, trimmed and lowercased. displayName is never used.
 */
export function matchCurrentUser(
  users: N3UserDto[],
  identity: { userCode?: string | null; email?: string | null },
): N3UserDto | null {
  const wantId = (identity.userCode ?? "").trim();
  if (wantId) {
    for (const u of users) {
      if ((u.userId ?? "").trim() === wantId) return u;
    }
  }
  const wantEmail = normaliseEmail(identity.email);
  if (!wantEmail) return null;
  for (const u of users) {
    if (normaliseEmail(u.email) === wantEmail) return u;
    if (normaliseEmail(u.userName) === wantEmail) return u;
  }
  return null;
}

export type AdminGate = "n3_role" | "allowlist" | "bootstrap" | "none";

export type UsersEndpointStatus = "ok" | "failed" | "unauthorized" | "forbidden";

export type AdminDecisionReason =
  | "matched_administrators_role"
  | "matched_without_administrators_role"
  | "role_data_missing"
  | "no_matching_user"
  | "users_endpoint_failed"
  | "users_endpoint_unauthorized"
  | "users_endpoint_forbidden"
  | "no_email"
  | "allowlist_fallback"
  | "bootstrap_fallback";

export interface AdminDecision {
  isAdministrator: boolean;
  adminGate: AdminGate;
  roleNames: string[];
  matchedUserId: string | null;
  matchedDisplayName: string | null;
  reason: AdminDecisionReason;
}

export interface UsersLoad {
  users: N3UserDto[] | null;
  status: UsersEndpointStatus;
}

/**
 * Decide administrator status from official N3 data with a secure fallback
 * to the tenant-scoped ServiceHub allowlist.
 *
 * Precedence:
 *   1. Official N3 "Administrators" role  → adminGate = "n3_role"
 *   2. Tenant allowlist                    → adminGate = "allowlist"
 *   3. Bootstrap (first user this tenant)  → adminGate = "bootstrap"
 *   4. Otherwise                           → adminGate = "none"
 */
export async function decideAdmin(
  usersLoad: UsersLoad,
  identity: { userCode?: string | null; email?: string | null },
  allowlist: {
    isAllowlisted: (email: string) => Promise<boolean> | boolean;
    tryBootstrap?: (email: string) => Promise<boolean> | boolean;
  },
): Promise<AdminDecision> {
  const email = (identity.email ?? "").trim();
  let matched: N3UserDto | null = null;
  let roleNames: string[] = [];
  let reason: AdminDecisionReason = "no_matching_user";

  if (usersLoad.status !== "ok") {
    reason =
      usersLoad.status === "unauthorized"
        ? "users_endpoint_unauthorized"
        : usersLoad.status === "forbidden"
          ? "users_endpoint_forbidden"
          : "users_endpoint_failed";
  } else if (!email && !identity.userCode) {
    reason = "no_email";
  } else if (!usersLoad.users || usersLoad.users.length === 0) {
    reason = "no_matching_user";
  } else {
    matched = matchCurrentUser(usersLoad.users, identity);
    if (matched) {
      roleNames = roleNamesOf(matched);
      if (isUserActive(matched) && hasAdministratorRole(matched)) {
        return {
          isAdministrator: true,
          adminGate: "n3_role",
          roleNames,
          matchedUserId: (matched.userId ?? "").trim() || null,
          matchedDisplayName: (matched.displayName ?? "").trim() || null,
          reason: "matched_administrators_role",
        };
      }
      reason =
        roleNames.length === 0
          ? "role_data_missing"
          : "matched_without_administrators_role";
    } else {
      reason = "no_matching_user";
    }
  }

  // Fallback — tenant-scoped ServiceHub allowlist.
  if (email && (await allowlist.isAllowlisted(email))) {
    return {
      isAdministrator: true,
      adminGate: "allowlist",
      roleNames,
      matchedUserId: (matched?.userId ?? "").trim() || null,
      matchedDisplayName: (matched?.displayName ?? "").trim() || null,
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
      reason: "bootstrap_fallback",
    };
  }

  return {
    isAdministrator: false,
    adminGate: "none",
    roleNames,
    matchedUserId: (matched?.userId ?? "").trim() || null,
    matchedDisplayName: (matched?.displayName ?? "").trim() || null,
    reason,
  };
}
