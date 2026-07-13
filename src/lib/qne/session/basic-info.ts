// Shared, isomorphic normalizer for `GET /api/companyprofile/BasicInfo`.
//
// Used by BOTH the browser SessionProvider and the server-side current-user
// resolver (`/api/session/me`). This is the ONLY BasicInfo parser in the
// codebase — do not add competing pickers.
//
// The N3 payload has drifted across tenants (camelCase vs PascalCase, and
// user identity landing under `email`, `userName`, `loginName`, or an
// account/login field). We therefore look up every candidate key
// case-insensitively so the same value the header displays is also what
// gets fed into the /api/Users matcher.
//
// Tenant identity (tenantCode / companyName) is NEVER promoted to a user
// identifier — that would let a shared tenant field impersonate a user.

export interface NormalizedBasicInfo {
  companyName: string;
  tenantCode: string;
  userId: string | null;
  userCode: string | null;
  email: string | null;
  userName: string | null;
  displayName: string | null;
  /**
   * Best available official user identifier from BasicInfo, in this order:
   *   1. stable userId / userCode
   *   2. email
   *   3. userName
   * Trimmed but not lowercased — the /api/Users matcher normalises casing.
   */
  primaryUserIdentifier: string | null;
  /** Original raw payload keys, for diagnostics only. Never contains values. */
  rawKeys: string[];
}

const COMPANY_KEYS = [
  "companyName",
  "company",
  "companyDisplayName",
  "companyFullName",
  "name",
];
const TENANT_KEYS = ["tenantCode", "tenant", "tenantId", "code"];
const USER_ID_KEYS = ["userId", "userGuid", "userUuid"];
const USER_CODE_KEYS = ["userCode"];
const EMAIL_KEYS = [
  "email",
  "userEmail",
  "loginEmail",
  "emailAddress",
];
const USERNAME_KEYS = [
  "userName",
  "loginName",
  "login",
  "userAccount",
  "loginId",
  "username",
];
const DISPLAY_KEYS = [
  "displayName",
  "userDisplayName",
  "fullName",
  "name",
];

function toRecord(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

function buildLowerMap(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k.toLowerCase()] = v;
  }
  return out;
}

function pickCI(
  lowered: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const k of keys) {
    const v = lowered[k.toLowerCase()];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

export function normalizeBasicInfo(raw: unknown): NormalizedBasicInfo {
  const r = toRecord(raw);
  const lower = buildLowerMap(r);

  const companyName = pickCI(lower, COMPANY_KEYS) ?? "";
  const tenantCode = pickCI(lower, TENANT_KEYS) ?? "";
  const userId = pickCI(lower, USER_ID_KEYS);
  const userCode = pickCI(lower, USER_CODE_KEYS);
  const email = pickCI(lower, EMAIL_KEYS);
  const userName = pickCI(lower, USERNAME_KEYS);
  const displayName = pickCI(lower, DISPLAY_KEYS);

  // Guard: never let a tenant-identifying field be reused as user identity.
  const tenantIdentifiers = new Set(
    [tenantCode, companyName]
      .map((s) => (s ?? "").trim().toLowerCase())
      .filter(Boolean),
  );
  const asUserIdentifier = (v: string | null): string | null => {
    if (!v) return null;
    if (tenantIdentifiers.has(v.trim().toLowerCase())) return null;
    return v;
  };

  const primaryUserIdentifier =
    asUserIdentifier(userId) ??
    asUserIdentifier(userCode) ??
    asUserIdentifier(email) ??
    asUserIdentifier(userName) ??
    null;

  return {
    companyName,
    tenantCode,
    userId: asUserIdentifier(userId),
    userCode: asUserIdentifier(userCode),
    email: asUserIdentifier(email),
    userName: asUserIdentifier(userName),
    displayName,
    primaryUserIdentifier,
    rawKeys: Object.keys(r),
  };
}
