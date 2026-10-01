# Dashboard, References and Persistent Inquiry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for Native execution or superpowers:subagent-driven-development if the owner selects that method. Implement task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Deliver the approved compact Dashboard, visible/searchable waiting references and a Job Details Inquiry tab that retains its view and remembers user/company preferences.

**Architecture:** Keep the existing server-authoritative job and Inquiry endpoints. Add small preference/state modules and one authenticated Inquiry provider, separate from dynamic tab navigation. Preserve current job lifecycle writes and change only the read projection for Pending references.

**Tech Stack:** Existing React 19, TanStack Router/Start, TypeScript, Radix Popover, Vitest and fixture-only Playwright verification. No new dependency.

**Spec:** ../specs/2026-10-01-dashboard-inquiry-design.md; programme ../specs/2026-10-01-performance-program-design.md.

## Global Constraints

- Spec reviewed through the owner's “continue” at 09:11 Malaysia on 01/10/2026. The Owner approved this plan and Native execution on 01/10/2026; later APPROVE and interruption-recovery instructions retain the same bounded scope.
- Product/repository: SH2.2 ServiceHub / SSH, mugs-AI/ServiceHub2. GitHub/Lovable main remains 7029b09c34e3b3378ed844a82108d89ef6908e9f at planning inspection.
- Spec candidate: 5c7325730af70c597a127b65160862e73664b6db, tree c576806d2a8ae8e2c7172d74114ee5574791748b, draft PR #5.
- Lovable project 9265adcd-acf6-4fdb-a766-3fc21310ee8f; workspace tJObptvCa2MGSCihecnu.
- Read the DirectBuild protocol, SSH adoption, AGENTS.md and approved spec before implementation. Use a clean isolated review branch; never rewrite synced history.
- DD/MM/YYYY and Asia/Kuala_Lumpur for display. At least 44px touch targets. Existing mobile New Job remains reachable.
- Results are cached only in authenticated in-memory session state. Do not store job rows, tokens or grants durably.
- Fresh page/session: restore controls but show Apply filters to load Jobs; no job-list request until Apply.
- Preserve private/GPS/export permissions, current Dashboard count-to-list parity and atomic lifecycle writes.
- No schema, generated backend type, N3 or attachment-provider changes are part of A.
- No public release is claimed from a code merge. Exact candidate integration and publish retain their own review/evidence gates.
- B and C stay in the delivery queue. Their implementation plans follow A and current backend inspection; do not implement reward tables or KPI capture as an incidental part of this plan.

## Review Focus

1. Switching users/company during an in-flight request must not show or save the prior user's results — Task 4/browser case identity-switch-race.
2. Revoked or narrowed Inquiry rights must clear cached rows and remove denied filters/columns — Tasks 3–4/browser case revoked-private-access.
3. Storage denied/corrupt, duplicate/unknown columns and zero selected columns must leave a usable page — Task 3/unit cases storage-failure and empty-selection.
4. Searching a reference in cancellation/reopen queues must preserve tenant, pending-status and existing scope filters — Task 2/route cases request-reference-isolation.
5. Info buttons, long references and the extra Inquiry tab must remain usable at 390px without triggering a card action — Tasks 1, 2 and 5/browser case compact-mobile.

## File Structure

| File | Responsibility |
| --- | --- |
| src/components/qne/dashboard/DashboardInfo.tsx (new) | Reusable accessible [i] popover |
| src/components/qne/dashboard/DashboardPrimitives.tsx | Compact section/card layout with sibling action/info controls |
| src/routes/admin.dashboard.tsx; src/routes/dashboard.tsx | Compact role-specific headers; HealthCard information |
| src/lib/qne/service-jobs/pending-reference-search.ts (new) | Bounded reference search construction and in-memory matching |
| src/components/qne/JobReferences.tsx (new) | Labelled customer/vendor reference rendering |
| src/routes/jobs.$jobId.tsx; src/routes/jobs.pending.tsx | Workflow status/reference and Pending desktop/mobile rows |
| src/routes/api/workspace/jobs.pending.ts; src/routes/api/workspace/reopen-requests.ts | Existing authorized reference read/search paths |
| src/routes/api/admin/cancellation-requests.ts; src/lib/qne/service-jobs/cancellation.server.ts | Cancellation join projection and search |
| src/lib/qne/inquiry/preferences.ts (new) | Versioned, sanitized, user/company-scoped view preferences |
| src/lib/qne/inquiry/view-state.ts (new); src/lib/qne/inquiry/InquiryViewProvider.tsx (new) | Pure session transitions; authenticated provider and memory cache |
| src/lib/qne/inquiry/use-inquiry-access.ts | Shared verified access; refresh/revocation behaviour |
| src/lib/dynamic-tabs.ts (new); src/lib/tabs.tsx | Pure dynamic tab validation/transitions; navigation provider |
| src/components/qne/AppTabs.tsx; src/components/qne/AuthGate.tsx | Inquiry tab strip and authenticated provider mounting |
| src/components/qne/JobDetailsInquiry.tsx | Render/edit retained state, column reordering and ordered export |
| scripts/verification/dashboard-inquiry-state.cjs (new) | Fixture-only desktop/mobile and session browser checks |

No full route/component rewrites. Add only focused helpers and replace the existing local Inquiry state where needed.

## Task 1: Compact Dashboard and independent information controls

**Files:** DashboardInfo.tsx, DashboardPrimitives.tsx, admin.dashboard.tsx, dashboard.tsx; browser verifier.

**Interfaces:** DashboardInfo({ label: string, children: ReactNode }): ReactElement. Existing DashboardSection and DashboardStatCard props remain compatible. Their descriptions/meaning render in DashboardInfo.

- [x] Add failing browser cases: a Staff hero has company name/[i] and no shortcut row; section/card info opens without navigation; keyboard Escape closes it; a 390px viewport has no page-wide overflow.
- [x] Run the new browser cases against existing code; confirm failure is a stated behaviour gap rather than missing fixture API responses.
- [x] Implement DashboardInfo with existing Radix Popover. Restructure actionable cards so the action and [i] are siblings, with visible focus and 44px hit areas. Target 96px compact card minimum height, allowing long labels to expand.
- [x] Use compact hero for Staff, preserve identity in a short greeting, remove its shortcut actions and retain Refresh. Move HealthCard last-success/error details into [i], while leaving its status visible.
- [x] Run browser cases at 1440px and 390px; confirm [i] does not change route/card scope and existing main-menu/mobile New Job remain usable.
- [x] Commit the verified Dashboard deliverable.

## Task 2: Visible Workflow references and all Pending reference searches

**Files:** JobReferences.tsx, pending-reference-search.ts, jobs.$jobId.tsx, jobs.pending.tsx, the three Pending APIs and cancellation.server.ts.
**Tests:** pending-reference-search.test.ts (new), cancellation-queue.test.ts, pending-reference-routes.server.test.ts (new), browser verifier.

**Interfaces:** ReferenceFields = { latest_customer_ref_no?: string | null; latest_vendor_ref_no?: string | null }. JobReferences({ job: ReferenceFields, party?: 'customer' | 'vendor' }): ReactElement.
pendingReferenceOr(raw: string): string | null; matchesPendingReference(row: ReferenceFields & { job_number: string; subject: string; customer_name?: string | null; customer_code?: string | null }, raw: string): boolean.

- [x] Write failing route fixtures: a Waiting Vendor job with VEND-42 and a customer reference CUST-42 can each be found; cancelled/reopen request rows return both fields; a matching alien-tenant row remains absent; denied/unauthenticated callers keep 403/401.
- [x] Run the targeted Vitest files and confirm the missing reference projection/search causes the failures.
- [x] Implement bounded search helpers using trimmed input capped at 100 characters. The SQL OR helper adds only the two reference columns to the existing job-number/subject/customer predicate, preserving literal reference punctuation with quoted PostgREST values and escaped LIKE wildcards; remove only controls. Blank cleaned input returns null. Whole-package review corrected the original punctuation-deleting sanitization to satisfy queue parity. Request queues use literal case-insensitive matching.
- [x] Select the two existing job fields in ordinary Pending and both request joins; retain status/outcome/PIC/tenant predicates, filter-before-pagination order and exact totals.
- [x] Render current Workflow status even when no transition button is available. Render applicable customer/vendor reference with explicit label; a missing legacy value displays a dash. Pending shows both available references in desktop and mobile rows; update search hint to include reference.
- [x] Run route/unit cases, existing cancellation-queue and WP3A/WP3C queue tests. Browser-check long references at 390px, Waiting Vendor plus Start work, and each request queue's reference search.
- [x] Commit the verified references deliverable. No waiting/status write path changes.

## Task 3: Sanitized durable Inquiry preferences and ordered columns

**Files:** preferences.ts (new), preferences.test.ts (new); existing job-details.ts types and excel.server.test.ts.

**Interfaces:** InquiryIdentity = { tenantCode: string; userId: string }, from verified currentUser tenantCode and diagnostics.matchedN3UserId only.
InquiryPreferences = { version: 1; draft: JobDetailsQuery; applied: JobDetailsQuery; selectedColumns: string[]; columnOrder: string[] }.
inquiryPreferenceKey(identity: InquiryIdentity): string.
normalizeInquiryPreferences(raw: unknown, access: InquiryPermission, now?: Date): InquiryPreferences.
loadInquiryPreferences(storage: Pick<Storage, 'getItem'>, identity: InquiryIdentity, access: InquiryPermission, now?: Date): InquiryPreferences.
saveInquiryPreferences(storage: Pick<Storage, 'setItem'>, identity: InquiryIdentity, value: InquiryPreferences): void.
orderedJobColumns(access: InquiryPermission, selected: readonly string[], order: readonly string[]): JobColumn[].

- [x] Write failing tests: two users/two tenants yield distinct keys; denied private filters/columns are stripped; duplicate/unknown column IDs are removed; explicit empty selection is retained; saved order ['subject','job_number'] is returned in that order; malformed JSON and throwing storage use safe defaults.
- [x] Run npm test -- src/lib/qne/inquiry/preferences.test.ts and confirm missing helpers fail.
- [x] Implement versioned keys prefixed sh2:inquiry:job-details:v1 with safely encoded tenant/user tuple. Reuse JOB_COLUMNS, availableJobColumns, JOB_PAGE_SIZES and query validation. Preserve valid draft edits separately from the validated applied query; strip unsupported/noFilter filters and sorts.
- [x] Do not read/write a generic fallback key when trusted identity is unavailable. Persist preferences only, never rows/access/token. Use default range from the existing Malaysia date helper.
- [x] Extend existing Excel-column tests to assert the server preserves submitted ['subject','job_number'] order and still rejects a denied column.
- [x] Run preference, job-details and Excel tests; commit the preference deliverable.

## Task 4: Authenticated Inquiry session state, restore and invalidation

**Files:** view-state.ts/view-state.test.ts, InquiryViewProvider.tsx, use-inquiry-access.ts, AuthGate.tsx, JobDetailsInquiry.tsx, jobs.$jobId.tsx; browser verifier.

**Interfaces:** InquiryViewSnapshot = { draft: JobDetailsQuery; query: JobDetailsQuery; selectedColumns: string[]; columnOrder: string[]; data: JobDetailsPage | null; hasApplied: boolean; stale: boolean; scrollY: number }.
InquiryViewState = { identity: string | null; grantsKey: string; requestRevision: number; snapshot: InquiryViewSnapshot }.
transitionInquiryView(state: InquiryViewState, event: InquiryViewEvent): InquiryViewState. Event payloads: identity({ identity, preferences, access }), grants({ identity, access }), patch({ identity, patch }), apply({ identity, query }), received({ identity, requestRevision, data }), stale({ identity }), clear(), invalidate() on completed identity failure. Query/apply/Refresh changes advance requestRevision; received must match both identity and revision.
useInquiryView(): { access: InquiryPermission | null; accessError: string; token: string | null; identity: InquiryIdentity | null; snapshot: InquiryViewSnapshot; update(patch: Partial<InquiryViewSnapshot>): void; markStale(): void; reloadAccess(): void; clear(): void }.

- [x] Write failing state tests: received data for an old identity/revision is ignored; cold preference hydration never sets hasApplied; patching draft does not change applied query; stable grants preserve data; narrowed/revoked grants clear rows; credential refresh with the same verified identity/grants preserves the view.
- [x] Run npm test -- src/lib/qne/inquiry/view-state.test.ts; confirm missing state behaviour fails.
- [x] Implement the pure state transitions and authenticated provider mounted above TabsProvider. The provider owns job fetches triggered by requestRevision, so remounting the Inquiry component does not refetch. Keep one shared access check for header, tabs and Inquiry. Logout/unmount, identity change and access failure abort old requests and clear rows. Grant changes sanitize controls and require fresh Apply; do not render previously broader rows.
- [x] Replace route-local Inquiry state with the provider. Only Apply, pagination/sort after Apply, or explicit Refresh starts job reads. Restore same-session rows/page/scroll after job navigation; preserve unapplied draft controls. Cold reload restores preferences but waits for Apply.
- [x] Add Move up/Move down column controls with disabled boundary states and 44px targets. Render/export orderedJobColumns output. Zero selected columns shows a choose-columns prompt and disables export. Reset restores default filters/layout; Clear filters preserves layout; both clear applied results without fetching.
- [x] In the existing mutation refresh callback reloadAll, mark Inquiry stale before reloading job details. Successful permanent deletion marks stale before navigation without reloading the deleted Job. Initial reload does not mark stale. Retained Inquiry shows a concise stale notice/Refresh button rather than discarding filters.
- [x] Add browser cases identity-switch-race, revoked-private-access, stable focus refresh, credential refresh, cold no-fetch, Apply/job/back, draft retention, changed-job Refresh, storage denial and reordered export. Assert no job rows/token/grants appear in durable preference storage.
- [x] Run state/preference tests and targeted browser cases; commit the retained Inquiry deliverable.

## Task 5: Unique Inquiry tab with safe scoped restoration

**Files:** dynamic-tabs.ts/dynamic-tabs.test.ts, tabs.tsx, AppTabs.tsx, AuthGate.tsx; browser verifier.

**Interfaces:** DynamicTab = { key: string; label: string; href: string; kind: 'job' | 'inquiry' }.
openDynamicTab(tabs: readonly DynamicTab[], tab: DynamicTab): DynamicTab[].
sanitizeDynamicTabs(raw: unknown, inquiryAllowed: boolean): DynamicTab[].
TabsProvider adds identityScope: string | null and inquiryAllowed: boolean | null (unknown). Ordinary Job scope/navigation does not depend on Inquiry permission. Existing openJobTab signature remains compatible; add openInquiryTab(opts?: { focus?: boolean }): void.

- [x] Write failing unit tests: repeated Inquiry opens produce exactly one key inquiry:job-details with href /reports/job-details; existing job tabs are preserved; invalid href/external URLs are dropped; Inquiry disappears when access is denied.
- [x] Run npm test -- src/lib/dynamic-tabs.test.ts; confirm missing dynamic-tab support fails.
- [x] Implement allowlisted tab restoration and immutable deduplication helpers. Use tenant/user-scoped sessionStorage keys prefixed sh2:openTabs:v2; do not migrate the former unscoped sh2:openTabs:v1 record.
- [x] Register/focus the Inquiry tab when its authorized route opens through menu or URL. Render Job and Inquiry dynamic tabs with appropriate badges; closing active tabs retains existing neighbouring-tab/Workspace fallback. Closing Inquiry clears its volatile result/applied state but retains saved preferences. Access revocation removes its tab.
- [x] Browser-check menu reuse, direct URL, job/back, closing active Inquiry/job, session reload, user switch and compact-mobile. Assert tab controls remain keyboard accessible with 44px touch targets.
- [x] Run dynamic-tab tests and the retained-state browser cases; commit the integrated tab deliverable.

## Task 6: Whole-package verification and candidate review

**Files:** scripts/verification/dashboard-inquiry-state.cjs; docs/verification/DASHBOARD_INQUIRY_STATE_CANDIDATE_2026-10-01.md (new).

**Interfaces:** Browser verifier accepts PLAYWRIGHT_MODULE_PATH and CHROMIUM_PATH like wp5a-ui.cjs. All API calls are synthetic fixtures; block non-localhost requests and fail on unexpected APIs/page errors.

- [x] Complete fixture responses for both roles, job/timeline/comments, all Pending queues, stable/revoked access and ordered XLSX export. Use artificial company/customer/staff values exclusively.
- [x] Run the verifier against local Vite in the same shell/session at 1440px and 390px. Use /tmp/servicehub-shell/chrome-headless-shell-linux64/chrome-headless-shell if available; no actual DB/N3 traffic. Require all labelled scenarios to pass.
- [x] Run npm test, npm run typecheck, npm run build and npx eslint over every changed product/test file. Full test suite/typecheck/build must pass. Report existing repository-wide lint failure separately; do not expand this package to repair it.
- [x] Inspect git diff --check, changed files and dependency/lockfile/type/migration absence. Reconfirm main/Lovable base. Save exact candidate SHA/tree and verification evidence.
- [x] Run the requesting-code-review workflow on the whole candidate; resolve material findings and rerun only affected checks.
- [x] Present the exact review candidate. Do not merge, publish, apply a migration or claim live behaviour without the corresponding scope-specific approval and evidence.

## Handoff

Recommend Native execution: the six tasks share authenticated state and tab interfaces, while the changes require no schema or money writes. I implement the tasks in this session and obtain one independent whole-branch review. Subagent-driven execution remains available if the owner prefers independent review after each task.

Written plan approval and Native execution were accepted before Task 1. After A reaches its reviewed integration checkpoint, prepare B's separate implementation plan from its approved spec and refreshed event/schema evidence; then C's from the verified B interfaces.
