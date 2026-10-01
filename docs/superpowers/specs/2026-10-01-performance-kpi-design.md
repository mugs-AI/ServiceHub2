# Package B — performance evidence, reports and charts

Date: 01/10/2026. Status: written design approved through the owner's Continue at 09:11 Malaysia.
Parent: [SSH performance programme](2026-10-01-performance-program-design.md).

## Purpose and metric contract

Report volume, elapsed responsibility, waiting and quality without confusing ownership with actual labour. Show evidence coverage alongside time statistics. Waiting is never subtracted from KPI elapsed/responsibility hours.

| Metric | Definition |
| --- | --- |
| New completed cases | Distinct jobs with their first evidenced completion in the selected period, credited to the recorded completion actor |
| Re-completions | Later completion-cycle events, reported separately by their actual actor |
| Resolved cases | Distinct first-resolution jobs in the period: simple completion or first follow-up resolution. Credit the resolution actor; show completion actor separately. Resolutions after reopening are a separate re-resolution count |
| Handled cases | Distinct jobs with an evidenced PIC interval or verified contribution by that staff member intersecting the period |
| Case elapsed hours | Creation to first resolution, including waiting, unassigned time, nights and weekends; subsequent reopen-cycle duration is separate |
| PIC responsibility hours | Assignment to handover/unassignment/cycle terminal boundary, including waiting and calendar hours |
| Recorded work hours | Union of valid recorded work intervals per actor/job; evidence coverage shown |
| Customer/vendor waiting hours | Union of evidenced waiting intervals, split by party and intersected with each PIC episode when attributed to staff |
| Average / median per case | Case duration over the selected completion/resolution cohort with an explicit date basis and known-evidence denominator |
| Staff hours per handled case | Staff responsibility or recorded work hours in the period divided by that metric's evidenced handled-case count |
| Reopen quality | First-resolved jobs reopened within 30 calendar days, divided by first-resolved jobs whose full 30-day observation window has elapsed. Show immature cohorts separately and display numerator/denominator |

First completions and re-completions remain historical events; reopening must not erase a previous month's completion count. Team volume counts distinct jobs and must not sum individual handled-case counts. Unknown time is not zero and is excluded from known-time averages with coverage shown.

All aggregate cards and exports carry period, timezone, date basis, units, as-of time and evidence coverage. Short visible labels use [i] to explain formulas. Gross case duration under a completion actor includes inherited time; it is not a claim that actor worked all those hours.

## Interval reconstruction and evidence

Use assignment history, job activity, completion/follow-up/reopen/cancellation records and work sessions. The current waiting-reference transition records party/ref/status in activity metadata, while the waiting-period table currently has no rows. Do not calculate all waiting as zero from that table.

A focused server read model normalizes ordered events into:
- PIC episodes with job/cycle, actor, start/end and supporting event IDs;
- waiting episodes with customer/vendor party, reference, start/end and evidence IDs;
- work intervals with actor, start/end and provenance;
- completion/resolution/reopen events;
- explicit missing-boundary, legacy-snapshot and conflicting-evidence flags.

Use half-open intervals and deterministic timestamp/event ordering. Repeated waiting-reference edits in the same waiting state update context without restarting the interval. Handover while waiting splits staff attribution but does not end job waiting. Exit from waiting, terminal action or relevant cycle boundary closes that episode. A subsequent reopen begins another cycle.

A present-day snapshot cannot invent an older assignment/waiting start. Prefer authoritative transactional event timestamps. If sources conflict or boundaries are absent, return incomplete evidence and do not make that job eligible for automatic time-based rewards. Completion ends that cycle's PIC responsibility/work/waiting intervals. When follow-up remains open, gross case elapsed time continues until resolution; the follow-up gap is not automatically attributed as PIC work.

Open intervals use one server as-of instant. Staff responsibility charts intersect each episode with the reporting month. Case-cohort duration reports include the full evidenced case duration, even if it began before that month; labels distinguish these two bases.

Union overlapping intervals before summing. Customer and vendor breakdowns may overlap in legacy records; combined waiting uses their union. Never add onsite attendance minutes to work-session minutes as if they were independent labour: show GPS attendance separately unless proven nonoverlapping.

Prospective capture must ensure all supported assignment/status/waiting/terminal paths emit sufficient evidence atomically. Prefer enriching the existing authoritative audit path over creating duplicate interval writers. Any required additive migration/RPC update is reviewed separately; old events remain unchanged. KPI availability follows capture/read-model readiness, not merely code merge.

## Reports and filters

Expose performance entries through the established Inquiry navigation and dynamic-tab pattern, with their own permissions.

- Monthly staff summary: completions, re-completions, resolutions, handled cases, responsibility/work hours, average/median case duration, waiting, coverage and quality.
- Longest cases: Top 10/20/30/40 or custom positive N, capped at 1000 per request. Month, year or custom range; date basis; staff; status/outcome; waiting party; sort metric. Default Top 20 by case elapsed hours.
- Current backlog/ageing: active jobs as of now, distinct from closed-case duration ranking.
- Waiting analysis: party, current waiting age, references and accountable PIC.
- Job contribution drill-down: distinct PICs and verified contributors separately, takeover timeline, each staff's hours/waiting/work, completion/resolution actors and evidence quality.
- Quality report: reopened/follow-up-open cases with explicit denominator and period.

Month/year boundaries are Asia/Kuala_Lumpur; display DD/MM/YYYY. Custom N and every view/filter preference are remembered per trusted user/company. Server validates N, enum metrics and date windows; stable ties use job identity. Large reports use bounded pagination and allowlisted export rather than unbounded browser joins.

Provide authorized XLSX export through the existing export pattern, preserving private-field policy, column order and audited export metadata.

## Dashboard and charts

Admin: team completions/trend, staff workload and ageing, waiting bottlenecks, longest cases, follow-up/reopen quality and time-recording coverage.

Staff: own completions, monthly target progress, follow-up attention and personal trend. C adds points and approved commission. Do not expose another staff member's money through comparison charts.

Charts: monthly completions by staff; monthly completion/reopen trend; workload by staff; customer/vendor waiting breakdown. Do not combine waiting and full elapsed duration into an additive stack. A within-duration stack may use customer waiting, vendor waiting and other elapsed portions only when boundaries form a nonoverlapping partition.

Use the repo's existing chart components/dependencies after inspection. Clicking a chart/card opens exactly the filtered evidence-backed list. Mobile cards remain compact and charts have readable alternatives.

## Security and error behaviour

Performance rights are distinct from broad Inquiry access: own performance versus team performance. Default staff scope is self; team visibility and exports require server-authoritative admin or explicit approved permission. Money permissions are separate in C.

Resolve tenant and immutable actor server-side. Apply tenant/actor predicates before aggregating or reconstructing timelines. Cache keys include trusted tenant/actor, permission scope, query and source revision; revoked access clears client data. No browser tenant override, service secret exposure or N3 financial writes.

Evidence failure yields an error or labelled incomplete result, never a fabricated zero. Mixed coverage must display the denominator. Unauthorized drill-downs stay denied even if a user guesses a job ID.

## Validation and acceptance

Use synthetic timelines covering PIC A to B and back to A, a helper without reassignment, waiting across a handover/month boundary, reference edits, missing starts, duplicate events, overlapping sessions, midnight Malaysia boundaries, follow-up resolution, reopen/re-complete, cancellation and active as-of intervals.

Check distinct team counts, historical month stability, cohort/window separation, means/medians/coverage, Top N limits/ties, export parity, tenant/role denial and consistent card drill-down. Browser-check staff/admin mobile and desktop. Validate prospective event capture against the exact approved backend before claiming accurate live timing.
