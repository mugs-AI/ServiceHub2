# SSH performance and interface programme — design review

Date: 01/10/2026, Malaysia.
Owner decisions: APPROVE ALL at 08:58 Malaysia approved the conversational design and amendments. Continue at 09:11 Malaysia accepted this written programme and its three package specifications. This does not claim implementation, migration application or release.

## Intended outcome

Give the owner useful monthly staff performance, fair configurable case rewards and clear handover/waiting evidence. Give staff a compact personal dashboard that motivates completion and teamwork. Preserve an Inquiry while moving between it and individual jobs. Improve existing Dashboard, Workflow and Pending screens on desktop and mobile.

Waiting remains included in KPI elapsed/responsibility hours. For handling-time commission, customer/vendor waiting is deducted by default, with an option to include it. These are independent rules.

## Current evidence and target

| Item | Verified state on 01/10/2026 |
| --- | --- |
| Product | SH2.2 ServiceHub / SSH |
| Repository and synced branch | mugs-AI/ServiceHub2, main |
| GitHub and Lovable commit | 7029b09c34e3b3378ed844a82108d89ef6908e9f |
| Source tree | 82625a9dadb0ab129621007ac1c066d3bf1a2dc2 |
| Lovable project | 9265adcd-acf6-4fdb-a766-3fc21310ee8f |
| Workspace | tJObptvCa2MGSCihecnu |
| Backend | Connected Lovable database enabled; Supabase |
| Latest recorded migration | 20260920111137 |
| Backend reference | Repository declares yhzsrbwwhflelpxqbisu; independent connection-reference confirmation remains NOT VERIFIED |
| Public state | Lovable reports published. Previous PR4 deployment was verified; this design introduces no new deployment |
| Local design base | Local 8fb32378455f450516172c293b0068ae4f8a35e4 has the exact same tree as remote main |

Read-only aggregate evidence earlier this morning: 14 jobs, 25 assignment records, 11 completion records, 2 work-session records and no waiting-period rows. These are connection-wide counts, not a claim about any individual tenant. Waiting-reference actions exist in the activity log; an empty waiting-period table does not mean no waiting occurred.

## Three independently reviewable packages

1. [A — Dashboard, references and persistent Inquiry](2026-10-01-dashboard-inquiry-design.md). Existing UI/read-path corrections; browser preferences and session state; no new backend schema.
2. [B — Time evidence and performance reports](2026-10-01-performance-kpi-design.md). Shared interval calculations, evidence quality, reports, charts and role-scoped Dashboard figures. Any needed prospective capture migration belongs to this package.
3. [C — Points and commission](2026-10-01-case-rewards-design.md). Versioned rules, contributor allocation and an auditable approval ledger. Depends on B for trusted time weights.

Deliver A first, B second, C third. Each package must work vertically with relevant permissions, failure behaviour and mobile checks before integration. This is decomposition and release sequencing, not an implementation plan.

## Preserved product rules

Read and preserve 00-MUGS_DIRECTBUILD_PROTOCOL.md, MDB-01_SERVICEHUB_ADOPTION.md, engineering governance, requirements, completion plan and the experience library. Direct review-branch delivery is owner-approved for this scope; it does not change completion/cancellation/reopen/follow-up authority, server-controlled N3 actor/tenant, attachment-provider rules or release gates.

Use DD/MM/YYYY and Asia/Kuala_Lumpur for user-facing dates and reporting boundaries. Server/database time is authoritative. Never use a browser-supplied tenant or actor for authorization. Cooperation may include contributors who never become PIC; viewing a job is not contribution evidence.

Keep existing Dashboard count-to-list parity, existing Inquiry private-column/export permissions and Apply-before-load behaviour. Do not expose rewards through existing broad Inquiry rights.

## Remaining roadmap

WP5B Timeline History Inquiry remains a separate unbuilt deliverable. Package B shares audited event interpretation with it where useful, but does not silently declare WP5B finished. WP6 reconciliation and WP7 complete UAT remain required. BEC integration and ESH remix retain their prior ordering and isolation requirements. ESH product/value reward rules are an extension boundary, not current implementation scope.

## Review and release boundaries

This branch contains design documents only. No product code, dependency, database, credential, N3 transaction or deployment changes are included.

Written design review is complete. [Package A implementation plan](../plans/2026-10-01-dashboard-inquiry-state.md) is prepared for the next review and execution-method selection. B/C retain separate plan handoffs after their prerequisites. No migration may be applied until target identity and the exact candidate are verified and authorized. Main integration and public release must use the reviewed candidate and separate lane evidence.
