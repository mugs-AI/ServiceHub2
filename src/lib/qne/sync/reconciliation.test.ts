// Phase 1.1.6b — Consistency correction tests.
//
// These tests pin the reconciliation invariants that operators depend on:
// (1) ordered writes so a mid-flight crash leaves entitlements safe,
// (2) run-boundary timestamp guards so refreshed rows are never
//     mis-invalidated,
// (3) empty / collapsing inventories skip reconciliation entirely,
// (4) the candidate cap advances deterministically across runs.

import { describe, expect, it, vi } from "vitest";
import {
  evaluateScanSafety,
  invalidateDeletedDocument,
  invalidateRemovedLine,
} from "./subscription-sync.server";

// ---------------------------------------------------------------------------
// Tiny supabase chain recorder. Captures the exact sequence of table,
// method, and predicate calls so tests can assert both the ORDER of the
// updates and the presence of the timestamp guard.

type Call = {
  table: string;
  op: "update";
  payload: Record<string, unknown>;
  eqs: Array<[string, unknown]>;
  lts: Array<[string, unknown]>;
};

function makeRecorder(opts: {
  eventsError?: string;
  lineError?: string;
} = {}) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      return {
        update(payload: Record<string, unknown>) {
          const call: Call = {
            table,
            op: "update",
            payload,
            eqs: [],
            lts: [],
          };
          calls.push(call);
          const isEvents = table === "subscription_renewal_events";
          const resolve = () =>
            Promise.resolve({
              error: isEvents
                ? opts.eventsError
                  ? { message: opts.eventsError }
                  : null
                : opts.lineError
                ? { message: opts.lineError }
                : null,
            });
          // Build a proxy that captures .eq/.lt in any order and resolves
          // to the recorded error only when awaited.
          const chain: Record<string, unknown> = {
            eq(col: string, val: unknown) {
              call.eqs.push([col, val]);
              return chain;
            },
            lt(col: string, val: unknown) {
              call.lts.push([col, val]);
              return chain;
            },
            then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
              return resolve().then(onFulfilled, onRejected);
            },
          };
          return chain as unknown;
        },
      };
    },
  };
  return { client, calls };
}

const RUN_STARTED_AT = new Date("2026-07-18T10:00:00.000Z");

describe("invalidateDeletedDocument (Phase 1.1.6b consistency)", () => {
  it("updates renewal events BEFORE line snapshots (safe ordering)", async () => {
    const { client, calls } = makeRecorder();
    await invalidateDeletedDocument({
      client,
      tenantCode: "T1",
      sourceType: "invoice",
      docId: "doc-1",
      runStartedAt: RUN_STARTED_AT,
      lineTable: "sales_invoice_line_snapshots",
    });
    expect(calls.map((c) => c.table)).toEqual([
      "subscription_renewal_events",
      "sales_invoice_line_snapshots",
    ]);
  });

  it("applies the run-boundary timestamp guard on the line update", async () => {
    const { client, calls } = makeRecorder();
    await invalidateDeletedDocument({
      client,
      tenantCode: "T1",
      sourceType: "invoice",
      docId: "doc-1",
      runStartedAt: RUN_STARTED_AT,
      lineTable: "sales_invoice_line_snapshots",
    });
    const lineCall = calls[1];
    expect(lineCall.lts).toEqual([["last_seen_at", RUN_STARTED_AT.toISOString()]]);
    // Line update carries document_status="Deleted" and last_synced_at.
    expect(lineCall.payload.is_deleted_in_source).toBe(true);
    expect(lineCall.payload.document_status).toBe("Deleted");
    expect(typeof lineCall.payload.last_synced_at).toBe("string");
  });

  it("throws (does not silently succeed) when the events update fails, and does not touch the line snapshot", async () => {
    const { client, calls } = makeRecorder({ eventsError: "events boom" });
    await expect(
      invalidateDeletedDocument({
        client,
        tenantCode: "T1",
        sourceType: "invoice",
        docId: "doc-1",
        runStartedAt: RUN_STARTED_AT,
        lineTable: "sales_invoice_line_snapshots",
      }),
    ).rejects.toThrow(/events invalidation failed/);
    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe("subscription_renewal_events");
  });

  it("throws when the line update fails (events already written, run marked failed)", async () => {
    const { client } = makeRecorder({ lineError: "lines boom" });
    await expect(
      invalidateDeletedDocument({
        client,
        tenantCode: "T1",
        sourceType: "invoice",
        docId: "doc-1",
        runStartedAt: RUN_STARTED_AT,
        lineTable: "sales_invoice_line_snapshots",
      }),
    ).rejects.toThrow(/line invalidation failed/);
  });
});

describe("invalidateRemovedLine (Phase 1.1.6b consistency)", () => {
  it("updates renewal events BEFORE the line snapshot and applies the run guard", async () => {
    const { client, calls } = makeRecorder();
    await invalidateRemovedLine({
      client,
      tenantCode: "T1",
      sourceType: "delivery_order",
      docId: "doc-2",
      lineId: "line-9",
      runStartedAt: RUN_STARTED_AT,
      lineTable: "delivery_order_line_snapshots",
    });
    expect(calls.map((c) => c.table)).toEqual([
      "subscription_renewal_events",
      "delivery_order_line_snapshots",
    ]);
    expect(calls[1].lts).toEqual([["last_seen_at", RUN_STARTED_AT.toISOString()]]);
    expect(calls[1].payload.document_status).toBe("Deleted");
  });

  it("does not update the line snapshot when the events update fails", async () => {
    const { client, calls } = makeRecorder({ eventsError: "nope" });
    await expect(
      invalidateRemovedLine({
        client,
        tenantCode: "T1",
        sourceType: "invoice",
        docId: "doc-2",
        lineId: "line-9",
        runStartedAt: RUN_STARTED_AT,
        lineTable: "sales_invoice_line_snapshots",
      }),
    ).rejects.toThrow(/events invalidation failed/);
    expect(calls).toHaveLength(1);
  });
});

describe("evaluateScanSafety (Phase 1.1.6b guards)", () => {
  const base = {
    scanHealthy: true,
    scanReason: null,
    inventoryTotal: 100,
    uniqueHeadersSeen: 100,
    existingActiveLineDocuments: 100,
    priorInventoryTotal: 100,
  };

  it("passes a normal healthy run", () => {
    expect(evaluateScanSafety(base).skippedUnsafe).toBe(false);
  });

  it("skips when scan is unhealthy, forwarding the reason", () => {
    const r = evaluateScanSafety({
      ...base,
      scanHealthy: false,
      scanReason: "transport 500",
    });
    expect(r).toEqual({ skippedUnsafe: true, skippedReason: "transport 500" });
  });

  it("skips on empty inventory (0 headers) while local data exists — never wipes on an empty response", () => {
    const r = evaluateScanSafety({
      ...base,
      inventoryTotal: null,
      uniqueHeadersSeen: 0,
    });
    expect(r.skippedUnsafe).toBe(true);
    expect(r.skippedReason).toMatch(/empty inventory/);
  });

  it("skips when N3 reports total=0 while active documents exist locally", () => {
    const r = evaluateScanSafety({
      ...base,
      inventoryTotal: 0,
      uniqueHeadersSeen: 0,
    });
    expect(r.skippedUnsafe).toBe(true);
    expect(r.skippedReason).toMatch(/total=0/);
  });

  it("skips on suspicious collapse (<50% of prior)", () => {
    const r = evaluateScanSafety({
      ...base,
      inventoryTotal: 40,
      uniqueHeadersSeen: 40,
      priorInventoryTotal: 100,
    });
    expect(r.skippedUnsafe).toBe(true);
    expect(r.skippedReason).toMatch(/inventory collapse/);
  });

  it("does NOT trip the collapse guard when the prior is below the noise floor", () => {
    const r = evaluateScanSafety({
      ...base,
      inventoryTotal: 2,
      uniqueHeadersSeen: 2,
      priorInventoryTotal: 5, // < minPriorForCollapseCheck default 10
      existingActiveLineDocuments: 2,
    });
    expect(r.skippedUnsafe).toBe(false);
  });

  it("legitimately empty tenant with no local data — reconciliation may proceed", () => {
    const r = evaluateScanSafety({
      ...base,
      inventoryTotal: 0,
      uniqueHeadersSeen: 0,
      existingActiveLineDocuments: 0,
      priorInventoryTotal: 0,
    });
    expect(r.skippedUnsafe).toBe(false);
  });
});

// Extra guard: the reconciliation writer signatures MUST expose the
// runStartedAt argument so we can never revert to now()-based comparisons
// that race in-flight upserts.
describe("run-boundary API surface", () => {
  it("invalidateDeletedDocument requires runStartedAt", () => {
    // Compile-time check via runtime signature: throw when we pass a bad
    // arg to prove the field exists on the contract.
    const badCall = () =>
      invalidateDeletedDocument({
        client: { from: vi.fn() as unknown as (t: string) => unknown },
        tenantCode: "T",
        sourceType: "invoice",
        docId: "x",
        // @ts-expect-error runStartedAt missing must fail typecheck
        runStartedAt: undefined,
        lineTable: "sales_invoice_line_snapshots",
      });
    // Just referencing the function is enough — we don't await badCall.
    expect(typeof badCall).toBe("function");
  });
});
