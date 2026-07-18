# Phase 1.1.5 — Cancelled Source Document Investigation Report

## 1. Root cause (confirmed)

The Sales Invoice snapshot for `M1S2512026b` is refreshed correctly — the
line row carries `document_status='Cancelled'`, `is_void=true`,
`is_void_source=true` (verified via `sales_invoice_line_snapshots`).

The defect is in `subscription-sync.server.ts`. When a document that
previously produced a renewal event later turns `isCancelled=true`, the
per-line handler **skips emitting the renewal event but never invalidates
the existing one**. The stale row in `subscription_renewal_events`
therefore keeps `is_source_void = false` forever, is still picked by the
rebuild's `latest event wins` selector, and continues to back the
current-subscription snapshot.

Verified in DB:

- Line snapshot: `document_status = 'Cancelled'`, `is_void = t`
- Renewal event `e9269959-…` for the same `source_document_id`:
  `is_source_void = f`, `expiry_date = 2026-12-30`

## 2. N3 cancellation field actually returned

`GET /api/SalesInvoices/{id}` returns `isCancelled: boolean` on the
header (also present on `/api/DeliveryOrders/{id}`). The sync reads it at
`subscription-sync.server.ts:533`:

```ts
const isVoid = Boolean(full.isCancelled ?? header.isCancelled);
```

No additional void / deleted / transfer field is consulted, and none is
needed — the brief exposes cancellation via `isCancelled`.

## 3. Invoice snapshot refresh

Correct. `sales_invoice_line_snapshots` is upserted every run with the
current `isVoid`, so `document_status`, `is_void` and `is_void_source`
reflect the latest N3 state for `M1S2512026b`.

## 4. Renewal event lifecycle after cancellation

Broken. `subscription-sync.server.ts:615-621`:

```ts
if (renewal) {
  metrics.mappedRenewalLines += 1;
  if (isVoid) {                              // ← early-return
    metrics.renewalEventsSkipped += 1;
    metrics.renewalEventsSkippedVoided += 1;
    return;                                   // no event pushed
  }
  ...
}
```

Because the void branch `return`s before pushing into `renewalEvents[]`,
the batched upsert at line 689-704 never touches the pre-existing row.
Nothing else in the pipeline sets `is_source_void = true` or deletes the
row. There is no reconciliation pass that walks `subscription_renewal_events`
against `*_line_snapshots.is_void`.

## 5. Current renewal event for `M1S2512026b`

```
id                     : e9269959-69b6-49f0-b0a6-def9c55326e2
source_document_id     : a9b0fb1e-4023-4075-e039-08dee1a9f0d4
source_document_no     : M1S2512026b
source_document_date   : 2025-12-31
customer_code          : 700-K051
stock_code             : Q-SW-Warranty-Q-Maint
expiry_date            : 2026-12-30
is_source_void         : false   ← stale, should be true
```

Eligible for the rebuild's `is_source_void = false` filter, so it wins.

## 6. Why rebuild still selects it

`rebuildCurrentSnapshots()` at `subscription-sync.server.ts:745-758`:

```ts
supabaseAdmin
  .from("subscription_renewal_events")
  .select(...)
  .eq("tenant_code", tenantCode)
  .eq("is_source_void", false)          // filter uses event flag only
  .order("source_document_date", { ascending: false })
  .order("source_line_id", { ascending: false })
```

Ordering: latest `source_document_date` wins per
`(n3_customer_id, category, n3_stock_id)` (or legacy composite). No join
against `*_line_snapshots.is_void` / `document_status`, and no
`is_source_void` refresh anywhere upstream. Therefore the cancelled
invoice — dated 2025-12-31, the most recent for this key — remains the
effective source.

## 7. Correct expected behaviour for `M1S2512026b`

1. Keep the cancelled document and line snapshots for audit (already
   correct).
2. On every sync, reconcile `subscription_renewal_events.is_source_void`
   from the authoritative line snapshot flag (`is_void` /
   `is_void_source` / `document_status = 'Cancelled'`), for BOTH sources.
3. Rebuild picks the latest non-void event, i.e. the most recent prior
   valid SINV or DO for the same
   `(tenant, n3_customer_id, category, n3_stock_id)`.
4. If none remain, the current subscription row must be removed or
   marked inactive — not left pointing at a cancelled document.
5. Workspace must display the surviving prior source (or "No current
   entitlement") rather than `M1S2512026b`.

Schema already supports this: `is_source_void` exists on
`subscription_renewal_events`; `is_void` / `document_status` exist on
both `sales_invoice_line_snapshots` and `delivery_order_line_snapshots`.
No migration is required for the fix — only reconciliation logic.

The rebuild will also need a deactivation step for
`customer_subscription_snapshots` rows whose `(n3_customer_id, category,
n3_stock_id)` no longer has any non-void event. `subscription_status`
already accepts a text value, so an `Inactive` / `Cancelled` status is
possible without schema change; final wording is a separate decision.

## 8. Delivery Order parity

Same defect. `syncSourceDetails()` is source-agnostic — the void branch
and the batched upsert are shared between Sales Invoices and Delivery
Orders, and `rebuildCurrentSnapshots()` filters events by
`is_source_void` regardless of `source_type`. A cancelled DO would leave
an identical stale event. The fix must run against both line-snapshot
tables in the same pass.

## 9. Confidence

**High.** DB rows confirm the stale `is_source_void = false` event
alongside a correctly-flagged cancelled line snapshot, and the code path
that would flip the flag does not exist. No additional N3 field or
schema change is required to remediate.

## Files and functions in scope for the eventual fix (no changes yet)

- `src/lib/qne/sync/subscription-sync.server.ts`
  - `syncSourceDetails()` — void branch at ~L615 must also invalidate
    the existing event, not just skip.
  - `rebuildCurrentSnapshots()` — must deactivate current subscription
    rows whose immutable key no longer resolves to a non-void event.
- `sales_invoice_line_snapshots`, `delivery_order_line_snapshots` —
  already authoritative for cancellation; no schema change.
- `subscription_renewal_events.is_source_void` — the flag that must be
  written on cancellation (currently only set at insert time).
