# Phase 1.1.6c — Investigation Report (PLAN / NO CODE CHANGES)

## Problem 1 — Quantity is ignored in entitlement duration

### Root cause (confirmed)

The subscription pipeline captures line quantity into
`sales_invoice_line_snapshots.quantity` /
`delivery_order_line_snapshots.quantity`, but the renewal-event and expiry
calculation drop it entirely:

- `subscription_renewal_events` has NO `quantity` column
  (verified via `information_schema.columns`).
- `computeInclusiveExpiry(start, value, unit)` in
  `src/lib/qne/sync/subscription-sync.server.ts` (lines 348–362) uses only the
  configured cycle. It never multiplies by line qty.
- The event upsert call (lines 966–999) writes only
  `renewal_cycle_value`/`renewal_cycle_unit`; no qty is persisted.
- `rebuildCurrentSnapshots` (lines 1400–1570) reads `expiry_date` back
  verbatim from the event — so once the event is written without
  qty-multiplication, the workspace snapshot cannot recover it.

So for `M1D2604002`, line `QCA--PRO---` (1 y cycle, qty=2) writes an event
with `expiry = docDate + 1 y − 1 day = 2027-05-31` on every rerun,
regardless of whether qty was 1, 2 or 3. That matches the observed
"expiry stuck at 31/05/2027".

### Pipeline trace (SI + DO, identical shape)

| Step | Location | Field |
|------|----------|-------|
| N3 detail line | `N3DocLine.qty?: number` (subscription-sync.server.ts:286–298) | `qty` |
| Line snapshot write | `subscription-sync.server.ts:920` | `quantity: typeof line.qty === "number" ? line.qty : null` |
| Renewal event insert | `subscription-sync.server.ts:971–999` | qty NOT written |
| Expiry function | `computeInclusiveExpiry` (lines 348–362) | takes `value, unit` only |
| Event upsert conflict key | `syncSubscriptionSnapshots` upsert on `(tenant_code, source_type, n3_document_id, n3_line_id)` | qty changes DO overwrite the row on the next full sync — so a fix will backfill naturally |
| Current-subscription rebuild | `rebuildCurrentSnapshots` (line 1507) | reads `ev.expiry_date` directly |

### Proposed rule (safe to adopt)

`effective duration = configured renewal cycle × eligible line quantity`

Multiplier applied ONLY when the effective quantity is a finite integer
≥ 1. All other cases fall back to `qty = 1` so no rounding surprises leak
into the ledger:

| Case | Effective qty | Rationale |
|------|---------------|-----------|
| qty = 1..N (integer) | qty | Normal N3 sales |
| null / missing | 1 | Preserves current behaviour |
| 0 | Event SKIPPED (`renewalEventsSkippedZeroQty`) | A zero-qty line grants nothing |
| Negative (credit note) | Event SKIPPED (`renewalEventsSkippedNegativeQty`) — do NOT auto-subtract days; N3 credit notes are separate documents and are out of scope for 1.1.6c | Prevents silent shortening |
| Decimal (e.g. 1.5) | `Math.floor(qty)` if ≥ 1, else skipped | N3 renewal SKUs are whole cycles; fractional cycles are ambiguous — document behaviour, keep conservative |
| Text ("2") | Coerce via `Number()`; require `Number.isFinite && Number.isInteger`; else 1 | qty already typed as `number` on the DTO, but be defensive |
| Cancelled doc | Event skipped (existing behaviour), qty ignored | Unchanged |
| Removed line | Existing invalidation flow (existing behaviour), qty ignored | Unchanged |
| Qty reduced after prior sync | New sync overwrites event on the same conflict key → expiry SHORTENS | Correct |
| Qty increased after prior sync | Same overwrite → expiry EXTENDS | Correct |
| Qty changes without doc-date change | Event overwritten, `rebuildCurrentSnapshots` picks the newer `expiry_date` (max by expiry) | Correct |
| Monthly cycle × qty | `computeInclusiveExpiry(start, cycle*qty, "month")` — calendar arithmetic preserved | Handles 31st→28th/29th and leap years correctly |
| Yearly cycle × qty | Same, unit "year" | Same |
| Leap year / month-end | Delegated to existing `setUTCMonth`/`setUTCFullYear` — behaviour unchanged | Already correct |

### Data model impact

Preferred: add `quantity_used integer NOT NULL DEFAULT 1` to
`subscription_renewal_events` and persist the effective quantity, so audit
history + Document Verifier can explain "why is expiry X". Cycle
value/unit stay as the configured mapping; the multiplier is a first-class
column.

### Backfill requirement

Yes. After deploying the fix, one **full subscription sync** must run so
every existing event is re-derived with qty. No manual SQL backfill is
required because the upsert overwrites on
`(tenant_code, source_type, n3_document_id, n3_line_id)` and the line
snapshots already carry `quantity`. Communicate a one-time expected batch
of `updated_count` roughly equal to the number of mapped renewal lines.

---

## Problem 2 — "Mapping could not be saved" for `qca--pro-month`

### Root cause (confirmed)

`POST /api/settings/stock-mappings` performs

```ts
supabaseAdmin.from("renewal_stock_mappings").upsert(row, {
  onConflict: "tenant_code,stock_code",
});
```

but the `(tenant_code, stock_code)` unique constraint was DROPPED in
migration `20260715012509_..._Pass 3 identity migration`:

```
ALTER TABLE public.renewal_stock_mappings
  DROP CONSTRAINT IF EXISTS renewal_stock_mappings_tenant_code_stock_code_key;
DROP INDEX IF EXISTS public.ux_renewal_stock_mappings_tenant_stock;
```

Current unique indexes on the table (verified live):

- `renewal_stock_mappings_pkey (id)`
- `renewal_stock_mappings_tenant_n3id_uidx (tenant_code, n3_stock_id) WHERE n3_stock_id IS NOT NULL`

PostgREST therefore rejects the upsert with SQLSTATE **42P10** —
"there is no unique or exclusion constraint matching the ON CONFLICT
specification". The catch block masks it as the generic 500
"Mapping could not be saved. Please try again." (line 339). Every
first-time save of a new stock code fails identically; existing mappings
survive only because they were inserted BEFORE the constraint was dropped.

### Evidence

- Stock row exists and has an immutable ID:
  `tenant=D32-049-4F0, stock_code=qca--pro-month, n3_stock_id=1952748,
  stock_name="QCA Pro (by month)"`.
- Tenant-scope check passes (line 296–308).
- Category check passes if "N3 Subscription" is active for the tenant.
- No RLS involvement — the route uses `supabaseAdmin` (service_role).
- `1 Month` is serialized correctly: UI sends
  `{ renewal_cycle_value: 1, renewal_cycle_unit: "month" }`; server
  validation at lines 251–267 accepts those.
- Failure is deterministic at the `.upsert(...)` call.

### Correction plan (Phase 1.1.6c build)

1. Switch upsert to the new canonical identity when it exists:
   `onConflict: "tenant_code,n3_stock_id"`, writing `n3_stock_id` from the
   `stock_snapshots` lookup already performed at lines 296–308.
2. Because `renewal_stock_mappings_tenant_n3id_uidx` is a **partial** index
   (`WHERE n3_stock_id IS NOT NULL`), rows without an ID cannot use it.
   Two options; pick one in build:
   - **A (preferred):** require `n3_stock_id` at write time. If the
     stock snapshot lookup returns no `n3_stock_id`, refuse with a
     specific 409 ("Sync Stocks Only, then remap"). Legacy code-only rows
     already have IDs backfilled by the Pass 3 migration; new writes will
     always have one.
   - **B:** additionally recreate a non-partial unique constraint on
     `(tenant_code, stock_code)` to restore the previous upsert path
     alongside the ID path. Riskier — reintroduces the mutable-key
     conflicts Pass 3 removed.
3. Surface the real Supabase error to the admin toast/log. Return
   `{ error: err.message, code: err.code }` (still generic to end users,
   detailed in `console.error`), and add a dedicated 42P10 mapping to a
   friendly "Mapping table is not indexed on that key — contact support".
4. Add a targeted unit test / smoke test that this endpoint succeeds for
   a stock code with no existing mapping.

---

## UI-only follow-ups (document, do NOT change here)

1. Two "Sync in progress" panels in
   `src/routes/admin.snapshots.tsx`:
   - Live orchestration banner around line 364.
   - Full-run panel around line 518.
   Change background/border to a light-red warning tone
   (`bg-red-50 border-red-200 text-red-900`), keep readable text.
2. "Running full sync…" button (line 395) — while disabled, apply the same
   light-red background so it visibly signals in-flight work.
3. Document Verifier date display uses shared `fmtDate` (line 124), which
   returns `toLocaleString()` → renders "8:00 AM". For Verifier-only
   date-only display, introduce a `fmtDateOnly` helper (`toLocaleDateString`)
   and use it at lines 1464 and 1505. Do NOT touch the stored timestamps or
   the other `fmtDate` callers.

---

## Test matrix

Quantity duration:

- qty=1, 1 y cycle → +1 y − 1 day (regression, current behaviour preserved)
- qty=2, 1 y cycle → +2 y − 1 day
- qty=3, 1 y cycle → +3 y − 1 day
- qty=6, 1 mo cycle → +6 mo − 1 day
- qty=12, 1 mo cycle → +12 mo − 1 day (calendar, not 365 d)
- qty=1, 1 mo cycle, start 2027-01-31 → 2027-02-27 (month-end)
- qty=1, 1 y cycle, start 2028-02-29 → 2029-02-27 (leap-year rollover)
- qty=null → treated as 1
- qty=0 → event skipped, counter increments
- qty=-1 → event skipped, counter increments
- qty=1.5 → floor to 1
- Cancelled document → event skipped regardless of qty
- Removed line → invalidation path unchanged
- Increase qty and rerun → same event row overwritten, expiry extends,
  `rebuildCurrentSnapshots` picks new `expiry_date`
- Decrease qty and rerun → expiry shortens

Mapping save:

- New stock, no prior mapping → succeeds with `n3_stock_id` upsert
- Same stock, edit cycle 1 mo → 1 y → single row updated
- Category disabled for tenant → 400 with existing message
- Stock without `n3_stock_id` (legacy) → deterministic 409 with actionable
  message
- Adhoc mapping (no category/cycle) → succeeds
- Concurrent double-save → second call updates same row (no duplicate)

---

## Recommended implementation sequence

1. Migration: add `quantity_used` to `subscription_renewal_events` (nullable,
   default 1) — cheap and reversible.
2. Sync engine: compute `effectiveQty`, persist in event, pass
   `cycle*effectiveQty` into `computeInclusiveExpiry`, add skipped-counters.
3. Full subscription sync to backfill all events.
4. Mapping API: switch upsert to `tenant_code,n3_stock_id`, require ID,
   surface real error code.
5. UI polish (banners, button, date-only) — cosmetic only.
6. Add regression tests for qty matrix and for POST mapping success.

READY FOR PHASE 1.1.6c BUILD
