// Classification of browser-side `GET /api/companyprofile/BasicInfo` outcomes.
//
// BasicInfo is OPTIONAL company metadata. A same-tenant Normal User without
// the N3 "Company Profile / View" permission gets a genuine 403 while their
// ServiceHub session (JWT tenant + server-resolved current user) stays fully
// valid. That case must not surface a global session error.
//
// Classification is by HTTP status only — never by matching N3 error prose.
// A 401, an unexpected failure, or an unresolved tenant/actor is NEVER
// suppressed.

import { ForbiddenError, UnauthorizedError } from "@/lib/qne/client";

export type BasicInfoOutcome =
  | { kind: "ok" }
  | { kind: "unauthorized" }
  | { kind: "forbidden"; message: string }
  | { kind: "failed"; message: string };

export const BASIC_INFO_UNRESOLVED_ERROR =
  "Unable to securely resolve your company or user identity. Please relaunch ServiceHub from N3.";

export function classifyBasicInfoError(err: unknown): BasicInfoOutcome {
  if (err instanceof UnauthorizedError) return { kind: "unauthorized" };
  if (err instanceof ForbiddenError) {
    return { kind: "forbidden", message: err.message };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { kind: "failed", message };
}

export interface SessionErrorInput {
  outcome: BasicInfoOutcome;
  /** tenantCode carried by the N3 JWT, if any. */
  jwtTenantCode: string | null;
  /** true only when GET /api/session/me returned an authenticated user. */
  currentUserResolved: boolean;
  /** tenantCode the server resolved for that user, if any. */
  currentUserTenantCode: string | null;
}

/**
 * The banner-worthy session error, or null when the session is usable.
 */
/** Tenant-code comparison normalization: whitespace + case only. */
export function normalizeTenantCode(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

export function resolveSessionError(input: SessionErrorInput): string | null {
  const { outcome, jwtTenantCode, currentUserResolved, currentUserTenantCode } = input;

  switch (outcome.kind) {
    case "ok":
      return null;
    case "unauthorized":
      // Handled by the caller: token cleared, secure N3 relaunch required.
      return null;
    case "forbidden": {
      // Suppress ONLY when the authenticated session is independently proven:
      // JWT tenant present, current user resolved with a tenant, and both match.
      const jwt = normalizeTenantCode(jwtTenantCode);
      const server = normalizeTenantCode(currentUserTenantCode);
      if (currentUserResolved && jwt && server && jwt === server) return null;
      return BASIC_INFO_UNRESOLVED_ERROR;
    }
    case "failed":
      return outcome.message;
  }
}

/** True when company metadata is unavailable but the session remains usable. */
export function isCompanyProfileUnavailable(input: SessionErrorInput): boolean {
  return input.outcome.kind === "forbidden" && resolveSessionError(input) === null;
}
