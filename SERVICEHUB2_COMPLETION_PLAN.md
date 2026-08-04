# SERVICEHUB2_COMPLETION_PLAN

## Software Support Production Completion

**Repository:** `mugs-AI/ServiceHub2`  
**Recovery head:** `76a40bfe30a67c46b7bf48826e7b9dfa984896d5`  
**Plan date:** 2026-08-04  
**Plan status:** **FOR OWNER REVIEW — NOT AN AUTHORISED BUILD PROMPT**

---

## 1. Objective

Complete, independently verify and release the **Software ServiceHub** without replacing the accepted N3 foundation and without introducing Equipment ServiceHub scope.

This plan preserves all Software ServiceHub capabilities recoverable from:

- current code and migrations;
- generated routes and types;
- retained `.lovable/plan.md`;
- repository roadmap and commit chronology;
- project control instructions.

Unknown requirements remain visible and require owner correction rather than silent deletion.

---

## 2. Completion principles

1. Resolve P0/P1 before new major features.
2. Use one approved vertical slice per Lovable run.
3. Start each run from the latest formally accepted SHA.
4. Do not regenerate the N3 identity, tenant or snapshot foundation.
5. Every feature includes DB, API, UI, mounting, permissions, tests, build and live verification.
6. Do not accept backend-only or component-only handoffs.
7. Equipment ServiceHub remains Deferred.
8. Do not write a Lovable prompt until the owner approves this plan and the verified baseline.

---

## 3. Preserved Software ServiceHub requirements

### Foundation

- N3 production launch from My Apps;
- dev-only connection path;
- bearer-token authentication;
- server-resolved tenant/company;
- N3 Owner-based administration;
- same-origin server API;
- server-only service-role key;
- immutable N3 identity.

### N3 data and subscription engine

- customer, stock, invoice, delivery order and user access;
- tenant snapshot synchronization;
- sync health, locks and diagnostics;
- subscription categories;
- renewal and ad-hoc mapping;
- quantity-aware renewal duration;
- current entitlement snapshots;
- Active, Due Soon, Overdue and Unknown states;
- due/overdue workspaces.

### Software Service Jobs

- creation and atomic job numbering;
- customer and entitlement snapshotting;
- approval gate;
- assignment and reassignment;
- scheduling and calendar;
- workflow status;
- comments and internal notes;
- audit timeline;
- delete/restore/purge controls where approved;
- support mode;
- travel/arrival/leave;
- work sessions;
- waiting customer;
- waiting vendor and vendor ticket;
- structured work notes;
- attachments;
- completion and acknowledgement;
- follow-up and outstanding issues.

### Administration and reporting

- tenant operational settings;
- GPS rules;
- attachment limits and storage;
- completion/acknowledgement rules;
- report permissions;
- approved reports, print and exports;
- audit logs.

---

## 4. Explicit exclusions

The following are not part of this plan:

- Equipment ServiceHub;
- equipment asset or serial lifecycle;
- preventive maintenance;
- equipment inspections;
- parts, consumables or equipment inventory;
- equipment-specific certificates;
- a redesign of the N3 auth/session foundation;
- replacing immutable N3 identifiers;
- weakening tenant or role gates;
- speculative features not present in approved Software requirements.

---

## 5. Completion work sequence

The sequence is ordered by production risk and dependency. A work package may begin only after its scope is separately approved.

---

## Work Package 0 — Evidence and baseline control

### Goal

Convert the current recovery head into a controlled engineering starting point without changing product behaviour.

### Included

- archive the audit documents;
- identify the last known live deployment and commit, if any;
- recover official brief/starter prompt and missing chat requirements;
- establish an evidence ledger;
- add standard verification scripts;
- add or restore CI;
- document deployment configuration without exposing secrets.

### Required repository outcomes

- `lint` script;
- `typecheck` script using `tsc --noEmit`;
- `test` script using Vitest;
- `build` script;
- CI workflow running all four;
- branch/head/deployment traceability.

### Acceptance

- clean install succeeds;
- lint passes;
- typecheck passes;
- tests pass;
- production build passes;
- CI status is attached to the exact SHA;
- no application behaviour changes.

### Exit gate

A formally accepted control baseline exists.

---

## Work Package 1 — Job Detail operational vertical

### Goal

Complete the latest rejected handoff by mounting the existing operational panels into Job Detail.

### Included

- import and render `FieldOperationsPanel`;
- import and render `AttachmentsPanel`;
- import and render `CompletionPanel`;
- add required Job Detail state/props;
- coordinate attachment count and completion readiness;
- refresh Job Detail after mutations;
- show correct locked, deleted, pending-approval and completed states;
- ensure mobile-first layout;
- preserve existing core Job Detail functions.

### Database

No broad migration expected. Only targeted correction if a required field/constraint is proven missing.

### API

Use existing endpoints, repairing only verified defects:

- `GET/POST /api/workspace/jobs/$jobId/field`
- `GET/POST /api/workspace/jobs/$jobId/work-notes`
- `GET/POST/DELETE /api/workspace/jobs/$jobId/attachments`
- `GET/POST /api/workspace/jobs/$jobId/complete`

### Permissions

- Owner/Admin may perform authorised actions;
- assigned technician may perform field/completion actions;
- unassigned Normal User is denied operational mutation;
- pending approval/deleted/completed locks are server enforced;
- every query is tenant-scoped.

### Tests

- component mount smoke test;
- assigned technician vs unassigned user;
- admin override;
- pending/deleted/completed locks;
- travel/remote support-mode behaviour;
- attachment count/readiness;
- completion validation.

### Live acceptance

Perform a full software job:

Create → approve if required → assign → schedule → travel/arrive or remote mode → work session → notes → waiting customer/vendor → attachment → ready → complete → verify immutable snapshot and timeline.

### Exit gate

All three panels are visible and functional on Job Detail. No P1 remains in this vertical.

---

## Work Package 2 — Completion atomicity and data integrity

### Goal

Make final completion a single recoverable operation.

### Required correction

Current completion flow writes:

1. `service_job_completions`;
2. `service_jobs.status/completion_snapshot`;
3. activity log;

as separate operations.

Implement one of:

- preferred: a transaction/RPC that validates and commits all changes atomically;
- acceptable: idempotency key plus explicit recover/reconcile operation proven safe under retry.

### Database

- enforce one final completion per job;
- preserve tenant and job constraints;
- ensure snapshot and status cannot diverge;
- add safe reconciliation for historical partial rows if any.

### Tests

- two concurrent completion requests;
- failure after completion insert;
- failure before status update;
- retry after network interruption;
- already-completed job;
- acknowledgement waiver permissions.

### Live acceptance

Interrupt/retry test demonstrates no stranded job and no duplicate completion.

### Exit gate

Completion is atomic or recoverably idempotent.

---

## Work Package 3 — Tenant settings administration

### Goal

Mount one coherent Software ServiceHub settings experience.

### Included settings sections

- Travel & GPS;
- Attachments & Storage;
- Completion & Acknowledgement;
- Report Access;
- existing Subscription Categories;
- existing Renewal/Ad-hoc Stock Mapping.

### API

Use and verify:

- `/api/settings/tenant`
- `/api/settings/storage`
- `/api/settings/reports`
- existing category/mapping APIs.

### Permissions

- settings page visible only to Owner/Admin;
- server APIs reject Normal User writes;
- tenant setting audit is recorded;
- secrets are never returned.

### Tests

- load and save each section;
- invalid limits;
- role denial;
- tenant separation;
- audit record;
- settings reflected in Job Detail behaviour.

### Live acceptance

Change each setting as Owner, confirm behaviour changes for an assigned technician, and verify a Normal User cannot modify settings.

### Exit gate

All implemented settings APIs have mounted, usable administration UI.

---

## Work Package 4 — Attachment storage decision and completion

### Goal

Remove the current mismatch between advertised storage modes and actual upload behaviour.

### Decision required inside approved scope

Choose exactly one production truth:

#### Option A — Supabase-only release

- freeze `storageMode` to Supabase or Disabled;
- hide unsupported Google Drive, S3 and GCS options;
- label external providers Deferred;
- keep private bucket and signed URLs;
- verify quota, compression, soft delete and availability.

#### Option B — complete approved external provider

- implement provider adapter upload/read/delete;
- implement secure OAuth callback and signed state for Google Drive if selected;
- encrypt provider secrets;
- persist provider metadata;
- route uploads by tenant setting;
- verify migration/retention behaviour.

Do not expose choices that are not operational.

### Tests

- upload, preview and delete;
- storage disabled;
- quota;
- provider switch;
- old-file availability;
- tenant and job access;
- signed URL expiry.

### Exit gate

Displayed storage options exactly match production capability.

---

## Work Package 5 — Reports vertical

### Goal

Deliver the approved Software ServiceHub Reports workspace.

### Included

- `/reports` route;
- report catalogue from the registry;
- server report query APIs;
- role and capability enforcement;
- own/team/all data scopes;
- private note, financial and GPS visibility rules;
- print;
- CSV;
- Excel where approved;
- audit/export metadata;
- navigation entry for permitted users.

### Initial report candidates recoverable from current registry/code

The exact approved list must be reconciled before prompting. Do not invent Equipment reports.

Potential Software reports may include:

- Service Job Register;
- Technician Work Summary;
- Completion Report;
- Entitlement/Due/Overdue report;
- Waiting Customer/Vendor report;
- Attachment/compliance summary.

### Security

Every report query must enforce:

- tenant code on server;
- current role;
- report capability;
- data scope;
- field-level visibility.

### Tests

- each role and scope;
- no cross-tenant rows;
- private/financial/GPS redaction;
- print and export;
- large dataset/paging.

### Live acceptance

Owner configures access; technician sees only authorised reports/data; exports match visible data.

### Exit gate

Reports are mounted, permission-protected and live verified.

---

## Work Package 6 — Remaining requirement reconciliation

### Goal

Resolve requirements not conclusively recoverable from available evidence.

### Items requiring owner confirmation

- exact Quick Job definition and acceptance criteria;
- exact report catalogue;
- whether external storage is release scope;
- fine-grained role model beyond Owner/Admin and Normal User;
- customer-facing visibility/export requirements;
- any historical defects documented only in moved chats;
- production deployment target and release process.

### Rule

This work package is analysis/decision control. It must not become a speculative feature run.

### Exit gate

Every approved Software requirement is classified Required, Deferred or Obsolete with an owner-approved decision.

---

## Work Package 7 — Full production verification

### Goal

Prove the final system, not merely compile it.

### Automated gates

- clean dependency install;
- lint;
- explicit typecheck;
- unit tests;
- integration tests;
- production build;
- migration dry run;
- generated-type parity;
- CI pass.

### Identity and tenant gates

- N3 Path A launch;
- token stripping and session restore;
- invalid/expired token;
- Owner role;
- Normal User role;
- cross-tenant record-ID attempts;
- no browser tenant override;
- no service-role secret in client output.

### Software job regression matrix

- Active entitlement;
- Due Soon entitlement;
- Overdue entitlement;
- no entitlement;
- approval/rejection;
- assign/reassign/claim;
- schedule/reschedule/conflict/unschedule;
- on-site support;
- remote support;
- GPS required/optional/disabled;
- waiting customer;
- waiting vendor/ticket;
- attachments;
- completion acknowledgement;
- admin waiver;
- follow-up;
- delete/restore/purge where approved.

### Snapshot/entitlement matrix

- full sync;
- stale lock recovery;
- new and edited stock mapping;
- quantity 1, integer >1, fractional, zero and negative;
- voided/cancelled/removed lines;
- customer and stock identity refresh;
- due/overdue status.

### Reports matrix

- role permissions;
- scope;
- redaction;
- print/export;
- tenant isolation.

### Operational acceptance record

For every scenario capture:

- commit SHA;
- environment;
- tenant;
- role;
- input data;
- expected result;
- actual result;
- screenshot/recording;
- API/database evidence;
- PASS/FAIL.

### Exit gate

No P0 or P1; only approved P2; release SHA formally accepted.

---

## 6. Dependency order

1. Work Package 0 — control baseline.
2. Work Package 1 — mount operational panels.
3. Work Package 2 — completion atomicity.
4. Work Package 3 — settings UI.
5. Work Package 4 — storage truth.
6. Work Package 5 — reports.
7. Work Package 6 — requirement reconciliation, performed as needed before affected scopes.
8. Work Package 7 — full verification and release.

No package may bypass its predecessor’s unresolved P0/P1 gate.

---

## 7. Frozen functions throughout the plan

- N3 JWT is the user identity source.
- BasicInfo is tenant/company context, not user identity.
- N3 `isOwner` is the standard administrator rule.
- Allowlist fallback remains disabled by default.
- Tenant code is never trusted from the browser.
- Supabase service-role key remains server-only.
- Existing immutable N3 IDs remain canonical.
- Current quantity-aware renewal calculation is preserved unless a test proves a defect.
- Existing mapping upsert on `tenant_code,n3_stock_id` is preserved.
- Accepted core routes remain mounted.
- Equipment ServiceHub remains excluded.

---

## 8. Completion scorecard

A requirement is release-complete only when its row can be marked:

| Gate | Required result |
|---|---|
| Required | Yes |
| Implemented | Yes |
| Database | PASS or Not Applicable |
| Generated types | PASS or Not Applicable |
| API | PASS |
| Tenant isolation | PASS |
| Permission | PASS |
| UI imported | PASS |
| UI mounted | PASS |
| API connected | PASS |
| Automated tests | PASS |
| Lint | PASS |
| Typecheck | PASS |
| Production build | PASS |
| Live acceptance | PASS |
| Defects | No P0/P1 |
| Final status | Verified |

---

## 9. Release definition

ServiceHub2 Software Support Production is complete only when:

1. all approved Software requirements are represented in the scorecard;
2. every required row is Verified;
3. all Equipment requirements are Deferred and isolated;
4. no P0/P1 remains;
5. the production deployment is tied to the accepted SHA;
6. the final post-run audit result is ACCEPTED or ACCEPTED WITH P2;
7. the owner authorises release.

---

## 10. Current single next action

**Review and approve or correct this completion plan together with `VERIFIED_BASELINE_CURRENT.md`.**

Approval of this document does not itself authorise a Lovable prompt. After approval, the controller must propose the bounded scope for Work Package 0 or the first owner-selected vertical and wait for a separate explicit scope approval.
