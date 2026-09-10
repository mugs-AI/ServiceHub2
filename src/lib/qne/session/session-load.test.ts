import { describe, expect, it, vi } from "vitest";

import { ForbiddenError, UnauthorizedError } from "@/lib/qne/client";
import { BASIC_INFO_UNRESOLVED_ERROR } from "./basic-info-availability";
import { runSessionLoad } from "./session-load";

interface TestUser {
  tenantCode: string | null;
}

function deps(opts: {
  token?: string | null;
  basicInfo?: () => Promise<unknown>;
  user?: TestUser | null;
  jwtTenant?: string | null;
}) {
  const token = opts.token === undefined ? "tok" : opts.token;
  return {
    getToken: () => token,
    fetchBasicInfo: opts.basicInfo ?? (async () => ({ companyName: "Acme" })),
    fetchCurrentUser: vi.fn(async () => opts.user ?? null),
    buildSession: (raw: unknown, tok: string | null) => ({ raw, tok }),
    readJwtTenantCode: () => (opts.jwtTenant === undefined ? "CTTEH" : opts.jwtTenant),
    readUserTenantCode: (u: TestUser) => u.tenantCode,
  };
}

const forbidden = async () => {
  throw new ForbiddenError("N3 says no");
};

describe("runSessionLoad state transitions", () => {
  it("BasicInfo 401 clears token, session and current user (secure relaunch required)", async () => {
    const d = deps({
      basicInfo: async () => {
        throw new UnauthorizedError();
      },
      user: { tenantCode: "CTTEH" },
    });
    const state = await runSessionLoad(d);
    expect(state).toEqual({
      tokenValid: false,
      session: null,
      currentUser: null,
      currentUserReady: true,
      error: null,
    });
    // The server current-user call is never reached on a 401.
    expect(d.fetchCurrentUser).not.toHaveBeenCalled();
  });

  it("403 + matching JWT/current-user tenant + resolved user => usable, no banner", async () => {
    const state = await runSessionLoad(
      deps({ basicInfo: forbidden, user: { tenantCode: " ctteh " }, jwtTenant: "CTTEH" }),
    );
    expect(state.error).toBeNull();
    expect(state.tokenValid).toBe(true);
    expect(state.currentUser).toEqual({ tenantCode: " ctteh " });
  });

  it("403 + no JWT tenant but current-user tenant exists => fails closed", async () => {
    const state = await runSessionLoad(
      deps({ basicInfo: forbidden, user: { tenantCode: "CTTEH" }, jwtTenant: null }),
    );
    expect(state.error).toBe(BASIC_INFO_UNRESOLVED_ERROR);
  });

  it("403 + JWT tenant but no current-user tenant => fails closed", async () => {
    const state = await runSessionLoad(
      deps({ basicInfo: forbidden, user: { tenantCode: "" }, jwtTenant: "CTTEH" }),
    );
    expect(state.error).toBe(BASIC_INFO_UNRESOLVED_ERROR);
  });

  it("403 + contradictory tenants => fails closed", async () => {
    const state = await runSessionLoad(
      deps({ basicInfo: forbidden, user: { tenantCode: "OTHER" }, jwtTenant: "CTTEH" }),
    );
    expect(state.error).toBe(BASIC_INFO_UNRESOLVED_ERROR);
  });

  it("403 + unresolved current user => fails closed", async () => {
    const state = await runSessionLoad(
      deps({ basicInfo: forbidden, user: null, jwtTenant: "CTTEH" }),
    );
    expect(state.error).toBe(BASIC_INFO_UNRESOLVED_ERROR);
    expect(state.currentUser).toBeNull();
  });

  it("non-403 failure is surfaced verbatim, not suppressed", async () => {
    const state = await runSessionLoad(
      deps({
        basicInfo: async () => {
          throw new Error("Proxy HTTP 500");
        },
        user: { tenantCode: "CTTEH" },
      }),
    );
    expect(state.error).toBe("Proxy HTTP 500");
  });

  it("successful BasicInfo yields a session with no error", async () => {
    const state = await runSessionLoad(deps({ user: { tenantCode: "CTTEH" } }));
    expect(state.error).toBeNull();
    expect(state.session).toEqual({ raw: { companyName: "Acme" }, tok: "tok" });
  });

  it("no stored token: current-user call is skipped and 403 fails closed", async () => {
    const d = deps({ token: null, basicInfo: forbidden });
    const state = await runSessionLoad(d);
    expect(d.fetchCurrentUser).not.toHaveBeenCalled();
    expect(state.error).toBe(BASIC_INFO_UNRESOLVED_ERROR);
  });
});
