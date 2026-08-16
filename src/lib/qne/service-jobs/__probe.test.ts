import { describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
describe("probe", () => {
  it("imports a route module", async () => {
    const mod = await import("@/routes/api/workspace/jobs.$jobId.cancellation");
    expect(typeof (mod.Route as any).options.server.handlers.POST).toBe("function");
  });
});
