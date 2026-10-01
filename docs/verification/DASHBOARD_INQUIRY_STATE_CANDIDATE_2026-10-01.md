# ServiceHub Package A — verified candidate checkpoint

**Upload to Project Sources: No.** This is repository review evidence. It does not replace product requirements or a released-baseline source.

**Product:** SH2.2 ServiceHub / SSH, repository `mugs-AI/ServiceHub2`.
**Scope:** approved compact Dashboards, Workflow/Pending references, saved Inquiry controls and retained Inquiry/Job tabs. KPI reports and rewards remain separate B/C packages; Timeline Inquiry remains WP5B. No publish is authorised by this checkpoint.

## Authority and target

The Owner approved the written Package A plan and Native execution, then directed recovery without restarting or expanding scope. `00-MUGS_DIRECTBUILD_PROTOCOL.md`, `MDB-01_SERVICEHUB_ADOPTION.md`, `AGENTS.md` and product requirements remain authoritative together. For this bounded package, the Owner-approved review-branch route replaces the older mandatory Lovable AI build step; product, tenant, lifecycle, attachment and separate integration/backend/public-release gates remain in force.

| Lane | Observation |
| --- | --- |
| GitHub synced main | `7029b09c34e3b3378ed844a82108d89ef6908e9f` |
| Lovable | Project `9265adcd-acf6-4fdb-a766-3fc21310ee8f`, workspace `tJObptvCa2MGSCihecnu`, latest commit matches main, `is_published: true` for the existing site |
| Existing public site | `https://servicehub22.lovable.app`; no Package A publish or live acceptance claim |
| Backend | Lovable Cloud reports Supabase enabled; latest recorded migration `20260920111137`; existing `service_jobs.latest_customer_ref_no` and `latest_vendor_ref_no` confirmed as text |
| Backend reference | Repository declares `yhzsrbwwhflelpxqbisu`; not independently confirmed from connection metadata. No backend write performed |
| Local baseline | `8fb32378455f450516172c293b0068ae4f8a35e4`, tree `82625a9dadb0ab129621007ac1c066d3bf1a2dc2`, identical to remote main tree |
| Approved design/plan | Remote documentation draft PR #5, head `2df3513c4613696f75c6942043417799037bf354`, tree `c8049a9af85ab5b098677e3667f6377b2370d045` |
| Local implementation | Branch `codex/dashboard-inquiry-state`; tested product commit `c5e1be05d3c22ac96c8b27d5fb36505f1ef1a5bc` |

The canonical remote candidate SHA is recorded in the draft PR/final checkpoint after the evidence commit. Local reconstructed commit IDs differ from remote ancestry; exact tree equality is required before handing off the candidate.

## Delivered behavior

- Compact Admin/Staff Dashboard headers and cards. Company, section and card descriptions use independent accessible information popovers. Mobile card labels have room for normal words; global New Job remains visible.
- Workflow shows current status and applicable waiting reference, including a dash for a missing legacy value. Pending displays both available references and searches them in ordinary, cancellation and reopen queues without removing tenant/role/status predicates.
- Inquiry stores versioned control preferences per verified company and immutable N3 user: draft filters separately from applied query, page size, sorting, selected columns and column order. Only controls are durable; rows, tokens and grants are not saved with them. Corrupt/denied storage uses safe defaults. These preferences are local to that browser/device.
- A cold load restores controls and waits for Apply. Returning from a Job in the same authenticated shell retains the results, applied page, draft edits and scroll. Excel uses applied filters and the selected column order. Zero selected columns prompts the user and disables export.
- One closable Inquiry tab sits with Job tabs. Tab restoration is user/company scoped and allowlists Job/Inquiry paths; the old generic tab record is not migrated. Ordinary Job tabs use verified identity independently of Inquiry access. Unknown Inquiry grants hide only the Inquiry tab and defer storage writes, preserving its saved record until verification; known denial removes it.
- Stable focus revalidation does not blank the view or reread Jobs. Access failure/narrowing clears cached rows and cancels broader in-flight reads. A completed identity failure invalidates the in-memory view, so same-actor recovery remains cold until Apply; a successful ordinary credential refresh retains results. Credential changes require a matching verified identity; late identity/query responses cannot replace the current actor. The SessionProvider generation/token checks are a required response-order correction for that boundary.
- Existing Job mutation refresh callbacks and successful permanent deletion mark retained Inquiry results stale; explicit Refresh reloads them. Clear filters retains layout; Reset restores defaults; both clear results without a query. Closing Inquiry clears applied results while keeping durable preferences.

## Verification

| Check | Result |
| --- | --- |
| `npm test` | 67 files, 1,106 tests passed (fresh recovery run) |
| `npm run typecheck` | Passed |
| `npm run build` | Passed, client and server output |
| ESLint over every changed code/test/verifier file | Zero errors; five development-only Fast Refresh warnings |
| `git diff --check` | Passed |
| Fixture browser | Four Dashboard/Pending role/width cases, four Inquiry role/width cases and real-provider session/race harness passed |
| Desktop/mobile | Admin and Staff at 1440px and 390px; no page-wide horizontal overflow; horizontal grid/tab scrolling retained |
| Sensitive/source drift | No dependency/lockfile, migration, generated backend type, server secret, attachment-provider or N3 contract change |

Browser verification uses synthetic company/staff/customer/job data, intercepts every API, and blocks non-localhost browser traffic. The session harness mounts the real providers without adding a production route. Covered: Apply-first, Job/back, draft/page/scroll retention, stored control/order restoration, ordered export request, stable focus, same-actor credential refresh, user/company switching, late responses, access narrowing/revocation, cancellation of broader pending reads, unavailable storage, zero columns, Clear/Reset, stale/Refresh, Inquiry close/reopen and tab restoration from a Job after reload. Server/unit checks cover alien tenants, denied callers, all reference projections, literal punctuation searches across all three queues, preserved tenant/status predicates and actual workbook column order/permissions. The mock route-query adapter checks PostgREST quote decoding, LIKE asterisk alias/wildcard/escape semantics and escaped regex literals; it is not a live PostgREST execution.

The repository-wide lint baseline remains separately failing (previously observed 3,676 errors and 14 warnings); this package does not claim whole-repository lint is clean.

Red-to-green corrections were observed for missing reference search, future date-range restoration, squeezed mobile titles, session response ordering, request cancellation on grant changes and scroll retention. Tasks 4 and 5 share one integration commit to keep the authenticated provider/tab interface compilable.

## Review and release state

Independent whole-candidate review of `8fb3237..d8195430` found no Critical issues, three Important issues and one Minor issue. Each was reproduced with a failing focused check before correction:

| Finding | Correction and evidence |
| --- | --- |
| Failed identity verification resurrected old rows on same-actor recovery | Completed identity failure resets the volatile view; real-provider browser recovery stays cold until Apply. Successful credential refresh still retains rows |
| Inquiry-access outage blocked Calendar/Day Schedule job links | Job navigation/tab scope no longer depends on Inquiry permission; real AuthGate/TabsProvider browser action reaches the Job with access 503 |
| Reference punctuation was deleted from ordinary Pending search | PostgREST-quoted, LIKE-escaped values preserve underscores, parentheses, commas, quotes, percent signs and backslashes; 29 focused helper/route tests pass across all queues |
| Permanent deletion omitted stale marking | Successful purge marks the view stale before leaving the Job; desktop/mobile Admin fixture flow passes without a real destructive operation |

Recovery correction review on 01/10/2026 cleared the earlier Important findings and identified two Minor edges. Both were reproduced with failing tests and corrected: closing a visible Job during unknown grants now preserves the hidden Inquiry tab in raw scoped state; asterisk-containing reference searches use quoted, escaped `imatch` rather than PostgREST's `ilike` asterisk alias. The route fixture now models that alias and covers regex punctuation/decoys. Final independent re-review passed 43 affected tests with no unresolved Critical, Important or Minor findings. The candidate is ready for review-branch handoff; it is not a formally accepted release baseline.

Fresh recovery checks: full 1,106 tests / 67 files, typecheck, production build, changed-file ESLint (0 errors, 5 Fast Refresh warnings) and diff checks pass. The nine browser fixture scenarios recorded above were completed for product commit `c5e1be05`; they were not rerun after these final two corrections because this recovery runtime has no browser executable and the browser download failed. The final tab/search corrections have fresh pure/route tests and independent review. Live PostgREST and signed-in tenant UAT remain NOT VERIFIED.

Remote handoff uses a new canonical commit parented to verified main, with exact tree equality to the sealed local candidate. Do not push reconstructed local ancestry or alter main.

Search encoding follows the existing Inquiry literal-pattern convention and the official [PostgREST reserved-character guidance](https://docs.postgrest.org/en/v16/references/api/url_grammar.html#reserved-characters).

No merge to main, Lovable AI build, migration/data write, function deployment, credential change, N3 transaction, publish or deployment was performed. The authorized recovery handoff may commit this evidence and create a review branch/draft PR; that is separate from main integration and release. Backend/schema and public release remain separate lanes. Local fixture passes establish the candidate behavior, not acceptance against live tenant data.

## Remaining after Package A

- Exact candidate integration review/approval and separate publication/live UAT when authorised.
- Package B: KPI figures, charts, configurable Top N, periods, staff participation/time/waiting/handoff and evidence coverage.
- Package C: prospective points and commission rules, waiting-time deduction options, pool allocation/rounding and review ledger.
- WP5B Timeline History Inquiry, WP6 checklist and WP7 final UAT; then existing approved BEC/ESH sequencing.
