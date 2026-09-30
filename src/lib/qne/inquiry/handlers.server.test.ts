import { beforeEach, describe, expect, it, vi } from "vitest";
import { OWNER_ADMIN_ACCESS, NORMAL_USER_DEFAULT } from "./permissions";
import { ForbiddenError, UnauthorizedError } from "@/lib/qne/session/current-user.server";
import { handleInquiry } from "./handlers.server";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  permission: vi.fn(),
  resolve: vi.fn(),
  query: vi.fn(),
  insert: vi.fn(),
}));
vi.mock("@/lib/qne/session/current-user.server", async (original) => ({
  ...(await original<object>()),
  requireAuthenticatedN3User: mocks.auth,
}));
vi.mock("./permissions.server", () => ({
  requireInquiryAccess: mocks.permission,
  resolveInquiryAccessForUser: mocks.resolve,
}));
vi.mock("./job-details.server", () => ({ queryJobDetails: mocks.query }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: () => ({ insert: mocks.insert }) },
}));
const request = (body: unknown = { columns: ["job_number"] }, query = "") =>
  new Request(`https://test.invalid/api/inquiries/job-details/export?${query}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({
    tenantCode: "tenant-A",
    diagnostics: { matchedN3UserId: "immutable-A" },
    displayName: "Actor",
    token: "must-not-leak",
  });
  mocks.permission.mockResolvedValue(OWNER_ADMIN_ACCESS);
  mocks.resolve.mockResolvedValue(NORMAL_USER_DEFAULT);
  mocks.query.mockResolvedValue({
    rows: [{ id: "job-A", job_number: "SJ0001", internal_note: "private" }],
    total: 1,
    page: 1,
    pageSize: 20,
    access: OWNER_ADMIN_ACCESS,
  });
  mocks.insert.mockResolvedValue({ error: null });
});
describe("inquiry HTTP boundary", () => {
  it("distinguishes 401 and 403 without reading Jobs", async () => {
    mocks.auth.mockRejectedValueOnce(new UnauthorizedError());
    expect((await handleInquiry(request(), "export")).status).toBe(401);
    mocks.permission.mockRejectedValueOnce(new ForbiddenError());
    expect((await handleInquiry(request(), "list")).status).toBe(403);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("returns only effective access with no shared caching", async () => {
    const response = await handleInquiry(request(), "access");
    expect(await response.json()).toEqual({ access: NORMAL_USER_DEFAULT });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("rechecks grants and rejects newly unauthorized export columns", async () => {
    mocks.permission.mockResolvedValue({ ...OWNER_ADMIN_ACCESS, view_private_notes: false });
    expect((await handleInquiry(request({ columns: ["internal_note"] }), "export")).status).toBe(
      400,
    );
    expect(mocks.query).not.toHaveBeenCalled();
    mocks.permission.mockRejectedValue(new ForbiddenError());
    expect((await handleInquiry(request(), "export")).status).toBe(403);
    expect(mocks.permission).toHaveBeenLastCalledWith(
      expect.anything(),
      "job_details_inquiry",
      "can_export_excel",
    );
  });
  it("ignores browser tenant/actor, exports XLSX and audits only metadata", async () => {
    const response = await handleInquiry(
      request(undefined, "tenant_code=alien&userId=alien&q=search&from=&to=&page=4"),
      "export",
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("spreadsheetml");
    expect(new Uint8Array(await response.arrayBuffer()).slice(0, 2)).toEqual(
      new Uint8Array([80, 75]),
    );
    expect(mocks.query).toHaveBeenCalledWith(
      expect.anything(),
      { tenantCode: "tenant-A", userId: "immutable-A" },
      OWNER_ADMIN_ACCESS,
      expect.objectContaining({ q: "search", page: 4, from: "", to: "" }),
      true,
    );
    const audit = mocks.insert.mock.calls[0][0];
    expect(audit).toMatchObject({
      tenant_code: "tenant-A",
      performed_by_user_id: "immutable-A",
      new_value: { rowCount: 1, columns: ["job_number"] },
    });
    expect(JSON.stringify(audit)).not.toMatch(/private|must-not-leak|search/);
  });
  it("blocks download after audit failure and rejects malformed body", async () => {
    mocks.insert.mockResolvedValue({ error: { message: "backend-secret" } });
    const failed = await handleInquiry(request(), "export");
    expect(failed.status).toBe(500);
    expect(await failed.text()).not.toContain("backend-secret");
    expect(
      (
        await handleInquiry(
          new Request("https://test.invalid", { method: "POST", body: "{" }),
          "export",
        )
      ).status,
    ).toBe(400);
  });
});
