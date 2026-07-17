
# Customer Sync Immutable-ID Collision — Investigation Report

Investigation only. No code, migrations, or data changes were made.

## 1. Root cause (single, verified)

`syncCustomerSnapshots` loads existing snapshots with an unbounded
`supabaseAdmin.from("customer_snapshots").select(...)` — no `.range()`, no
tenant filter, no pagination loop
(`src/lib/qne/sync/customer-sync.server.ts` lines 86–89).

PostgREST caps a single `select` at the project's default row limit
(1000). The tenant currently has **1,465** rows in `customer_snapshots`
(**801 linked** with `n3_customer_id`, **664 legacy null-id**). So the
in-memory `byId` / `byCode` / `nameToRow` maps are built from at most the
first 1,000 rows returned. Roughly **465 known customers — including
many already-linked ones — are invisible to the matcher.**

When the API stream reaches one of those invisible-but-linked customers:
- `byId.get(n3_customer_id)` → miss (row wasn't loaded)
- `byCode.get(customer_code)` → miss
- name fallback → skipped (only triggers against null-id rows)
- → row is pushed onto the `toInsert` batch
- Postgres rejects it against
  `customer_snapshots_tenant_n3id_uidx (tenant_code, n3_customer_id)`
- The whole batch fails inside the single `insert(toInsert)` call, so
  every subsequent batch is abandoned and the run ends.

This exactly matches the observed pattern: the first batch of ~200 rows
processes, ~15 collide, `insert` throws, sync exits.

## 2. Evidence

- `customer_snapshots` row totals: **total 1465 / linked 801 / null-id 664**.
- Duplicate immutable-ID groups already in DB: **0**
  (`GROUP BY tenant_code, n3_customer_id HAVING count>1` → 0 rows).
  → The database is clean. The collision source is the write payload, not
  pre-existing DB duplicates.
- Duplicate null-id name groups: **0** — the name fallback is not
  creating collisions.
- Last 5 customer sync logs (all `failed`): consistently
  `inserted=0, updated=0, skipped≈185, failed≈15`, error
  `Insert customers failed: duplicate key value violates unique constraint
  "customer_snapshots_tenant_n3id_uidx"`.
- 185 + 15 = 200 = one `BATCH`. Nothing beyond the first batch runs, which
  is why counters look tiny relative to the 1,465-row snapshot store.
- Unique index definition confirmed:
  `UNIQUE (tenant_code, n3_customer_id) WHERE n3_customer_id IS NOT NULL`
  — correct; it is doing its job.

## 3. Pipeline trace (as coded today)

1. `heartbeat("loading existing customer snapshots")`
2. **Bulk load of existing snapshots — capped at 1000 rows, no tenant
   filter, no pagination.** (bug locus)
3. Build `byId`, `byCode`, `nameCounts`, `nameToRow` from that partial set.
4. Iterate N3 pages via `n3IterateList` (this loop *is* paginated correctly).
5. Per row: normalise → dedupe API stream by `n3_customer_id` via
   `seenApiIds` → push to `batch`.
6. When `batch.length === BATCH (200)` → `flush()`.
7. `flush()`:
   - For each incoming row: try byId → byCode → name fallback (null-id
     rows only) → else insert.
   - Executes `supabaseAdmin.from(...).insert(toInsert)` in a single call.
     Any single conflict fails the whole batch.
   - Updates are per-row.
8. Post-pull merge scans for same-ID duplicates (unrelated to this bug).

**Deduplication happens twice:** the API stream is de-duped by
`n3_customer_id` before batching, and the post-pull merge collapses
already-stored duplicates. Neither pass compensates for rows that the
initial existing-snapshot load never saw.

## 4. Answers to the numbered questions

1. **Duplicate `n3_customer_id` in raw API response** — Not the cause.
   `seenApiIds` de-dupes the stream and the observed counter
   `duplicates_from_api_ignored` would surface any. No evidence in logs.
2. **Duplicates introduced after normalisation** — Not observed; the same
   `seenApiIds` guard runs post-normalisation.
3. **Multiple legacy null-id rows resolving to one canonical ID** —
   0 null-id name collisions in DB; not the cause.
4. **Name-fallback creating collisions** — Fallback only runs when both
   ID and Code lookups miss AND the null-id name-key is unique. It writes
   an `update`, not an insert, so it cannot produce the observed
   *insert*-time unique-index violation. Not the cause.
5. **Update of a legacy row to an ID already owned by a canonical row** —
   Would fail as an `update` error, not the observed `Insert customers
   failed`. Not the cause.
6. **Upsert batch containing the same conflict key twice** — Prevented by
   `seenApiIds`. Not the cause.
7. **Wrong conflict target / write ordering** — Insert is a plain
   `.insert()` (not `.upsert()`), so ordering does not matter; the target
   index is correct. Not the cause.
8. **Stale in-memory candidates after a merge** — Merge runs *after* the
   iteration; not implicated.

**The actual mechanism is #9 (unlisted):** the existing-snapshot
in-memory index is truncated at 1000 rows, so ~465 already-linked rows
are treated as new and their inserts collide.

## 5. Failed-identity capture

Cannot enumerate the 15 identities post-hoc: `snapshot_sync_logs.details`
for the failing runs is `null`, and the sync throws before writing the
individual failing rows anywhere. A safe capture strategy is proposed
below (see §7, "Diagnostic step") — no code written yet.

What is verifiable now: the 15 rows are, by construction, the subset of
one 200-row API batch whose `(tenant_code, n3_customer_id)` already
exists in `customer_snapshots` but sits outside the first 1000 rows
returned by the unfiltered existing-snapshot select. Batch order is
determined by N3 API paging order, which is stable — that is why "the
same 15 failures occur across multiple completed runs."

## 6. Why 185 skipped / 15 failed / 0 inserted / 0 updated

- The API stream reaches 200 rows, batch flushes.
- Inside the batch: rows whose IDs *are* in the (partial) `byId` map and
  are byte-identical to storage → `unchanged` → `counters.skipped`
  (185 of them).
- Rows whose IDs are not in the partial map → `toInsert` → single insert
  call → unique-index violation → the `catch` decrements `inserted` and
  increments `failed` by the whole batch's insert count (15).
- The handler then `throw`s, so no further batches run, the post-pull
  merge does not run, and 1,265 rows are simply not processed.

So the counters describe **the first 200 API rows only**, not the tenant.
The snapshot store is *not* partially refreshed after each run — no
inserts or updates commit, because the single failed insert aborts the
whole batch (`toUpdate` runs *after* the failed insert throws).

## 7. Safe repair sequence (proposed, not implemented)

1. **Fix the loader** in `syncCustomerSnapshots`:
   - Add `.eq("tenant_code", tenantCode)` (defence in depth; the sync is
     already tenant-scoped conceptually).
   - Page the select with `.range()` in 1000-row windows until
     exhausted, or switch to keyset pagination on `id`.
   - Only after this: the in-memory `byId` / `byCode` maps are complete
     and every collision resolves to a matched-existing update.
2. **Make the batch resilient**: replace the single `insert(toInsert)`
   with either
   - per-row inserts inside `flush` so one bad row can't sink 199 good
     ones and abort the run, or
   - a proper `upsert` on `(tenant_code, n3_customer_id)` (with a
     separate code-only path for null-id inserts) which is idempotent
     against the same class of miss.
   Prefer per-row inserts for now — an upsert would mask the exact same
   diagnostic signal we relied on to find this bug.
3. **Diagnostic step (optional, run first to confirm)**: temporarily
   log the failing rows into `snapshot_sync_logs.details` before
   rethrowing (`{ collided_ids: [...], sample_codes: [...] }`). Re-run
   sync and confirm every collided ID already exists in DB with a
   `ctid`/`id` matching a row *not* present in the loader's returned
   set (i.e. > 1000 rows into the table). This proves the diagnosis
   before shipping the loader fix.
4. **No data merges required.** Zero DB-side duplicate ID groups; no
   canonical/legacy consolidation is needed for this failure.
5. **Unique constraint is correct** and must stay as-is.
6. **Rows left for manual review**: none from this failure. The 664
   legacy null-id rows are a separate, pre-existing backlog and are not
   the cause here.

## 8. Tests required before another live sync

- Unit: the existing-snapshot loader returns *all* rows for a tenant
  when the store exceeds the PostgREST page cap (simulate ≥1001 rows).
- Unit: `flush()` on a batch containing a row whose `n3_customer_id`
  matches an existing snapshot loaded from page 2 chooses `update`, not
  `insert`.
- Integration (dry-run): after the loader fix, next full sync reports
  `failed=0` and `inserted + updated + skipped == total received`.
- Regression: post-pull duplicate merge still runs (currently
  unreachable because the run aborts early).

## Deliverable

Root cause is a **paginated-load bug**, not a data-model, constraint,
name-fallback, or ordering bug. The database is clean; the sync's
in-memory view of the database is not. Fix the loader (and harden the
batch insert), and the 15 recurring collisions disappear without any
row-level merges.
