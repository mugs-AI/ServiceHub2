# Package C — points and commission allocation

Date: 01/10/2026. Status: written design for review; conversational scope approved.
Parent: [SSH performance programme](2026-10-01-performance-program-design.md).
Dependency: B supplies normalized evidence and eligibility flags.

## Reward pool and defaults

A case has one configurable points pool and one fixed-MYR commission pool, shared among eligible contributors. RM5 is the owner's example; it is not an instruction to enable RM5 for existing jobs.

Initial rewards are disabled until Admin sets positive values, an effective date and approves activation. Default allocation is Equal Split. Handling-time allocation deducts customer/vendor waiting by default. Points and commission may use different allocation methods; points default to equal split.

FOC classification, when explicitly recorded and approved, may earn configured points with zero commission. No unsupported product, invoice amount or FOC classification may be guessed from a description.

Current SSH supports fixed RM per case. Future ESH product/category/value/percentage rules are reserved extensions, not an implied financial posting or present percentage calculation.

## Allocation settings

| Method | Weight |
| --- | --- |
| Equal split | Equal weight for each eligible contributor |
| Recorded work time | Verified work-interval duration for each eligible contributor |
| Handling time | Verified PIC responsibility duration; Deduct waiting toggle defaults ON |
| Manual percentage | Admin-approved shares totalling 100% |

Handling-time eligible duration is max(0, PIC duration minus the union of customer/vendor waiting overlapping that actor's PIC episodes). ON affects commission calculation, never KPI elapsed totals. OFF uses the full PIC responsibility duration. This toggle has no effect on Equal Split, Recorded Work or Manual Percentage. Recorded work sessions are not subjected to a second automatic waiting deduction.

For a RM5 case, A owns 10 hours with 6 waiting and B owns 8 hours with 2 waiting: weights 4 and 6 give RM2 and RM3. Full-duration KPI ownership remains 10 and 8.

Work/handling-time allocation requires complete evidence for all time-weighted eligible contributors. Missing intervals, conflicting chronology, no positive total weight, or a verified helper without usable time evidence creates a review-required estimate. Do not silently switch methods, assign zero to a missing helper or approve a guessed split. Admin can explicitly choose equal/manual allocation with a recorded reason.

Store money in integer sen and points in hundredth-point units. Divide by exact weights, allocate floor units, then allocate remaining units by largest fractional remainder with stable immutable actor ID as tie-break. Shares must total exactly the job pool, including RM5 split across three people. Never allocate a negative amount.

## Contributors and approval

Eligible contributors can include PICs and helpers who never reassigned the job. Record the supporting substantive action/work evidence and Admin's eligibility decision. Assignment, viewing or incidental comments alone do not guarantee a share.

An Admin review screen shows job/outcome, all candidate contributors, completion actor, PIC/work/waiting history, evidence quality, selected methods, percentages, amounts and exceptions. Excluding or manually adding a contributor requires a reason; additions require an identifiable user and contribution evidence/reference.

Staff may view their own estimated/pending/approved allocations but cannot alter case rates, eligibility, methods or shares. Admin may override before approval with a reason and audit. No public money leaderboard.

A proposal must be recomputed and re-reviewed if its source evidence, outcome, contributor set or draft settings change before approval. Approval snapshots lock the relevant rule version and evidence revision. Concurrent/retried approvals cannot duplicate the pool.

## Eligibility and lifecycle

- Capture prospective eligibility according to the rule version effective at first completion. This avoids assignment-date guesswork and supports a case resolved later.
- Completed with unresolved follow-up: estimate/pending only.
- Resolved with no pending reopen: eligible for Admin reward approval.
- Cancelled/never completed: no automatic reward.
- Reopen before approval: hold the proposal.
- Reopen after approval: flag review and preserve the approved entry. Any correction is an explicit adjustment linked to that entry.
- Later completion cycles do not mint another automatic pool for the same job.
- No automatic retrospective reward accrual for jobs whose first completion predates activation. A separately authorized manual adjustment may be recorded with a reason.

Approved ledger history is immutable. Changes produce linked adjustments or voiding entries with reasons; do not overwrite an approved number. This ledger records entitlement/approval, not actual salary payment or an N3 posting. Payout tracking remains outside C.

## Durable model and atomicity

Use focused operational records rather than treating policy JSON as an approved financial ledger:
- tenant-scoped versioned reward rules: effective time, fixed pools, allocation defaults, waiting option, eligibility/FOC policy, actor and audit;
- monthly staff targets using existing settings conventions where suitable;
- one durable reward claim per tenant/job, with source completion/rule version;
- immutable approval/allocation entries, actor-specific shares and supporting evidence references;
- explicit adjustments and audit events.

The implementation plan selects concrete additive table/RPC names after inspecting current schema and authorization conventions. Do not author a production migration from an unverified backend reference.

Reward approval validates trusted tenant/admin, resolution/reopen state, source revision, rule version, sum constraints and unique job claim in one transaction. Repeated submission of the same approved proposal returns its existing result. Changed payload/source state is rejected for review; no blind retry with new identity.

RLS and explicit grants protect new tables. N3 identity remains the app's server-authoritative identity; do not assume a browser-supplied actor or unrelated Supabase auth.uid maps to it. Sensitive rules/ledger records are exposed only through permitted server operations and role-safe views.

## Staff/admin figures

Staff: own monthly points, approved commission, separately labelled pending estimates and target progress. Admin: approved/pending pool totals, exceptions and contributor allocations. Filter reports by approval month and resolution month using explicit labels; do not sum pending and approved amounts as money earned.

Settings changes create new rule versions and do not recalculate already-approved entries. UI displays the effective date in DD/MM/YYYY.

## Validation

Test exact pool conservation, largest-remainder ties, equal/time/manual methods, waiting ON/OFF, handover while waiting, helpers without PIC, missing evidence, zero weights, invalid percentages, rule-date boundaries, follow-up/reopen eligibility, one pool across cycles, concurrent/idempotent approvals, immutable history, adjustment audit and staff/alien-tenant denial.

Verify server responses, DB constraints/RLS/grants and real approved runtime separately from Git sync. No payout, payroll integration, N3 transaction or historical automatic accrual is part of this package.
