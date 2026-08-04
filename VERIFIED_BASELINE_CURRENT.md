# VERIFIED_BASELINE_CURRENT

## ServiceHub2 — Recovery and Evidence Audit

**Repository:** `mugs-AI/ServiceHub2`  
**Branch:** `main`  
**WP0A-R reconciliation input:** `9cdd6f93ca85c0d0d57bfddbdca2f54da166d93f` (current canonical `main` HEAD; not an accepted production baseline)  
**Audited head (prior audited recovery head):** `76a40bfe30a67c46b7bf48826e7b9dfa984896d5`  
**Head message:** `Added Job Detail panels`  
**Audit date:** 2026-08-04 (Asia/Kuala_Lumpur)  
**Baseline decision:** **NOT ACCEPTED FOR PRODUCTION**  
**Latest Lovable run result:** **REJECTED**

---

## 0. WP0A-R baseline reconciliation (Correction R1)

**WP0A-R reconciliation input:** `9cdd6f93ca85c0d0d57bfddbdca2f54da166d93f` (current canonical `main` HEAD)  
**Prior audited recovery head:** `76a40bfe30a67c46b7bf48826e7b9dfa984896d5` — `Added Job Detail panels` (its rejected Job Detail-panel finding is preserved in full)  
**Inherited generated-file commit:** `27d243ce37f38117f518769f651971ec16642998`

- `9cdd6f93ca85c0d0d57bfddbdca2f54da166d93f` is the WP0A-R reconciliation input.
- It is **not** an accepted production baseline and ServiceHub2 is **not** production-complete.
- Its only tree difference from `76a40bfe30a67c46b7bf48826e7b9dfa984896d5` is the inherited 10-line generated TanStack Start registration block in `src/routeTree.gen.ts` (10 additions, 0 deletions, no route added or removed).
- The resulting WP0A-R SHA may become the first controlled engineering baseline **only** after all WP0A-R gates pass and the project owner formally accepts it.

### Recovery-input exception (Correction R2)

> Because no formally accepted engineering baseline existed before WP0A-R, `main@9cdd6f93ca85c0d0d57bfddbdca2f54da166d93f` is authorised as a one-time reconciliation input. This authorisation does not accept its Software ServiceHub product implementation. Only the resulting WP0A-R SHA may be proposed for formal controlled-baseline acceptance after every WP0A-R gate passes.

### Rejected predecessor run record (Correction R5)

- The predecessor WP0A run detected an input-SHA/branch mismatch.
- `27d243ce37f38117f518769f651971ec16642998` contained the inherited generated registration block.
- `9cdd6f93ca85c0d0d57bfddbdca2f54da166d93f` added no file delta.
- The safety stop was correct.
- That run remains formally `REJECTED`.
- No WP0A deliverable was completed by it.

---

## 1. Audit mandate

This audit inspected the current GitHub implementation against retained Lovable evidence and commit claims. It did not accept a feature because a file exists.

The audit checked, where evidence was available:

- active branch and latest commits;
- route generation;
- root mounting and application navigation;
- UI imports and rendering;
- API connections;
- server-side identity, tenant and administrator gates;
- migrations;
- generated Supabase types;
- selected tests;
- package scripts;
- GitHub status/workflow evidence;
- retained investigation notes in `.lovable/plan.md`.

---

## 2. Evidence limitations

### Available

- current GitHub code on `main`;
- commit history and diffs;
- migrations and generated types;
- package scripts;
- retained `.lovable/plan.md`;
- Lovable commit messages and edit metadata.

### Not available or not reproducible in this audit

- an addressable archive of every moved ServiceHub2 chat;
- an official Development Brief or Starter Prompt stored in the repository;
- deployed Lovable URL tied to `76a40bfe`;
- production environment variable inventory;
- live N3 test tenant credentials;
- live Supabase schema/migration ledger;
- CI workflow runs for the audited head;
- reproducible command output for lint, typecheck, tests or production build.

Where those inputs were unavailable, the status is **Unknown** or **Not Verified**, not assumed complete.

---

## 3. GitHub state

| Item | Finding | Classification |
|---|---|---|
| Repository | `mugs-AI/ServiceHub2` | Verified |
| Default/active branch | `main` | Verified |
| Audited head | `76a40bfe30a67c46b7bf48826e7b9dfa984896d5` | Verified |
| Latest message | `Added Job Detail panels` | Verified |
| Other active branch found | None in branch search | Verified within connector result |
| Commit status checks | No combined statuses returned | Not Verified |
| Workflow runs for head | None returned | Not Verified |
| Pull-request acceptance trail | No relevant PR evidence supplied | Unknown |
| Release tag/release | No release evidence supplied | Unknown |
| Live deployment URL | Not established | Unknown |

Recent implementation sequence observed:

| Commit | Claim |
|---|---|
| `76a40bfe` | Added Job Detail panels |
| `b244d43d` | Added Run 7 field ops & report |
| `bd6d1d92` | Fixed overdue routes & fields |
| `fdd86f80` | Added entitlement screens & sched |
| `56a42c16` | Added dedicated due-overdue screens |
| `2645cfc2` | Fixed entitlement prefill bugs |
| `ea6cb0ec` | Committed build updates |
| `6ad2b177` | Deployed Run 4B+ shared fixes |

Commit labels are treated as claims, not acceptance.

---

## 4. Architecture baseline

### Implemented foundation

- React 19 / TypeScript / Vite / TanStack Start and Router.
- Same-origin `/api/*` backend routes.
- N3 bearer JWT stored client-side and forwarded to server routes.
- Server-side current-user resolution.
- N3 Owner-based ServiceHub Administrator rule.
- Emergency allowlist fallback disabled unless explicitly enabled.
- Server-only Supabase service-role client.
- Tenant-scoped snapshot and operational tables.
- Generated route tree.
- Generated Supabase types.

### Security observations

- `src/lib/qne/session/current-user.server.ts` derives user identity from bearer JWT claims and N3 `/api/Users`.
- Tenant code is resolved from N3 BasicInfo with JWT fallback.
- `requireAdministrator` is server-side.
- Inspected job APIs filter Supabase operations by `tenant_code`.
- `src/integrations/supabase/client.server.ts` loads `SUPABASE_SERVICE_ROLE_KEY` only from server environment.
- Repository `.env` contains the Supabase URL and publishable/anon key, not the service-role key. Committing `.env` is still a P2 configuration-hygiene concern.

No P0 tenant-isolation breach was proven in the inspected paths. This is not equivalent to a full penetration or cross-tenant live test.

---

## 5. Route and mounting evidence

`src/routeTree.gen.ts` registers these principal UI routes:

- `/`
- `/dashboard`
- `/admin/dashboard`
- `/support`
- `/jobs/new`
- `/jobs/pending`
- `/jobs/$jobId`
- `/calendar`
- `/customers`
- `/customers/due-soon`
- `/customers/overdue`
- `/stock`
- `/invoices`
- `/users`
- `/settings`
- `/admin/snapshots`

It also registers the observed job, sync and settings APIs.

`src/routes/__root.tsx` mounts the routed application through `AuthGate`.

`src/components/qne/AuthGate.tsx` exposes:

- Dashboard;
- Workspace;
- Pending Queue;
- Calendar;
- New Service Job;
- administrator tools for snapshots, settings and N3 explorers.

There is no mounted `/reports` workspace route in the generated route tree.

---

## 6. Important module classification

Legend: `R` Required, `I` Implemented, `V` Verified, `P` Partial, `F` Failed, `U` Unknown, `D` Deferred, `O` Obsolete.

| Module / requirement | Required | Current classification | Evidence and finding |
|---|---:|---|---|
| N3 production launch and bearer session | Yes | Implemented / Not Verified | Auth shell and session routes exist; no live Path A evidence tied to head. |
| Server-resolved tenant context | Yes | Implemented / Not Verified | Implemented in `current-user.server.ts`; inspected APIs use `user.tenantCode`; no live cross-tenant evidence. |
| N3 Owner administration | Yes | Implemented / Not Verified | Server owner resolution and `requireAdministrator` exist; no live role matrix. |
| Same-origin N3 proxy | Yes | Implemented / Not Verified | API architecture exists; live upstream behaviour not reproduced. |
| Supabase service-role secrecy | Yes | Implemented / Not Verified | Service-role key is environment-only in server module; deployed bundle not inspected. |
| Customer/stock/invoice/DO/user explorers | Yes | Implemented / Not Verified | Routes and administrator navigation exist; live paging/error states not reproduced. |
| Snapshot sync and diagnostics | Yes | Implemented / Not Verified | Sync APIs and Snapshot Console are mounted; no live full-sync evidence. |
| Subscription categories | Yes | Implemented / Not Verified | Mounted in `/settings`; API exists; no live CRUD evidence. |
| Renewal/ad-hoc stock mappings | Yes | Implemented / Not Verified | Mounted UI/API. Retained 42P10 defect was corrected to `tenant_code,n3_stock_id`; not live verified. |
| Quantity-aware entitlement duration | Yes | Implemented / Not Verified | Current sync uses `computeExpiryForQuantity` and persists `quantity_used`; generated types include it; no migration ledger or live backfill proof. |
| Customer entitlement workspace | Yes | Implemented / Not Verified | Support/customer entitlement routes exist; live data not reproduced. |
| Due Soon and Overdue screens | Yes | Implemented / Not Verified | Dedicated generated routes exist; no live acceptance. |
| User/admin dashboards | Yes | Implemented / Not Verified | Routes mounted and calendar “My Day” integration exists; no live data proof. |
| Service Job creation | Yes | Implemented / Not Verified | `/jobs/new`, POST `/api/workspace/jobs`, atomic job-number RPC and server entitlement gate exist. |
| Service Job list/workspace | Yes | Implemented / Not Verified | Workspace and jobs APIs exist; role/data-scope behaviour not live proven. |
| Job Detail core | Yes | Implemented / Not Verified | Detail, approval, workflow, assignment, schedule, notes, comments, timeline and danger zone are rendered. |
| Assignment | Yes | Implemented / Not Verified | UI and APIs exist; technician is validated against N3 users. |
| Scheduling/calendar | Yes | Implemented / Not Verified | Job schedule API, Calendar route and focused pure tests exist; no conflict/live timezone proof. |
| Approval/rejection | Yes | Implemented / Not Verified | Detail UI and APIs are mounted; no live role acceptance. |
| Field operations backend | Yes | Implemented / Not Verified | migration, state helpers, field API and tests exist. |
| Field Operations panel | Yes | **Partial** | `FieldOperationsPanel.tsx` exists and calls real APIs, but `jobs.$jobId.tsx` does not import or render it. |
| Work sessions and travel/arrival/leave | Yes | **Partial** | data/API/component code exists; user-facing panel is unmounted. |
| Waiting customer/vendor and vendor ticket | Yes | **Partial** | schema/API/component support exists; user-facing field panel is unmounted. |
| Structured work notes | Yes | **Partial** | API/component support exists; panel is unmounted. |
| Attachments UI | Yes | **Partial** | `AttachmentsPanel.tsx` exists and calls attachment/settings APIs, but Job Detail does not render it. |
| Attachment private Supabase storage | Yes | Implemented / Not Verified | signed URLs, upload and soft-delete API exist; live bucket/policy evidence unavailable. |
| External storage providers | Requirement evidence incomplete | **Partial** | settings foundation exists, but upload API always writes to Supabase; S3/GCS explicitly not ready; Google OAuth is not an end-to-end mounted flow. |
| Completion backend | Yes | Implemented / Not Verified | migration and completion API exist. |
| Completion panel | Yes | **Partial** | `CompletionPanel.tsx` exists but is not imported/rendered by Job Detail. |
| Completion atomicity | Yes | **Partial** | completion insert, job status/snapshot update and activity log are separate writes; a mid-flow failure can strand a unique completion row and block retry. |
| Travel/GPS tenant settings | Yes | **Partial** | `/api/settings/tenant` exists; current `/settings` UI does not mount controls. |
| Attachment/storage settings UI | Yes | **Partial** | `/api/settings/storage` exists; current `/settings` UI does not mount controls. |
| Completion/acknowledgement settings UI | Yes | **Partial** | tenant settings API exists; current `/settings` UI does not mount controls. |
| Report registry | Yes | Implemented / Not Verified | registry and role permission table/API exist. |
| Report access settings UI | Yes | **Partial** | API exists; current `/settings` UI does not mount it. |
| Reports workspace | Yes per retained roadmap/requirements | **Failed / Missing** | no generated `/reports` UI route or report runner/export workflow was found. |
| Excel/CSV/print exports | Yes where approved | **Unknown / Missing** | permission flags exist, but no complete mounted reports/export vertical was found. |
| Quick Job mobile flow | Retained requirement | **Unknown / Missing** | `/jobs/new` exists, but no separately proven Quick Job workflow or acceptance evidence was found. |
| Fine-grained operational roles | Requirement evidence incomplete | **Partial** | current shell primarily distinguishes Owner/Admin and Normal User; report roles exist only as registry data. |
| Audit trails | Yes | Implemented / Not Verified | job and settings audit tables/writes exist; completeness and live records not checked. |
| Generated database types | Yes | Implemented / Not Verified | current types include recent report/storage/completion and `quantity_used` fields; live schema parity not established. |
| Automated unit tests | Yes | **Partial** | tests exist for entitlement grouping, scheduling and field rules; no repository test script or run evidence. |
| Lint | Yes | Not Verified | script exists; no run evidence for head. |
| Explicit typecheck | Yes | **Failed gate** | no `typecheck` script in `package.json`; no run evidence. |
| Production build | Yes | Not Verified | `build` script exists; no run evidence for head. |
| CI quality gates | Yes for production control | **Failed gate** | no commit status or workflow run evidence returned for head. |
| Live production acceptance | Yes | **Unknown / Failed gate** | deployment URL and reproducible acceptance session were unavailable. |
| Equipment ServiceHub | No, future remix | Deferred | no Equipment scope is approved for this completion project. |

---

## 7. Retained conversation/investigation reconstruction

The retained `.lovable/plan.md` documents Phase 1.1.6c investigation:

### Quantity ignored in entitlement duration

Historical defect: line quantity was captured in snapshots but omitted from renewal event expiry.

**Current code finding:** corrected in `subscription-sync.server.ts` with:

- `resolveEffectiveQuantity`;
- `computeExpiryForQuantity`;
- `quantity_used`;
- quantity skip metrics;
- renewal event upsert.

**Status:** Implemented, not live verified. Do not reopen as a new feature unless live evidence fails.

### Mapping could not be saved

Historical defect: API upserted on `(tenant_code, stock_code)` after that unique constraint was removed.

**Current code finding:** corrected in `api/settings/stock-mappings.ts` to:

- look up immutable `n3_stock_id`;
- reject missing ID with actionable 409;
- upsert on `(tenant_code,n3_stock_id)`;
- return database error detail.

**Status:** Implemented, not live verified.

### Snapshot UI follow-ups

Historical requests for red in-progress styling are present in current `admin.snapshots.tsx`.

**Status:** Implemented, not live verified.

### Remaining conversation evidence

No complete addressable export of all moved ServiceHub2 conversations was available to this audit. Requirements not recoverable from code, retained plan, README, commit chronology or project instructions remain Unknown and must not be silently dropped.

---

## 8. Defect register

### P0 defects

**None proven by the available static evidence.**

This does not close tenant isolation or secrets. Those gates remain not live verified.

### P1 defects

| ID | Defect | Evidence | Required outcome |
|---|---|---|---|
| P1-001 | Field Operations panel is not mounted. | Component exists; `jobs.$jobId.tsx` has no import/render. | Import, render, permission-lock and live verify. |
| P1-002 | Attachments panel is not mounted. | Component exists; Job Detail has no import/render. | Mount complete attachment workflow and verify signed URL/upload/delete. |
| P1-003 | Completion panel is not mounted. | Component exists; Job Detail has no import/render. | Mount completion workflow and verify role/ack rules. |
| P1-004 | Run 7 tenant/storage/completion settings have no mounted UI. | APIs exist; `settings.tsx` only mounts categories, stock mappings and allowlist. | Add one coherent settings surface with server-backed controls. |
| P1-005 | Report permission settings have no mounted UI. | API/registry/table exist; no settings panel. | Mount and verify report permission administration. |
| P1-006 | Reports workspace vertical is missing. | No `/reports` route; no complete report runner/export path. | Implement approved Software ServiceHub reports end to end. |
| P1-007 | External storage is not end to end. | Attachment API always uses Supabase bucket; settings advertise other modes. | Either complete provider adapters or explicitly defer/disable unsupported modes. |
| P1-008 (Correction R4: the Completion panel must not become an operational production completion path while completion remains non-atomic — deliver atomicity and panel mounting as one separately approved vertical slice, or verify atomicity first) | Completion write is not atomic. | completion insert, job update and log are separate; unique job completion constraint can block retry after a partial failure. | Move completion to transaction/RPC or add recoverable idempotency. |
| P1-009 | Quality-gate commands/evidence are incomplete. | no `typecheck` or `test` script; no CI/status/workflow evidence. | Add explicit scripts and reproducible command evidence. |
| P1-010 | Live acceptance cannot be reproduced. | no deployed URL/session tied to head. | Establish deployment and role/tenant acceptance evidence. |
| P1-011 | Latest Lovable run is a partial handoff. | commit claims Job Detail panels, but panels are unmounted. | Reject run as baseline; repair only after scope approval. |
| P1-012 | Approved-requirement completeness cannot be conclusively reconciled. | full moved chats/official brief not available. | Owner confirms baseline/plan and supplies corrections before prompt. |

### P2 defects

| ID | Defect | Required outcome |
|---|---|---|
| P2-001 | README roadmap is stale and still lists implemented Service Job functions as deferred. | Replace after acceptance with the verified module matrix. |
| P2-002 | `.lovable/plan.md` ends “READY FOR BUILD” although its principal defects are now implemented. | Archive or mark superseded; retain as evidence. |
| P2-003 | `.env` is committed with public Supabase configuration. | Adopt `.env.example`, deployment-secret documentation and a repository policy. |
| P2-004 | Package scripts do not expose a standard production verification interface. | Add consistent `lint`, `typecheck`, `test`, `build` scripts. |
| P2-005 | Completion API maps `action_taken` from `work_performed`, creating ambiguous duplicate semantics. | Clarify schema/form mapping and test report output. |
| P2-006 | Static comments and roadmap labels do not consistently reflect Software-only production scope. | Normalize documentation after baseline acceptance. |

---

## 9. Latest Lovable run audit

### Claimed run

`76a40bfe` — `Added Job Detail panels`

### Changed items observed

- added `AttachmentsPanel.tsx`;
- added `CompletionPanel.tsx`;
- added `FieldOperationsPanel.tsx`;
- added report settings API;
- changed generated route tree;
- changed calendar API.

### Classification

| Item | Result |
|---|---|
| Panel source files | PASS as file implementation |
| Real API calls inside panels | PASS by static inspection |
| Job Detail import | FAIL |
| Job Detail render/mount | FAIL |
| User visibility | FAIL |
| End-to-end live workflow | NOT VERIFIED |
| Report settings route registration | PASS |
| Report settings UI | FAIL |
| Production test/build/live evidence | NOT VERIFIED |

### Defects

- P1-001
- P1-002
- P1-003
- P1-005
- P1-009
- P1-010
- P1-011

### Formal result

# REJECTED

The changed component code may be retained as implementation evidence, but `76a40bfe` is not an accepted production baseline.

---

## 10. Baseline decision

### What may be treated as implemented foundation

- N3 bearer/session architecture;
- server tenant and owner resolution;
- same-origin API pattern;
- snapshot architecture;
- immutable N3 identity corrections;
- quantity-aware subscription code;
- core Service Job creation/detail/assignment/scheduling/approval code;
- field, attachment, completion, settings and report foundations.

### What may not be treated as verified completion

- any unmounted panel;
- settings/report administration added only as APIs;
- reports;
- external storage;
- completion atomicity;
- tests/build/CI;
- live production operation;
- any requirement only asserted by a Lovable report.

### Accepted baseline SHA

**None established by this audit.**

For planning purposes, `76a40bfe` is the **prior audited recovery head** and `9cdd6f93ca85c0d0d57bfddbdca2f54da166d93f` is the **WP0A-R reconciliation input** — neither is an accepted production baseline. Only the resulting WP0A-R SHA may be proposed for formal controlled-baseline acceptance after every WP0A-R gate passes and the project owner formally accepts it.

---

## 10a. Subsequent WP0A run record (Correction R5)

- Input mismatch was detected.
- `27d243ce37f38117f518769f651971ec16642998` contained the inherited generated registration block.
- `9cdd6f93ca85c0d0d57bfddbdca2f54da166d93f` added no file delta.
- The safety stop was correct.
- The run remained formally `REJECTED`.
- No WP0A deliverable was completed.

---

## 11. Release gate

ServiceHub2 must not be released until:

1. every P1 is resolved or formally reclassified by approved scope;
2. required UI is mounted and connected;
3. migrations and generated types are proven deployed and aligned;
4. server role and tenant checks are tested;
5. completion is atomic/recoverable;
6. reports scope is completed or explicitly approved as deferred;
7. explicit lint/typecheck/test/build commands pass;
8. live N3 launch and role workflows pass;
9. cross-tenant negative tests pass;
10. a final SHA is formally accepted.

---

## 12. Audit conclusion

The repository is a substantial but incomplete Software ServiceHub implementation. The core identity and tenant architecture appears intentionally protected in inspected code. The dominant production failure is not absence of code; it is **incomplete vertical integration and missing acceptance evidence**.

No Lovable build prompt is authorised by this document.
