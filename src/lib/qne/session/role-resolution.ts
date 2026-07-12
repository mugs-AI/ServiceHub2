// Pure, side-effect-free helpers for resolving the current N3 user's
// Administrator status from an official N3 /api/Users response.
//
// Field names come from the official platform-v1 OpenAPI spec:
//   UserDto: { userId, userName, email, displayName, isOwner, isSupport,
//              isAccountant, roles: [{ id, name, displayName, isSystemRole }] }
//
// These helpers are intentionally free of Supabase, fetch, and env access
// so they can be unit-tested in isolation.

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
  // Some tenants expose active/disabled indicators under different names.
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

export function isUserActive(user: N3UserDto | null | undefined): boolean {
  if (!user) return false;
  if (user.isDisabled === true) return false;
  if (user.deactivated === true) return false;
  if (user.isActive === false) return false;
  return true;
}

/**
 * Match the current authenticated user (identified by BasicInfo) to an
 * entry from /api/Users. Prefers stable user id, then userName/email match
 * (both compared as normalised emails when they look like emails).
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

export interface AdminDecision {
  isAdministrator: boolean;
  adminGate: AdminGate;
  roleNames: string[];
  matchedUserId: string | null;
  matchedDisplayName: string | null;
  reason:
    | "role_administrators"
    | "allowlist"
    | "bootstrap"
    | "no_email"
    | "users_unavailable"
    | "no_match"
    | "no_roles"
    | "not_admin";
}

/**
 * Decide administrator status from official N3 data with a secure fallback
 * to the tenant-scoped ServiceHub allowlist.
 *
 * @param usersResponse - result of GET /api/Users, or `null` when the call
 *   failed / returned no data. Never pass browser-supplied lists.
 * @param identity - the current user resolved server-side from BasicInfo.
 * @param allowlist  - fallback checker for the current tenant.
 */
export async function decideAdmin(
  usersResponse: N3UserDto[] | null,
  identity: { userCode?: string | null; email?: string | null },
  allowlist: {
    isAllowlisted: (email: string) => Promise<boolean> | boolean;
    tryBootstrap?: (email: string) => Promise<boolean> | boolean;
  },
): Promise<AdminDecision> {
  const email = (identity.email ?? "").trim();
  let matched: N3UserDto | null = null;
  let roleNames: string[] = [];
  let reason: AdminDecision["reason"] = "no_match";

  if (usersResponse === null) {
    reason = "users_unavailable";
  } else if (!email && !identity.userCode) {
    reason = "no_email";
  } else {
    matched = matchCurrentUser(usersResponse, identity);
    if (matched) {
      roleNames = roleNamesOf(matched);
      if (isUserActive(matched) && hasAdministratorRole(matched)) {
        return {
          isAdministrator: true,
          adminGate: "n3_role",
          roleNames,
          matchedUserId: (matched.userId ?? "").trim() || null,
          matchedDisplayName: (matched.displayName ?? "").trim() || null,
          reason: "role_administrators",
        };
      }
      reason = roleNames.length === 0 ? "no_roles" : "not_admin";
    } else {
      reason = "no_match";
    }
  }

  // Fallback — secure, tenant-scoped ServiceHub allowlist.
  if (email && (await allowlist.isAllowlisted(email))) {
    return {
      isAdministrator: true,
      adminGate: "allowlist",
      roleNames,
      matchedUserId: (matched?.userId ?? "").trim() || null,
      matchedDisplayName: (matched?.displayName ?? "").trim() || null,
      reason: "allowlist",
    };
  }
  if (email && allowlist.tryBootstrap && (await allowlist.tryBootstrap(email))) {
    return {
      isAdministrator: true,
      adminGate: "bootstrap",
      roleNames,
      matchedUserId: (matched?.userId ?? "").trim() || null,
      matchedDisplayName: (matched?.displayName ?? "").trim() || null,
      reason: "bootstrap",
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
