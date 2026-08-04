# LOVABLE_GOVERNANCE

## ServiceHub2 — Software Support Production

**Applies to:** every Lovable investigation, build, repair and verification run  
**Current audited baseline candidate:** `main@9cdd6f93ca85c0d0d57bfddbdca2f54da166d93f` (WP0A-R reconciliation input; prior audited recovery head `main@76a40bfe`)  
**Current prompt state:** **FROZEN — no build prompt approved**

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

## 1. Purpose

This governance prevents ServiceHub2 from being declared complete based on generated files, completion summaries, screenshots or successful builds that do not prove the production workflow.

Lovable is an implementation tool. It is not the acceptance authority.

---

## 2. Non-negotiable rules

1. **Inspect GitHub first.** Before any new prompt, inspect the active branch, head SHA, recent commits, migrations, generated types, route tree, mounted UI, API handlers and tests.
2. **Claims are not proof.** Treat every Lovable report as an assertion to be independently verified.
3. **File existence is not completion.** A component must be imported, mounted, reachable, visible, API-connected and permission-protected.
4. **Build success is not functionality.** Lint, test, typecheck and build are gates, not live acceptance.
5. **One complete vertical slice per run.** Database → API → UI → route mounting → permissions → tests → build → live verification.
6. **No partial handoff.** “Backend now, UI next run” and “component created but not mounted” are rejected.
7. **Protect the accepted baseline.** Start from the latest formally accepted commit only.
8. **No unresolved P0 or P1 before major feature work.**
9. **Software only.** Equipment ServiceHub is a separate future remix.
10. **One next action.** Do not present competing prompts or parallel build options.

---

## 3. Pre-prompt approval gate

Before drafting a Lovable prompt, present a scope proposal containing exactly these sections:

### Included scope

A single business vertical with named requirements and repository areas.

### Excluded scope

Everything not required for that vertical, including Equipment ServiceHub.

### Frozen functions

Identity, tenant isolation, auth, secrets, accepted N3 endpoints, accepted snapshot behaviour and other protected capabilities.

### Acceptance checks

Concrete testable checks covering:

- migration and generated types;
- API request/response;
- tenant and role protection;
- UI import and route mounting;
- loading, error and empty states;
- tests, lint, typecheck and production build;
- live Owner/Admin and Normal User paths;
- negative and cross-tenant checks.

A prompt may be written only after explicit user approval of that scope.

---

## 4. Prompt construction requirements

Every approved prompt must:

1. name the exact accepted baseline SHA;
2. require inspection before edits;
3. list included and excluded files/functions;
4. prohibit broad regeneration;
5. require one complete vertical slice;
6. require migrations to be idempotent and reviewed;
7. require generated Supabase types to be refreshed;
8. require server-derived tenant context;
9. require server-side permission enforcement;
10. require existing working routes to remain mounted;
11. require focused regression tests;
12. require explicit `lint`, `typecheck`, `test` and production `build` commands;
13. require live verification evidence;
14. require a changed-file list and commit SHA;
15. prohibit claiming completion for unmounted UI or unexecuted verification.

---

## 5. Required Lovable completion report

A valid completion report must include:

- baseline SHA;
- resulting SHA;
- changed files;
- migrations added or changed;
- generated types changed;
- routes added or changed;
- where each UI component is imported;
- where each UI component is rendered;
- exact API endpoint used by each UI surface;
- server permission rule;
- tenant-scoping rule;
- test files and test cases;
- lint result;
- typecheck result;
- test result;
- production-build result;
- live URL and acceptance steps;
- known limitations;
- screenshots tied to the resulting commit.

Omitting any item makes the report incomplete evidence.

---

## 6. Independent post-run audit protocol

After every Lovable run:

### A. Establish repository state

- identify branch and head SHA;
- compare against the last accepted SHA;
- enumerate changed files;
- inspect migrations and generated types;
- inspect route-tree changes.

### B. Verify implementation layers

For every claimed feature:

1. database object exists;
2. migration is safe and applied;
3. types include the object;
4. API handler exists;
5. API uses server-resolved tenant context;
6. API enforces role/ownership;
7. UI imports the feature;
8. UI renders on a reachable route;
9. UI calls the intended API;
10. live workflow works.

### C. Classify each claimed item

- PASS
- PARTIAL
- FAIL
- NOT VERIFIED
- REGRESSION

### D. Classify every defect

- P0
- P1
- P2

### E. Result the run

| Result | Rule |
|---|---|
| ACCEPTED | All required checks pass; no unresolved defect. |
| ACCEPTED WITH P2 | All required workflows pass; only documented P2 defects remain. |
| PARTIALLY ACCEPTED | A separable subset is proven and may be retained, but the run did not complete all approved scope. |
| REJECTED | Any P0/P1, regression, unmounted required UI, missing permission enforcement, incomplete vertical slice or unverifiable production claim remains. |

A rejected run may contain reusable code, but its head is not an accepted production baseline.

---

## 7. Quality gates

### Gate G0 — Source recovery

Required inputs are identified, conflicts are recorded and unavailable evidence is explicitly marked Unknown.

### Gate G1 — Identity and isolation

Must pass before feature acceptance:

- N3 bearer identity is authoritative;
- tenant is resolved server-side;
- Owner/Admin is resolved server-side;
- service-role key remains server-only;
- cross-tenant access is rejected.

### Gate G2 — Data model

- migration reviewed;
- constraints and indexes reviewed;
- generated types match;
- backfill/reconciliation defined;
- rollback or safe-forward strategy defined.

### Gate G3 — API

- valid input;
- tenant filter on every read/write;
- role/ownership enforcement;
- safe error handling;
- audit writes;
- concurrency/idempotency rules.

### Gate G4 — UI and mounting

- import exists;
- component is rendered;
- route is generated and reachable;
- real API is called;
- role and lock states are visible;
- mobile and desktop behaviour checked.

### Gate G5 — Automated verification

Repository scripts must expose, at minimum:

- `lint`
- `typecheck`
- `test`
- `build`

The audited repository currently lacks explicit `typecheck` and `test` scripts. This must be corrected before production release.

### Gate G6 — Live acceptance

Acceptance evidence must state:

- deployed URL;
- commit SHA;
- tenant used;
- role used;
- test data used;
- exact steps;
- expected and actual results;
- screenshot or recording references;
- database/API evidence where relevant.

### Gate G7 — Baseline acceptance

Only a formally accepted SHA may become the next build baseline.

---

## 8. Security and tenant-isolation rules

1. Never accept a browser-supplied tenant code.
2. Every Supabase service-role query must filter by server-resolved `tenant_code`.
3. Record identifiers must be checked together with tenant code.
4. Admin UI hiding is not authorization; the API must enforce the role.
5. N3 user matching must derive from validated bearer claims and N3 user data.
6. Service-role credentials must never be imported into client bundles.
7. Storage signed URLs must be short-lived and tenant/job authorised.
8. Reports must enforce capability and data scope server-side.
9. Completion must be atomic or recoverably idempotent. (Correction R4) The Completion panel must not become an operational production completion path while completion remains non-atomic: the completion-atomicity correction and Completion-panel mounting are either delivered together as one separately approved complete vertical slice, or atomicity is completed and verified before the Completion panel is mounted.
10. Migration uniqueness and conflict keys must match API upsert keys.

---

## 9. Baseline protection

The following foundation is frozen unless a verified defect requires a bounded repair:

- N3 Path A production launch;
- dev-only Path B connect;
- bearer-token session;
- `requireAuthenticatedN3User`;
- `requireAdministrator`;
- N3 Owner as ServiceHub Administrator;
- server-resolved tenant code;
- service-role Supabase access in server-only modules;
- same-origin API pattern;
- immutable N3 identifiers;
- existing accepted snapshot and entitlement data.

Do not regenerate these foundations in a feature prompt.

---

## 10. Prohibited completion language

Lovable reports must not use these statements as substitutes for evidence:

- “implemented” without changed paths;
- “fully functional” without live steps;
- “connected” when the UI is not mounted;
- “secure” without server guard and tenant filters;
- “tests pass” without command output;
- “build succeeds” as proof of workflow;
- “ready for production” without live acceptance.

---

## 11. Governance finding for audited head

### Latest run

`main@76a40bfe` — `Added Job Detail panels`

### Subsequent WP0A run (Correction R5)

`main@9cdd6f9` — WP0A was formally `REJECTED` on an input-SHA/branch mismatch. `27d243c` carried the inherited generated registration block, `9cdd6f9` added no file delta, the safety stop was correct and no WP0A deliverable was completed.

### Independent result

**REJECTED**

### Reason

The three claimed Job Detail panels exist as files but are not imported or rendered by `src/routes/jobs.$jobId.tsx`. Settings/report work is also not a complete mounted vertical slice. This violates the zero-tolerance partial-handoff rule and leaves P1 production blockers.

---

## 11a. Requirement-reconciliation order (Correction R3)

Requirement decisions needed by a work package must be taken **before** that work package:

- external-storage release scope must be decided before Work Package 4;
- the exact report catalogue and report-role decisions must be taken before Work Package 5;
- Work Package 6 must not be interpreted as occurring only after Work Packages 4 and 5; it is performed as needed ahead of every affected scope.

---

## 12. Prompt lock

No Lovable build prompt may be generated until the project owner explicitly approves:

- `VERIFIED_BASELINE_CURRENT.md`; and
- `SERVICEHUB2_COMPLETION_PLAN.md`.
