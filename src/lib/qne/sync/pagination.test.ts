import { describe, expect, it, vi } from "vitest";
import { assertNotTruncated, loadAllPaginated } from "./pagination.server";

function makeStore(n: number): Array<{ id: number }> {
  return Array.from({ length: n }, (_, i) => ({ id: i + 1 }));
}

describe("loadAllPaginated", () => {
  it("loads a tenant dataset larger than one page (>1000 rows)", async () => {
    const rows = makeStore(2465);
    const fetchPage = vi.fn(async (from: number, to: number) => ({
      data: rows.slice(from, to + 1),
      error: null,
    }));
    const out = await loadAllPaginated<{ id: number }>("test", fetchPage);
    expect(out.length).toBe(2465);
    expect(out[0].id).toBe(1);
    expect(out.at(-1)?.id).toBe(2465);
    // 2465 rows / 1000 = 3 pages (1000, 1000, 465). The last short page ends the loop.
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it("stops after a single short page for datasets smaller than one page", async () => {
    const rows = makeStore(42);
    const fetchPage = vi.fn(async () => ({ data: rows, error: null }));
    const out = await loadAllPaginated("test", fetchPage);
    expect(out.length).toBe(42);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("performs an extra request when the last full page exactly fills the boundary", async () => {
    const rows = makeStore(2000);
    const fetchPage = vi.fn(async (from: number, to: number) => ({
      data: rows.slice(from, to + 1),
      error: null,
    }));
    const out = await loadAllPaginated("test", fetchPage);
    expect(out.length).toBe(2000);
    // Two full pages, then a third empty page to prove we are not truncated.
    expect(fetchPage).toHaveBeenCalledTimes(3);
    const thirdCall = fetchPage.mock.calls[2];
    expect(thirdCall[0]).toBe(2000);
  });

  it("propagates errors with the loader label", async () => {
    const fetchPage = vi.fn(async () => ({
      data: null,
      error: { message: "boom" },
    }));
    await expect(loadAllPaginated("customers", fetchPage)).rejects.toThrow(
      /\[customers\] paginated load failed: boom/,
    );
  });
});

describe("assertNotTruncated", () => {
  it("throws the exact required message when the page is full", () => {
    expect(() => assertNotTruncated(1000, 1000, "stock")).toThrow(
      /Dataset load may be truncated/,
    );
  });
  it("does not throw when the page is short", () => {
    expect(() => assertNotTruncated(999, 1000, "stock")).not.toThrow();
  });
});
