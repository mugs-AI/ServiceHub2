import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { N3HttpError, n3Get } from "./n3.server";

const TOKEN = "test.jwt.token";

function mockFetch(response: {
  status: number;
  body: string;
  ok?: boolean;
}) {
  const ok = response.ok ?? (response.status >= 200 && response.status < 300);
  return vi.fn(async () =>
    ({
      ok,
      status: response.status,
      text: async () => response.body,
    }) as unknown as Response,
  );
}

describe("n3Fetch typed error contract (Phase 1.1.6a)", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("throws N3HttpError with status=404 for deleted documents", async () => {
    globalThis.fetch = mockFetch({
      status: 404,
      body: JSON.stringify({ code: "9404", message: "Not Found", data: null }),
    }) as unknown as typeof fetch;
    await expect(n3Get(TOKEN, "main", "/api/SalesInvoices/deleted-id")).rejects.toMatchObject({
      name: "N3HttpError",
      status: 404,
      envelopeCode: "9404",
    });
  });

  it("throws N3HttpError with status=401", async () => {
    globalThis.fetch = mockFetch({ status: 401, body: "Unauthorized" }) as unknown as typeof fetch;
    const err = await n3Get(TOKEN, "main", "/api/x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(N3HttpError);
    if (!(err instanceof N3HttpError)) throw err;
    expect(err.status).toBe(401);
  });

  it("throws N3HttpError with status=403", async () => {
    globalThis.fetch = mockFetch({ status: 403, body: "Forbidden" }) as unknown as typeof fetch;
    const err = await n3Get(TOKEN, "main", "/api/x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(N3HttpError);
    if (!(err instanceof N3HttpError)) throw err;
    expect(err.status).toBe(403);
  });

  it("throws N3HttpError with status=500", async () => {
    globalThis.fetch = mockFetch({ status: 500, body: "boom" }) as unknown as typeof fetch;
    const err = await n3Get(TOKEN, "main", "/api/x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(N3HttpError);
    if (!(err instanceof N3HttpError)) throw err;
    expect(err.status).toBe(500);
  });

  it("throws N3HttpError with status=200 and envelopeCode for non-0000 envelopes", async () => {
    globalThis.fetch = mockFetch({
      status: 200,
      body: JSON.stringify({ code: "9001", message: "Validation failed", data: null }),
    }) as unknown as typeof fetch;
    const err = await n3Get(TOKEN, "main", "/api/x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(N3HttpError);
    if (!(err instanceof N3HttpError)) throw err;
    expect(err.status).toBe(200);
    expect(err.envelopeCode).toBe("9001");
  });

  it("returns unwrapped data for HTTP 200 + envelope code 0000", async () => {
    globalThis.fetch = mockFetch({
      status: 200,
      body: JSON.stringify({ code: "0000", message: "OK", data: { hello: "world" } }),
    }) as unknown as typeof fetch;
    const data = await n3Get<{ hello: string }>(TOKEN, "main", "/api/x");
    expect(data).toEqual({ hello: "world" });
  });
});
