
# Phase 1.1.6 — Complete Source Document Lifecycle Investigation

Investigation only. No code, schema, or data changes proposed for this phase.
On approval I will persist this report verbatim to `.lovable/plan.md` (that
write is the only file change; it replaces the Phase 1.1.5 report).

## 1. Confirmed facts (verified this turn)

- Live case `M1S2512026b` (cancelled) is correctly handled by Phase 1.1.5:
  header-driven `is_source_void=true` propagation flips the event; rebuild
  falls back or marks Inactive.
- Live case `M1S2605009` (deleted in N3) is NOT handled. DB state today:
  - `sales_invoice_line_snapshots`: `document_status=Active`,
    `is_void=false`, `is_void_source=false`, `is_deleted_in_source=false`,
    `last_seen_at=2026-07-18 09:12` (stale — never refreshed after delete).
  - `subscription_renewal_events` row `d78c7a26…`:
    `is_source_void=false`, `expiry_date=2027-04-30` → still wins the
    rebuild for `700-K051` / Maintenance / `Q-SW-Warranty-Q-Maint`.
- Sync pipeline (`subscription-sync.server.ts`) iterates only headers
  returned by `GET /api/SalesInvoices/List` and `…/DeliveryOrders/List`.
  Deleted documents disappear from those lists, so the header loop never
  visits them, the detail call is never made, the void-propagation block
  at L726 never fires, and `last_seen_at` is never refreshed. The row
  sits frozen at its last pre-delete state forever.
- Cancellation propagation is one-directional (`isVoid` → `true` only) —
  correct per Phase 1.1.5, but does nothing for deletes.

## 2. Root cause of the `M1S2605009` case

Deletion in N3 = record removed from the List endpoint. ServiceHub's
sync is list-driven and has no reconciliation pass over previously-seen
`source_document_id`s. There is currently no code path — anywhere — that
can mark a persisted event or line as void/deleted when its header
stops appearing. Result: any deleted SINV or DO keeps its entitlement.

The same bug applies symmetrically to Delivery Orders and to
detail-line removal within a still-active header (a removed line's
snapshot is never re-visited, and its event stays `is_source_void=false`).

## 3. Uncertain facts (need probe before build)

Endpoint registry only covers `List` / `GetByKey`. Before coding, verify
against the live tenant (read-only, ≤ a few requests):

1. `GET /api/SalesInvoices/{deletedId}` — status code (404? 200 with a
   flag? envelope `code!="0000"`?). Same for `/api/DeliveryOrders/{id}`.
2. Whether the List endpoint exposes an `isDeleted` / `documentStatus`
   / `deletedAt` field for any lifecycle state (spec review).
3. Whether an Audit Trail / change-log endpoint exists in the OpenAPI
   spec (not in current registry — likely no).
4. Whether detail-line `id` is stable across edits (Phase 1.1.2 assumes
   yes; needs one edit+resync probe).
5. Whether DO→SINV transfer exposes a provenance field (`fromDocId`,
   `sourceDocumentId`) on the SINV header/lines.

These five probes are cheap (curl-equivalent) and are prerequisites for
choosing between the deletion-detection options in §5.

## 4. Files & functions in scope

- `src/lib/qne/sync/subscription-sync.server.ts`
  - `syncSubscriptionSnapshots` (L174) — top-level flow.
  - `syncSourceDetails` (L416) — header loop, upsert, void propagation (L726).
  - `rebuildCurrentSnapshots` (L754) — event selection + orphan deactivation.
- `src/lib/qne/endpoints.ts` — endpoint registry (needs no new list
  endpoint for deletion detection; may need audit-trail entry if it exists).
- `src/lib/qne/sync/n3.server.ts` — `n3Get` currently throws on any
  non-2xx; needs a way to distinguish `404` from transient failure.
- Tables: `sales_invoice_line_snapshots`, `delivery_order_line_snapshots`,
  `subscription_renewal_events`, `customer_subscription_snapshots`.
- Existing columns already present and usable: `is_void`,
  `is_void_source`, `is_deleted_in_source`, `document_status`,
  `last_seen_at`, `last_synced_at`, `is_source_void`.

## 5. Deletion-detection options

| Option | Reliability | Cost | Verdict |
| --- | --- | --- | --- |
| A. Explicit N3 field (`isDeleted` on list) | Definitive if it exists | 0 | Adopt only if probe §3.2 confirms. |
| B. Detail 404 after list-miss | Definitive when 404 is distinguishable from 401/5xx | 1 GET per suspected-missing doc | **Recommended primary signal.** |
| C. Full inventory diff (list all IDs, diff against DB) | Definitive | 1 full list scan (already done) | Free reconciliation pass. |
| D. Audit Trail API | Unknown existence | Unknown | Only if §3.3 confirms an endpoint. |
| E. Watermark/tombstone stream | None documented | — | Not available. |

Recommended architecture: **C + B**, gated.
1. After every successful full list-scan, compute the set of
   `source_document_id`s seen this run per source_type.
2. For any persisted event/line snapshot whose id is missing from that
   set AND whose `last_seen_at` is older than the run start, issue a
   single `GET /api/{Resource}/{id}` confirmation call.
3. Only on a confirmed 404 (parsed from `n3.server.ts`) mark the line
   snapshot `is_deleted_in_source=true`, `document_status='Deleted'`,
   and propagate `is_source_void=true` to all matching events. Any
   other status (401, 5xx, network error, non-2xx without 404) is
   treated as "temporarily missing" — leave state untouched, increment
   a `sync_runs` warning counter, do NOT revoke entitlement.
4. Skip the confirmation call entirely if the list-scan itself failed
   or returned a suspiciously low `total` (guard against partial list).

This preserves the invariants in the user's rules (§Part 5.13, §Part 5.15):
temporary unavailability never revokes, partial sync never publishes.

## 6. Lifecycle state table (target behaviour)

| Header state | List | Detail | Line snapshot | Event | Current sub |
| --- | --- | --- | --- | --- | --- |
| Created | ✓ | 200 | upsert Active | insert non-void | Active/Due/Overdue |
| Modified | ✓ | 200 | upsert Active | upsert on same line id | recompute |
| Renamed doc no | ✓ | 200 | upsert (docNo changes) | upsert | recompute |
| Cancelled | ✓ | 200 `isCancelled=true` | upsert Cancelled | propagate void=true | fallback / Inactive |
| Un-cancelled | ✓ | 200 `isCancelled=false` | upsert Active | line-upsert re-emits non-void | recompute |
| Deleted | ✗ | 404 | mark Deleted (after 404 confirm) | propagate void=true | fallback / Inactive |
| Line removed (header active) | ✓ | 200, line absent | mark line Deleted (post-detail reconcile) | void=true for that line id | recompute |
| Line stock changed, same id | ✓ | 200 | upsert new stock_code | upsert (mapping re-evaluated) | recompute |
| Line replaced (new id) | ✓ | 200 | old id: mark Deleted; new id: upsert | old event void=true; new event insert | recompute |
| Customer changed | ✓ | 200 | upsert new customer | new event under new (customer,category,stock) key; old-key sub deactivates | move |
| Temporarily missing (401/5xx) | partial | — | leave; warn | leave | unchanged |

## 7. Schema — additive only (no destructive change)

Already sufficient today; only fill fields that exist:
- `*_line_snapshots.is_deleted_in_source` (bool, exists) — set true only
  on confirmed 404.
- `*_line_snapshots.document_status` (text, exists) — extend accepted
  values: `Active | Cancelled | Deleted`.
- `subscription_renewal_events.is_source_void` (bool, exists) — remains
  the single eligibility flag; `true` means "do not consider".
- `customer_subscription_snapshots.subscription_status` (text, exists) —
  extend accepted values: `Active | Due Soon | Overdue | Inactive`.

Optional (recommended, but can defer): add
`source_last_seen_at timestamptz` on both `*_line_snapshots` explicitly
mirroring `last_seen_at` for the deletion-reconciliation query, plus a
`snapshot_sync_logs.details.reconciliation` block. Not required for
correctness; existing `last_seen_at` is sufficient.

## 8. Risks of naive missing-record detection

- Partial pagination (List truncated by 500-cap or transient 5xx mid-scan)
  would look identical to a mass delete → mass entitlement revocation.
- Permission change (Administrator loses SINV read) would delete every
  entitlement on the next sync.
- Filter drift (someone adds a date/branch filter to the List call) would
  false-positive every out-of-window doc.

Mitigation: run reconciliation ONLY when the list scan completed cleanly
(no `detailRequestsFailed` from the list generator, `total` matches
`headers.length`, and total headers ≥ some floor vs previous run — the
sync log already tracks this).

## 9. Implementation sequence (subsequent build phase — NOT this turn)

1. Extend `n3.server.ts` to expose HTTP status on failures (typed
   `N3HttpError` with `status`).
2. Add "seen this run" set collection inside `syncSourceDetails`.
3. After the header loop, run a reconciliation pass per source_type:
   query `*_line_snapshots` for rows whose `n3_document_id NOT IN seen`
   and `last_seen_at < runStart`; for each unique doc id, issue one
   `n3Get`; on `N3HttpError(404)` update line rows + propagate
   `is_source_void=true` to events; on any other error, log and skip.
4. Gate the pass on list-scan health (see §8).
5. Extend `rebuildCurrentSnapshots` — no logic change; it already
   respects `is_source_void=false` and deactivates orphans.
6. Extend `snapshot_sync_logs` counters:
   `reconciliation.checked`, `.confirmedDeleted`, `.transient`,
   `.skippedUnsafe`.
7. Admin console: surface the four counters + a warning banner when
   reconciliation is skipped for safety.

## 10. Test matrix

Automated (unit / integration where possible):
- header-cancelled → event void, sub deactivated (regression).
- header-deleted (mock 404) → event void, sub deactivated.
- header-transient (mock 500) → no state change.
- header-active, line removed → only that line's event voided.
- list scan truncated → reconciliation skipped, warning counter set.
- repeat sync → identical result.

Live acceptance (700-K051 tenant):
- `M1S2512026b` remains cancelled fallback (Phase 1.1.5 regression).
- `M1S2605009` becomes deleted → Maintenance falls back or Inactive.
- Restore/undelete of a doc (if N3 supports) → entitlement returns.
- Delete a DO with no SINV twin → deactivates.
- Delete a DO after SINV transfer → SINV keeps entitlement.

## 11. Rollback

Reconciliation is additive and gated. Rollback = feature-flag the
reconciliation pass off; existing behaviour (Phase 1.1.5) is unchanged.
No destructive migration proposed, so no data restore is needed.

## 12. Recommendation

**Split into two implementation phases.**

- **Phase 1.1.6a — Probes & typed HTTP errors (small).** Confirm §3
  facts against live N3; introduce `N3HttpError` with `status`. No
  behavioural change. ~2 steps.
- **Phase 1.1.6b — Reconciliation pass + admin telemetry (medium).**
  Add gated deletion-reconciliation, extend counters, add banner.
  ~6 steps.

One-phase delivery is possible but risky: without §3 probes we may
mis-code the 404 shape or miss an official `isDeleted` field and ship a
reconciliation pass that either under-detects or, worse, over-revokes.
Two phases keep credit spend low and let live probe results shape the
build.
