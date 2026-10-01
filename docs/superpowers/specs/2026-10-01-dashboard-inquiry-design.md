# Package A — compact Dashboard, waiting references and persistent Inquiry

Date: 01/10/2026. Status: written design approved through the owner's Continue at 09:11 Malaysia.
Parent: [SSH performance programme](2026-10-01-performance-program-design.md).

## Success criteria

Both Admin and Staff dashboards use compact headers/cards with explanations behind independently usable [i] controls. A waiting job visibly shows its current state and reference. Pending searches customer/vendor references. An Inquiry opened as a tab retains the user's view when a job opens and restores preferences on later visits without automatically fetching records.

## Dashboard

- Admin and Staff headers show company name with [i] for explanatory/integration information. Preserve useful staff identity in a compact greeting or the existing shell.
- Remove redundant hero shortcut rows in both views. The existing top navigation and mobile New Job action remain reachable.
- Move section descriptions beside section titles into [i] popovers. Move card meaning text beside card titles into [i] popovers, including Integration Health cards.
- Reduce blank space and card height while retaining readable labels/values, responsive wrapping, visible focus and at least 44px touch targets.
- A card's primary action and its [i] button must be sibling interactive controls; no nested buttons. Information clicks must not trigger job-list navigation.
- Keep operational cards and their exact drill-down scopes. Performance cards arrive in B/C only when their backend data is ready; do not render fabricated placeholder statistics.
- Popovers work with click/tap and keyboard, close on outside click/Escape, and are not hover-only.
- Preserve functional Refresh access inside the compact information/control area.

Relevant existing surfaces: DashboardPrimitives.tsx, admin.dashboard.tsx and dashboard.tsx. The preceding release compacted the Admin hero, while the Staff hero and section/card descriptions still require this correction.

## Workflow and Pending references

- Workflow shows the current status independently of which transitions are available.
- WaitingCustomer shows the latest customer reference; WaitingVendor shows the latest vendor reference. Display explicit customer/vendor labels and a dash for missing legacy references.
- Preserve existing atomic waiting transition and mandatory-reference validation. The correction exposes existing latest_customer_ref_no/latest_vendor_ref_no fields; it introduces no new reference write.
- Pending responses select and return both reference fields through the existing authorized server path.
- Desktop rows and mobile cards display available references. Search matches job number, subject, customer and either reference while retaining the selected queue and all actor/tenant restrictions.
- Audit every Pending queue path. Where a queue represents cancellation/reopen requests, join reference data through the authorized job and preserve existing outcome logic.
- Keep search parameter validation and PostgREST escaping; input cannot widen a tenant or actor predicate.

Relevant surfaces: jobs.$jobId.tsx, jobs.pending.tsx and api/workspace/jobs.pending.ts.

## Inquiry tab and state

- Extend existing dynamic tabs to support the Job Details Inquiry route as one unique closable tab, alongside job tabs below the main menu.
- Main-menu opening focuses the existing Inquiry tab rather than duplicating it. Opening a job from its grid opens/focuses that job tab and leaves Inquiry available.
- Closing the active dynamic tab focuses a valid neighbouring tab or the existing Workspace fallback.
- Gate tab visibility and restored content by the current verified Inquiry permission. Logout, company/user change or permission revocation clears session results and invalidates old requests. Routine credential refresh for the same verified user/company/grants preserves the view, without persisting the token or trusting stale grants.
- On returning from a job in the same authenticated session, restore the applied query, any unapplied draft edits, selected columns/order, pagination, results and scroll position.
- Data-changing job actions mark the retained result stale. Display a compact Refresh action; do not silently replace the user's view. Returning to a job list must not reuse data across identities.
- Results are cached only in authenticated in-memory session state. Do not store job rows, tokens or grants durably.

Relevant surfaces: tabs.tsx, AppTabs.tsx, JobDetailsInquiry.tsx and use-inquiry-access.ts. Introduce a small authenticated Inquiry state owner rather than turning the tab manager into a job-data store.

## Durable preferences

Store a versioned browser preference record keyed by trusted tenant plus stable authenticated user identity. This persists across visits on the same browser/device; cross-device sync is outside A.

Persist all adjustable query/view fields: date field/range, free text, every column filter, selected columns, complete column order, sort/direction and page size. Persist draft settings separately from the last applied query. Restore them only after identity and access are resolved.

- Fresh page/session: restore controls but show Apply filters to load Jobs; no job-list request until Apply.
- Returning from a job within the same session: retain the already-applied view rather than resetting to defaults.
- Selected columns follow the saved order in the grid and authorized Excel export.
- Provide visible Move up / Move down controls for mobile and keyboard users. Desktop drag reorder may supplement them but is not required.
- Sanitize unknown/duplicate column IDs and newly denied filters/sorts/columns before use. A storage record never grants permission.
- Corrupt/unavailable storage falls back to valid defaults without blocking the page. Never share fallback records between users.
- Reset restores default controls and layout and saves those defaults; Clear filters clears query fields without resetting the user's column layout. These actions do not load records automatically.
- Preserve same-session access on ordinary focus refresh; permission failure closes cached content rather than exposing stale data.

## Validation

Meaningful browser checks cover desktop and mobile header/cards, [i] click isolation, waiting references, reference searches, one Inquiry tab, job-return state, saved reordered columns and matching export order.

Server checks cover queue/search parity, allowed/denied actors, alien tenants and hostile search syntax. State tests cover cold-open no fetch, Apply then navigate/back, unapplied draft retention, refresh after job changes, identity switch, revoked access and corrupt storage.

No schema, generated backend type, N3 or attachment-provider changes are part of A.
