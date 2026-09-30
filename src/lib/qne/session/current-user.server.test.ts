import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => {
      throw new Error("Unexpected database access");
    },
  },
}));

function request(label = "owner") {
  const payload = btoa(
    JSON.stringify({ tenantCode: "TEST", userId: label, email: `${label}@test.invalid` }),
  );
  return new Request("https://servicehub.invalid/api/settings/tenant", {
    headers: { Authorization: `Bearer header.${payload}.signature` },
  });
}

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify({ code: "0000", data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const owner = [
  { userId: "owner", displayName: "Test Owner", email: "owner@test.invalid", isOwner: true },
];

describe("server administrator resolution recovery", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("SERVICEHUB_ALLOWLIST_FALLBACK", "0");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("shares one cold resolution across settings requests rather than conflicting owner decisions", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async (input: string | URL) => {
      if (String(input).includes("/BasicInfo")) return response({ tenantCode: "TEST" });
      calls++;
      return calls === 1 ? response(owner) : response(null, 503);
    });
    const { requireAdministrator } = await import("./current-user.server");
    const results = await Promise.allSettled([
      requireAdministrator(request()),
      requireAdministrator(request()),
    ]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    for (const r of results)
      if (r.status === "fulfilled") expect(r.value.isAdministrator).toBe(true);
    expect(calls).toBe(1);
  });

  it.each([503, 429, "network", "body", "json"])(
    "does not turn a temporary Users failure (%s) into a cached role denial",
    async (failure) => {
      let healthy = false;
      vi.stubGlobal("fetch", async (input: string | URL) => {
        if (String(input).includes("/BasicInfo")) return response({ tenantCode: "TEST" });
        if (healthy) return response(owner);
        if (failure === "network") throw new Error("network unavailable");
        if (failure === "body")
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.error(new Error("body unavailable"));
              },
            }),
          );
        if (failure === "json") return new Response("invalid-json");
        return response(null, failure as number);
      });
      const { requireAdministrator, guardResponse } = await import("./current-user.server");
      const error = await requireAdministrator(request()).catch((e: unknown) => e);
      expect(guardResponse(error)?.status).toBe(503);
      healthy = true;
      expect((await requireAdministrator(request())).isAdministrator).toBe(true);
    },
  );

  it("does not retain an upstream 403 after a later verified owner response", async () => {
    let healthy = false;
    vi.stubGlobal("fetch", async (input: string | URL) => {
      if (String(input).includes("/BasicInfo")) return response({ tenantCode: "TEST" });
      return healthy ? response(owner) : response(null, 403);
    });
    const { requireAdministrator, guardResponse } = await import("./current-user.server");
    const error = await requireAdministrator(request()).catch((e: unknown) => e);
    expect(guardResponse(error)?.status).toBe(403);
    healthy = true;
    expect((await requireAdministrator(request())).isAdministrator).toBe(true);
  });

  it.each([{ isOwner: false }, { isOwner: true, isDisabled: true }])(
    "continues to deny verified non-owners and disabled owners: %j",
    async (flags) => {
      vi.stubGlobal("fetch", async (input: string | URL) =>
        response(
          String(input).includes("/BasicInfo")
            ? { tenantCode: "TEST" }
            : [{ ...owner[0], ...flags }],
        ),
      );
      const { requireAdministrator, guardResponse } = await import("./current-user.server");
      const error = await requireAdministrator(request()).catch((e: unknown) => e);
      expect(guardResponse(error)?.status).toBe(403);
    },
  );

  it("rechecks cached owner authority after the existing 60-second TTL", async () => {
    let isOwner = true;
    vi.stubGlobal("fetch", async (input: string | URL) =>
      response(
        String(input).includes("/BasicInfo") ? { tenantCode: "TEST" } : [{ ...owner[0], isOwner }],
      ),
    );
    const { requireAdministrator, guardResponse } = await import("./current-user.server");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T00:00:00Z"));
    expect((await requireAdministrator(request())).isAdministrator).toBe(true);
    isOwner = false;
    vi.setSystemTime(new Date("2026-09-30T00:01:01Z"));
    const error = await requireAdministrator(request()).catch((e: unknown) => e);
    expect(guardResponse(error)?.status).toBe(403);
  });

  it("keeps expired authentication as 401 and permits a later valid retry", async () => {
    let expired = true;
    vi.stubGlobal("fetch", async (input: string | URL) => {
      if (String(input).includes("/BasicInfo"))
        return response({ tenantCode: "TEST" }, expired ? 401 : 200);
      return response(owner);
    });
    const { requireAdministrator, guardResponse } = await import("./current-user.server");
    const error = await requireAdministrator(request()).catch((e: unknown) => e);
    expect(guardResponse(error)?.status).toBe(401);
    expired = false;
    expect((await requireAdministrator(request())).isAdministrator).toBe(true);
  });

  it("preserves the explicitly enabled emergency allowlist during upstream outage", async () => {
    vi.stubEnv("SERVICEHUB_ALLOWLIST_FALLBACK", "1");
    vi.stubEnv("SERVICEHUB_BOOTSTRAP_ADMIN_EMAILS", "owner@test.invalid");
    vi.stubGlobal("fetch", async (input: string | URL) =>
      String(input).includes("/BasicInfo") ? response({ tenantCode: "TEST" }) : response(null, 503),
    );
    const { requireAdministrator } = await import("./current-user.server");
    expect((await requireAdministrator(request())).adminGate).toBe("allowlist");
  });

  it("does not share cached permissions between different tokens with the same suffix", async () => {
    const sharedSuffix = "x".repeat(120);
    const ownerRequest = request();
    ownerRequest.headers.set(
      "Authorization",
      `${ownerRequest.headers.get("Authorization")}${sharedSuffix}`,
    );
    const normalRequest = request("normal");
    normalRequest.headers.set(
      "Authorization",
      `${normalRequest.headers.get("Authorization")}${sharedSuffix}`,
    );
    vi.stubGlobal("fetch", async (input: string | URL) =>
      response(
        String(input).includes("/BasicInfo")
          ? { tenantCode: "TEST" }
          : [...owner, { userId: "normal", isOwner: false }],
      ),
    );
    const { requireAdministrator, guardResponse } = await import("./current-user.server");
    expect((await requireAdministrator(ownerRequest)).isAdministrator).toBe(true);
    const error = await requireAdministrator(normalRequest).catch((e: unknown) => e);
    expect(guardResponse(error)?.status).toBe(403);
  });
});
