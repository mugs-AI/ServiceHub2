import { describe, expect, it } from "vitest";

import { ForbiddenError, UnauthorizedError } from "@/lib/qne/client";
import {
  BASIC_INFO_UNRESOLVED_ERROR,
  classifyBasicInfoError,
  isCompanyProfileUnavailable,
  resolveSessionError,
  type SessionErrorInput,
} from "./basic-info-availability";

const base: SessionErrorInput = {
  outcome: { kind: "ok" },
  jwtTenantCode: "CTTEH",
  currentUserResolved: true,
  currentUserTenantCode: "CTTEH",
};

describe("classifyBasicInfoError", () => {
  it("classifies by typed status, not by N3 message prose", () => {
    expect(
      classifyBasicInfoError(new ForbiddenError("No permission to View Company Profile")),
    ).toEqual({
      kind: "forbidden",
      message: "No permission to View Company Profile",
    });
    expect(classifyBasicInfoError(new UnauthorizedError())).toEqual({ kind: "unauthorized" });
    // Prose mentioning permission but WITHOUT a 403 status stays "failed".
    expect(
      classifyBasicInfoError(new Error("You do not have permission (Company Profile)")),
    ).toEqual({ kind: "failed", message: "You do not have permission (Company Profile)" });
  });
});

describe("resolveSessionError", () => {
  it("Normal User: 403 + matching JWT and current-user tenant => usable, no banner", () => {
    const input: SessionErrorInput = {
      ...base,
      outcome: { kind: "forbidden", message: "forbidden" },
      currentUserTenantCode: " ctteh ",
    };
    expect(resolveSessionError(input)).toBeNull();
    expect(isCompanyProfileUnavailable(input)).toBe(true);
  });

  it("403 with a JWT tenant but no current-user tenant fails closed", () => {
    const input: SessionErrorInput = {
      ...base,
      outcome: { kind: "forbidden", message: "forbidden" },
      currentUserTenantCode: null,
    };
    expect(resolveSessionError(input)).toBe(BASIC_INFO_UNRESOLVED_ERROR);
    expect(isCompanyProfileUnavailable(input)).toBe(false);
  });

  it("403 with a current-user tenant but no JWT tenant fails closed", () => {
    expect(
      resolveSessionError({
        ...base,
        outcome: { kind: "forbidden", message: "forbidden" },
        jwtTenantCode: null,
      }),
    ).toBe(BASIC_INFO_UNRESOLVED_ERROR);
  });

  it("403 with contradictory JWT and current-user tenants fails closed", () => {
    expect(
      resolveSessionError({
        ...base,
        outcome: { kind: "forbidden", message: "forbidden" },
        jwtTenantCode: "CTTEH",
        currentUserTenantCode: "OTHERCO",
      }),
    ).toBe(BASIC_INFO_UNRESOLVED_ERROR);
  });

  it("Owner/Admin: same 403 case resolves identically (no banner)", () => {
    expect(
      resolveSessionError({
        ...base,
        outcome: { kind: "forbidden", message: "forbidden" },
      }),
    ).toBeNull();
  });

  it("401 is never converted into a usable-session banner decision", () => {
    // Caller clears the token and requires a secure N3 relaunch.
    expect(resolveSessionError({ ...base, outcome: { kind: "unauthorized" } })).toBeNull();
    expect(classifyBasicInfoError(new UnauthorizedError()).kind).toBe("unauthorized");
  });

  it("403 with no tenant in BasicInfo or JWT fails closed", () => {
    expect(
      resolveSessionError({
        outcome: { kind: "forbidden", message: "forbidden" },
        jwtTenantCode: null,
        currentUserResolved: true,
        currentUserTenantCode: null,
      }),
    ).toBe(BASIC_INFO_UNRESOLVED_ERROR);
  });

  it("403 with unresolved current user fails closed", () => {
    const input: SessionErrorInput = {
      ...base,
      outcome: { kind: "forbidden", message: "forbidden" },
      currentUserResolved: false,
      currentUserTenantCode: null,
    };
    expect(resolveSessionError(input)).toBe(BASIC_INFO_UNRESOLVED_ERROR);
    expect(isCompanyProfileUnavailable(input)).toBe(false);
  });

  it("non-403 unexpected failure is surfaced, never silently suppressed", () => {
    expect(
      resolveSessionError({ ...base, outcome: { kind: "failed", message: "Proxy HTTP 500" } }),
    ).toBe("Proxy HTTP 500");
  });

  it("successful BasicInfo produces no error", () => {
    expect(resolveSessionError(base)).toBeNull();
  });
});
