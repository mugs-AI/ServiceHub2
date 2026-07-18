
# Phase 1.1.6 — Plan Addendum (pre-build)

Investigation only. On approval I will overwrite `.lovable/plan.md` with
this content. No code, schema, migration, generated-file, or data change
in this turn.

## A. Confirmed facts (verified this turn)

- `syncSourceDetails` (subscription-sync.server.ts L478–L488) drives the
  header loop from `n3IterateList` over `/api/SalesInvoices/List` and
  `/api/DeliveryOrders/List` **with no `$filter`, no date window, and no
  updatedAt watermark**. It is a full inventory scan every run.
- `n3IterateList` (n3.server.ts) pages with `$top`/`$skip` and stops when
  either `rows.length < pageSize` or `skip + rows.length >= total`. The
  API-reported `total` is available on every page.
- Any list-page throw aborts the whole source with an `Error` (L484) — a
  partially-loaded set never reaches the header loop.
- Detail failures are counted (`detailRequestsFailed`) but do not abort
  the run; there is no HTTP-status typing yet, only regex-fished
  `(\d{3})` from the error message.
- Header cancellation propagation (L726) already scopes updates by
  `tenant_code + source_type + source_document_id`. There is no
  cross-tenant or cross-source query in the current pipeline.
- Concurrency: `sync_locks` already implements a per-tenant lease with
  `expires_at` and heartbeat (Phase 1.1.1). `SyncLockedError` is raised
  when a live lease exists, and `/api/sync/subscriptions` returns 409
  with `activeLock`. There is currently **no per-source lock** — a
  subscription run holds one tenant-wide subscription lease.

## B. Remaining uncertainty (probe in 1.1.6a, read-only)

1. Response shape for `GET /api/SalesInvoices/{deletedId}` and
   `.../DeliveryOrders/{id}` — HTTP 404? 200 with envelope
   `code!="0000"`? which code string?
2. Does the List endpoint expose `isDeleted` / `documentStatus` /
   `deletedAt` on any lifecycle state?
3. Existence of an Audit Trail / change-log endpoint (not in registry).
4. Detail-line `id` stability across edits.
5. DO→SINV transfer provenance field (`fromDocId`, `sourceDocumentId`).

All 5 are cheap read-only calls; none change entitlement.

## C. Full vs incremental reconciliation — safety rule

**Deletion reconciliation is permitted only after a verified full
inventory scan. Absence from any incomplete inventory MUST NEVER revoke
entitlement.**

- Today the sync is already a full scan (§A). Reconciliation is safe on
  today's flow.
- If a future incremental / date-filtered / watermark scan is
  introduced, that scan MUST NOT drive deletion reconciliation; a
  separate periodic full scan (daily is enough for this workload) owns
  reconciliation. Documents outside the incremental window are protected
  because they are never compared against a partial inventory.
- **"Scan complete" proof — all five must hold** for a given
  `(tenant_code, source_type)`:
  1. Every page fetched without throw (`n3IterateList` returned normally).
  2. `sum(page.rows.length) === page.total` on the last page.
  3. No permission error observed (any 401/403 aborts the whole source).
  4. No `$filter` / date parameter present on the list URL.
  5. Header count not suspiciously below the previous successful run's
     count (e.g. drop > 20% triggers "skipped-unsafe" — configurable
     floor; conservative default in code).
- **If any proof fails**: reconciliation is skipped for that
  `(tenant_code, source_type)`; existing entitlement state is left
  untouched; a warning is logged and surfaced in the Admin console; no
  reconciliation watermark is advanced. The header-driven
  cancellation/upsert path (Phase 1.1.5) continues to run normally.

## D. Tenant + source isolation (query model)

Reconciliation state is per `(tenant_code, source_type)`. The seen-set
is never global; ID collisions across tenants or across source types are
impossible by construction because the key is composite.

Effective keys:
- Header reconciliation key: `(tenant_code, source_type, source_document_id)`.
- Line reconciliation key: `(tenant_code, source_type, source_document_id, source_line_id)`.

Tenant is always `ctx.tenantCode` resolved server-side from N3 BasicInfo
/ JWT (`resolveTenantContext`), never from the browser. All queries
below are additive on top of existing indexes (already tenant-scoped).

```sql
-- 1. Candidates missing from this run's seen-set (per source).
SELECT DISTINCT n3_document_id
FROM   {line_table}
WHERE  tenant_code = :tenant
  AND  is_deleted_in_source = false
  AND  last_seen_at < :run_started_at
  AND  n3_document_id NOT IN (:seen_doc_ids_for_this_source);
--     :line_table is sales_invoice_line_snapshots  when source_type='invoice'
--                    delivery_order_line_snapshots when source_type='delivery_order'

-- 2. Confirmed 404 -> mark lines deleted.
UPDATE {line_table}
SET    is_deleted_in_source = true,
       document_status      = 'Deleted',
       last_synced_at       = now()
WHERE  tenant_code    = :tenant
  AND  n3_document_id = :doc_id;

-- 3. Invalidate events for that (tenant, source_type, document).
UPDATE subscription_renewal_events
SET    is_source_void = true
WHERE  tenant_code       = :tenant
  AND  source_type       = :source_type
  AND  source_document_id = :doc_id;

-- 4. Missing detail-line (header active, complete detail response).
--    Same shape, keyed on (n3_document_id, n3_line_id NOT IN :seen_line_ids).
UPDATE subscription_renewal_events
SET    is_source_void = true
WHERE  tenant_code        = :tenant
  AND  source_type        = :source_type
  AND  source_document_id = :doc_id
  AND  source_line_id     = :line_id;

-- 5. Rebuild: unchanged from Phase 1.1.5 — already filters
--    is_source_void=false and scopes by tenant_code.
```

The existing composite unique indexes on `*_line_snapshots
(tenant_code, n3_document_id, n3_line_id)` and on
`subscription_renewal_events (tenant_code, source_document_id,
source_line_id)` are already tenant-scoped. No new index required for
correctness; an optional partial index on
`(tenant_code, is_deleted_in_source) WHERE is_deleted_in_source=false`
can be added later for scale.

## E. Concurrency model

**Recommendation: A + C** (per-tenant lease already exists; add the
optimistic timestamp guard). No B token needed.

- **A. Per-tenant advisory lease** — reuse existing `sync_locks` row
  keyed by `(tenant_code, snapshot_type='contract')`. Subscription
  reconciliation runs inside the same lease as the sync itself, so a
  second manual click while a run is live returns 409 with `activeLock`
  and the Admin console already renders it. No change required.
- **C. Optimistic timestamp guard** — every deletion mark carries
  `last_seen_at < :run_started_at` in its `WHERE`. If a newer run has
  already refreshed the row (upserted a `last_seen_at >= run_started_at`
  for a document that reappeared), the older run's UPDATE affects zero
  rows and cannot resurrect a deletion.
- Lock timeout / abandonment: existing 10-minute lease + heartbeat
  covers this; Phase 1.1.1 recover-stale endpoint stays as the manual
  escape hatch.
- Second manual sync: rejected (409). Not queued in this phase.
- Admin console: already shows "sync already running" from the 409
  payload; extend the reconciliation banner with `skipped-unsafe`
  reason when the full-scan proof fails (§C).

This blocks the failure mode: Run A (older inventory) can never
overwrite Run B's newer result because A cannot even start while B holds
the lease, and after B releases, A's guarded UPDATEs no-op on rows B
already refreshed.

## F. Unified eligibility state table

Conceptual model layered on the existing columns — no new column this
phase.

| Reason              | Kind        | Line snapshot state                                | Event `is_source_void` | Fallback allowed | Auto-reactivate |
| ------------------- | ----------- | -------------------------------------------------- | ---------------------- | ---------------- | --------------- |
| ACTIVE              | eligible    | `document_status=Active`, `is_deleted_in_source=false` | false              | n/a              | yes             |
| CANCELLED           | permanent   | `document_status=Cancelled`, `is_void=true`         | true                   | yes              | yes (uncancel)  |
| DELETED             | permanent   | `document_status=Deleted`, `is_deleted_in_source=true` | true                | yes              | yes (rare N3 restore) |
| REMOVED_LINE        | permanent   | line row `is_deleted_in_source=true`                | true (that line)       | yes (other lines) | yes if same immutable line id returns |
| REPLACED_LINE       | permanent   | old line: `is_deleted_in_source=true`; new line: fresh upsert | old: true; new: false | yes | new event supersedes |
| MAPPING_REMOVED     | permanent*  | line untouched                                      | true (existing events) | yes              | manual remap    |
| MAPPING_CHANGED     | permanent*  | line untouched                                      | true (old category)    | yes              | new-category event on next sync |
| UNKNOWN_TEMPORARY   | reversible  | unchanged                                           | unchanged              | n/a              | yes             |
| PERMISSION_ERROR    | reversible  | unchanged                                           | unchanged              | n/a              | yes             |
| API_FAILURE         | reversible  | unchanged                                           | unchanged              | n/a              | yes             |

Rules:
- `is_source_void=true` continues to mean **permanently ineligible for
  entitlement selection this run**. Reversibility comes from the
  next sync re-emitting `is_source_void=false` on a fresh upsert.
- Deletion / removed-line reasons are represented through existing
  snapshot fields (`document_status`, `is_deleted_in_source`,
  `is_void_source`) plus `is_source_void` on events. No new column.
- `UNKNOWN_TEMPORARY`, `PERMISSION_ERROR`, `API_FAILURE` **never**
  invalidate entitlement — they exit the reconciliation path before any
  UPDATE.
- Mapping-driven reasons (`MAPPING_REMOVED`, `MAPPING_CHANGED`) are
  already handled by Phase 1.1.4 — noted here for completeness; not
  changed in 1.1.6.
- An explicit `source_ineligibility_reason` text column is **deferred**;
  it is helpful for observability but not required for correctness and
  we prefer to avoid a migration until we're sure of the enum values.

## G. Missing detail-line reconciliation flow

For each header where the detail fetch succeeded (`code==="0000"`,
HTTP 200, `itemDetails` parsed):
1. Build `seen_line_ids = { n3_line_id for line in itemDetails }`.
2. Query `{line_table}` for lines with the same
   `(tenant_code, n3_document_id)` whose `n3_line_id NOT IN
   seen_line_ids` and `last_seen_at < run_started_at`.
3. UPDATE those rows: `is_deleted_in_source=true`,
   `document_status='Deleted'` (line-level), `last_synced_at=now()`.
4. UPDATE `subscription_renewal_events` matching
   `(tenant_code, source_type, source_document_id, source_line_id)` →
   `is_source_void=true`. Other lines under the same header are
   untouched.
5. If the same immutable `n3_line_id` returns in a future sync, the
   normal upsert path re-emits `is_source_void=false` and clears
   `is_deleted_in_source=false`. Reactivation is automatic.

Case matrix:
- Quantity changed → normal upsert; no reconciliation.
- Stock changed on same line id → normal upsert (line row's
  `stock_code` updates); events for that line id are re-emitted.
  Old-mapping event stays under the old line id only if N3 assigned a
  new line id (see next).
- Old line removed and new line id created → old id path §G.4; new id
  produces a fresh event via upsert.
- Customer changed at header level → §H covers this: the new event
  moves the subscription under the new
  `(n3_customer_id, category, n3_stock_id)` identity; the old-identity
  subscription becomes orphaned and is deactivated by
  `rebuildCurrentSnapshots`.
- Line no longer matches a renewal mapping → not a deletion; falls
  under Phase 1.1.4 mapping-change semantics; no reconciliation action.
- Mapping removed after historical event → no line change; existing
  events remain (`is_source_void` unchanged); rebuild will still pick
  them up. Explicit mapping-driven invalidation is out of scope for
  1.1.6.

## H. DO ↔ SINV interaction

- **Provenance**: unknown until §B.5 probe. Registry does not currently
  expose a `fromDocId`. Assume "no explicit link" for planning.
- **Deduplication today**: none. `subscription_renewal_events` treats
  invoice and delivery_order as independent sources; rebuild's "latest
  valid event wins" ordering is by `source_document_date DESC`, so
  whichever is newest for a given
  `(customer, category, stock)` identity is chosen.
- Cases:
  - DO deleted, SINV valid → DO events void; SINV events win. Correct
    without transfer-awareness.
  - SINV cancelled, DO valid → SINV events void (Phase 1.1.5); DO wins.
  - Both deleted → identity orphaned; subscription → Inactive.
  - Newer source invalid, older valid → older is picked automatically
    because it now has the max date among non-void events.
- **Verdict**: "latest valid event wins" is sufficient for 1.1.6.
  Transfer-aware deduplication is deferred; revisit only if §B.5 shows
  a reliable provenance field AND live data shows double-counting.

## I. Updated implementation sequence

### Phase 1.1.6a — probes + typed HTTP errors (SAFE, no behaviour change)

- **File** `src/lib/qne/sync/n3.server.ts`
  - Add `class N3HttpError extends Error { status: number; envelopeCode?: string }`.
  - `n3Fetch` throws `N3HttpError` on non-2xx (status attached) and on
    `code !== "0000"` envelopes (status 200 + `envelopeCode`).
- **New route** `src/routes/api/diagnostics/lifecycle-probe.ts`
  (admin-only): given a `source_type` + `n3_document_id`, calls
  `GET /{Resource}/{key}` and returns the raw HTTP status + envelope
  code — for the §B probes only, never writes.
- **No functional change** to sync or entitlement.
- Feature flag: none needed; new class + new diag route only.
- Rollback: revert the two files.
- Automated tests:
  - `N3HttpError.status` set on `404`, `401`, `500` mocks.
  - `code !== "0000"` envelope surfaces `envelopeCode`.
- Live acceptance: probe `M1S2605009` (deleted) and `M1S2512026b`
  (cancelled); expect 404 and 200/`isCancelled=true` respectively.

### Phase 1.1.6b — gated reconciliation + telemetry (BUILD)

- **Files**
  - `src/lib/qne/sync/subscription-sync.server.ts` —
    - Capture `runStartedAt` at top of `syncSubscriptionSnapshots`.
    - In `syncSourceDetails`: collect `seenDocIds: Set<string>` and
      per-doc `seenLineIds: Map<docId, Set<lineId>>` during the loop.
      Track `listScanHealthy: boolean` (no throws, `total` matches,
      no `$filter`, header count sanity).
    - After the loop, if `listScanHealthy`:
      1. Load candidate-missing doc ids per source (§D query 1).
      2. For each candidate, `n3Get(...)`; on
         `N3HttpError.status === 404` (or matching envelope), apply §D
         queries 2 + 3. On any other error, increment
         `reconciliation.transient` and continue.
      3. For each header with successful detail this run, apply the
         missing-line reconciliation (§G) using `seenLineIds`.
    - Emit counters: `reconciliation.checked`, `.confirmedDeleted`,
      `.confirmedLineRemoved`, `.transient`, `.skippedUnsafe`,
      `.skippedReason`.
  - `src/lib/qne/sync/log.server.ts` — extend `counters.details`
    typing for the new block (no schema change; JSONB column).
  - `src/routes/admin.snapshots.tsx` — banner when `skippedUnsafe>0`
    with the reason; show the four counters.
- **Migrations**: none required. Existing columns
  (`is_deleted_in_source`, `document_status`, `is_source_void`,
  `last_seen_at`) are sufficient.
- **Backfill for existing stale docs (e.g. `M1S2605009`)**: none
  required — the first successful reconciliation run marks them
  automatically. A one-shot admin diagnostic (reusing §I.a's route) can
  confirm/mark ahead of the next full sync if desired.
- **Feature flag**: `RECONCILIATION_ENABLED` env-guarded default
  `true`; flip to `false` to fully disable §I.b behaviour and revert to
  Phase 1.1.5 semantics without a code change.
- **Concurrency**: reuses existing subscription lease; no new lock.
- **Rollback**: unset the flag or revert the file.
- **Automated tests**:
  - header-cancelled → event void (regression from 1.1.5).
  - header-deleted (mock 404) → event void, sub deactivated.
  - header-transient (mock 500) → no state change; `transient++`.
  - header-active with line removed → only that line's event void.
  - list truncated (`rows.length < total` on final page) →
    reconciliation skipped, `skippedUnsafe=1`.
  - list dropped 30% vs prev run → skipped-unsafe.
  - Run A + Run B concurrent → second returns 409.
  - Timestamp guard: mark then reappear same run → no resurrection.
  - Same sync run twice → identical result (idempotent).
  - Cross-tenant isolation: seeding tenant X does not touch tenant Y.
  - Cross-source isolation: SINV id equal to DO id (unlikely but
    possible) — each reconciled only against its own source.
- **Live acceptance (700-K051 tenant)**:
  - `M1S2512026b` remains cancelled fallback / Inactive.
  - `M1S2605009` becomes deleted → Maintenance falls back or Inactive.
  - Delete a DO with no SINV twin → deactivates.
  - Delete a DO after SINV transfer → SINV keeps entitlement.
  - 401 injected mid-run → reconciliation skipped, no revocation.

## J. Required acceptance matrix (mapped)

| # | Case                                     | Covered by |
|---|------------------------------------------|------------|
| 1 | Active → Cancelled                       | 1.1.5 regression test |
| 2 | Cancelled → Active                       | line upsert re-emits `is_source_void=false` |
| 3 | Active → Deleted                         | §I.b test "header-deleted" |
| 4 | Deleted/missing → temporarily unavailable | §I.b test "header-transient" |
| 5 | Active header → one line removed         | §G / §I.b test |
| 6 | Removed line → restored (same id)        | §G reactivation via upsert |
| 7 | Old line replaced by new id              | §G "old removed / new upserted" |
| 8 | Customer changed                         | §H; rebuild identity switch |
| 9 | Stock code renamed                       | Phase 1.1.4; unchanged |
| 10 | Mapping removed                          | out of 1.1.6; noted §F |
| 11 | Mapping category changed                 | Phase 1.1.4; unchanged |
| 12 | DO deleted while SINV remains            | §H |
| 13 | SINV cancelled while DO remains          | §H |
| 14 | Incomplete pagination                    | §C "scan complete" proof; skipped-unsafe |
| 15 | API 401                                  | §F reversible; abort source, no revocation |
| 16 | API 404                                  | §I.a typed error; §I.b confirmed delete |
| 17 | API 500                                  | §F reversible; `transient++` |
| 18 | Concurrent Run A / Run B                 | §E; 409 |
| 19 | Manual sync during scheduler run         | §E; 409 |
| 20 | Same full sync twice                     | §I.b idempotency test |
| 21 | No valid fallback                        | rebuild → Inactive (Phase 1.1.5) |
| 22 | Older valid fallback exists              | rebuild "latest non-void wins" |
| 23 | Cross-tenant isolation                   | §D queries all tenant-scoped |
| 24 | Cross-source isolation                   | §D queries include `source_type` |

## K. Migration decision

**None in this phase.** Existing columns cover every required state.
Optional additions (`source_ineligibility_reason`, partial indexes)
deferred to a later phase once live telemetry justifies them.

## L. Estimated steps

- 1.1.6a: ~2 code steps (typed error + probe route) + 1 verification.
- 1.1.6b: ~5 code steps (seen-set collection, health gate, doc
  reconciliation, line reconciliation, telemetry+banner) + tests.

## M. Final recommendation

Proceed as a **split**: ship 1.1.6a first (zero-risk, unlocks the §B
probes with real HTTP status), review the probe output, then implement
1.1.6b behind the `RECONCILIATION_ENABLED` flag. Enabling the flag on
one tenant after live acceptance passes is the safe rollout.

`NOT READY — ADDITIONAL PROBE REQUIRED`
(Blocking probe: §B.1 — 404 vs envelope shape for deleted docs. Ship
1.1.6a to answer it, then this plan flips to `READY FOR PHASE 1.1.6a`
→ `READY FOR PHASE 1.1.6b`.)
