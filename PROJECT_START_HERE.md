# PROJECT_START_HERE

## ServiceHub2 — Software Support Production

**Repository:** `mugs-AI/ServiceHub2`  
**Production branch audited:** `main`  
**Audited head:** `76a40bfe30a67c46b7bf48826e7b9dfa984896d5` — `Added Job Detail panels`  
**Audit date:** 2026-08-04 (Asia/Kuala_Lumpur)  
**Control state:** **RECOVERY / EVIDENCE AUDIT — BUILD PROMPTS FROZEN**

---

## 1. Project purpose

ServiceHub2 is the **Software ServiceHub** for N3/QNE AI Cloud Accounting. Its production purpose is to support software-service operations around:

- N3-authenticated tenant and user identity;
- customer, stock, sales invoice, delivery order and user snapshots;
- subscription entitlement calculation and status;
- Software Service Jobs;
- assignment, scheduling, approvals and operational activity;
- software-support field/remote operations;
- work notes, waiting-customer and waiting-vendor handling;
- attachments;
- completion and customer acknowledgement;
- reporting and production control.

This repository must not be remixed into an Equipment ServiceHub while Software ServiceHub production completion is in progress.

---

## 2. Scope boundary

### In scope now — Software ServiceHub

1. N3 launch and authenticated session.
2. Server-resolved tenant context and N3 owner administration.
3. N3 proxy and snapshot synchronization.
4. Subscription categories, stock mappings and entitlement snapshots.
5. Customer entitlement workspaces and due/overdue views.
6. Software Service Job creation, assignment, scheduling and workflow.
7. Approval handling.
8. Software support mode and operational actions.
9. Work sessions, waiting periods, vendor-ticket information and work notes.
10. Attachments and storage controls.
11. Software-service completion and acknowledgement.
12. Reports required by the approved Software ServiceHub requirements.
13. Role, tenant-isolation, audit, test, build and live acceptance gates.

### Explicitly out of scope — future Equipment ServiceHub remix

- equipment asset registers;
- serialised equipment lifecycle;
- preventive maintenance schedules;
- equipment inspections;
- parts consumption and equipment inventory;
- equipment-specific work orders, checklists or certificates;
- equipment telemetry, meter readings or warranty workflows;
- any redesign that replaces the accepted N3 Software ServiceHub foundation.

Equipment-specific work is **Deferred**. Generic shared architecture may later be reused, but no Equipment terminology, schema or workflow is to be introduced into the Software ServiceHub completion baseline without a separate approved decision.

---

## 3. Source-of-truth order

Use this order whenever sources conflict:

1. Reproducible live acceptance evidence.
2. Current GitHub code, migrations, generated types, tests and deployed configuration.
3. Official N3 Development Brief, Starter Prompt and API documentation.
4. `VERIFIED_BASELINE_CURRENT.md` and approved decision records.
5. Approved business requirements.
6. Lovable completion reports, screenshots, historical chats and commit messages as investigation evidence only.

A completion report is a **claim**. A file existing is **not proof** that a feature is usable.

---

## 4. Current recovery finding

The repository contains a large implemented foundation, but it is **not a verified production-complete baseline**.

The latest commit added these component files:

- `src/components/qne/FieldOperationsPanel.tsx`
- `src/components/qne/AttachmentsPanel.tsx`
- `src/components/qne/CompletionPanel.tsx`

However, current `src/routes/jobs.$jobId.tsx` does not import or render those panels. Therefore they are not mounted, visible or proven usable from Job Detail.

Other important partial handoffs include:

- tenant, storage and report-permission APIs without mounted administration UI;
- report registry and permissions without a Reports workspace;
- external storage configuration without end-to-end external-provider upload;
- no reproducible CI, typecheck, test, production-build or live acceptance evidence for the audited head.

The latest Lovable run is therefore formally classified **REJECTED** for production acceptance. See `VERIFIED_BASELINE_CURRENT.md`.

---

## 5. Repository orientation

### Application shell and identity

- `src/routes/__root.tsx`
- `src/components/qne/AuthGate.tsx`
- `src/lib/qne/session/current-user.server.ts`
- `src/routes/api/session/me.ts`
- `src/integrations/supabase/client.server.ts`

### Routes and mounting

- `src/routeTree.gen.ts`
- `src/routes/*.tsx`
- `src/routes/api/**/*.ts`

### N3 and snapshot foundation

- `src/lib/qne/endpoints.ts`
- `src/lib/qne/sync/`
- `src/routes/api/sync/`
- `src/routes/admin.snapshots.tsx`
- `supabase/migrations/`

### Entitlements

- `src/lib/qne/entitlements/`
- `src/lib/qne/sync/subscription-sync.server.ts`
- `src/routes/api/workspace/entitlements.ts`
- `src/routes/customers*.tsx`

### Software Service Jobs

- `src/routes/jobs.new.tsx`
- `src/routes/jobs.pending.tsx`
- `src/routes/jobs.$jobId.tsx`
- `src/routes/api/workspace/jobs*.ts`
- `src/lib/qne/service-jobs/`
- `src/components/qne/*Panel.tsx`

### Settings and reports

- `src/routes/settings.tsx`
- `src/routes/api/settings/`
- `src/lib/qne/reports/registry.ts`

### Generated database contract

- `src/integrations/supabase/types.ts`

---

## 6. Status vocabulary

| Status | Meaning |
|---|---|
| Required | Approved Software ServiceHub capability that must exist. |
| Implemented | Relevant code or migration exists. This does not prove usability. |
| Verified | Reproducible evidence proves the complete workflow at the accepted commit. |
| Partial | Some layers exist, but the vertical slice is incomplete or unproven. |
| Failed | Reproducible evidence shows the requirement does not work. |
| Unknown | Evidence is unavailable or insufficient. |
| Deferred | Intentionally postponed by approved scope. |
| Obsolete | Superseded and must not drive new work. |

### Defect severity

| Severity | Definition |
|---|---|
| P0 | Security, tenant isolation, N3 identity, secrets, destructive data loss or production outage. Stop all feature work. |
| P1 | Required workflow unavailable, incomplete vertical slice, material data-integrity risk, permission failure or production-verification blocker. |
| P2 | Non-blocking usability, maintainability, documentation or cosmetic issue. |

---

## 7. Definition of Done

A user-facing feature is complete only when all are true:

1. required migration is applied;
2. generated types match the deployed schema;
3. server API is implemented;
4. tenant context is server-resolved;
5. permissions are enforced server-side;
6. UI imports the feature;
7. UI renders it on a reachable route;
8. UI calls the real server API;
9. error, empty, loading and permission states work;
10. focused automated tests pass;
11. lint, explicit typecheck and production build pass;
12. live acceptance succeeds for Owner/Admin and Normal User as applicable;
13. cross-tenant negative tests pass;
14. evidence is tied to the accepted commit SHA.

A build report or green compile alone is insufficient.

---

## 8. Frozen functions

Until the verified baseline and completion plan are approved:

- do not regenerate the N3 auth or tenant foundation;
- do not change the owner-based administrator rule;
- do not weaken server-resolved tenant scoping;
- do not expose the Supabase service-role key;
- do not replace accepted snapshot identity with mutable browser values;
- do not redesign the application shell;
- do not introduce Equipment ServiceHub requirements;
- do not prepare or run a new Lovable build prompt.

---

## 9. Required working sequence

1. Read this file.
2. Read `LOVABLE_GOVERNANCE.md`.
3. Read `VERIFIED_BASELINE_CURRENT.md`.
4. Read `SERVICEHUB2_COMPLETION_PLAN.md`.
5. Resolve any disagreement by the source-of-truth order.
6. Do not generate a Lovable prompt until the user explicitly approves the verified baseline and completion plan.
7. After approval, propose one bounded vertical-slice scope and its exclusions.
8. Wait for explicit scope approval before writing the prompt.

---

## 10. Current single next action

**Project owner reviews and either approves or returns corrections to `VERIFIED_BASELINE_CURRENT.md` and `SERVICEHUB2_COMPLETION_PLAN.md`.**
