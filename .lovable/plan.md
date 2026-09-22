# WP3B Candidate Audit Correction

## Scope
Correct only the two audited WP3B blockers, restore the prohibited dependency drift, and preserve all other WP3B and existing ServiceHub behavior.

## Changes
1. **Additive compatibility materialisation**
   - Amend the unapplied WP3B candidate SQL immediately after follow-up table/index creation.
   - Insert durable open follow-up rows only for non-deleted Completed Jobs whose current-cycle completion evidence is modern, ticked, and has no existing follow-up row.
   - Source identity, completion timestamp fallback, and actor snapshots from canonical Job/completion evidence.
   - Use the tenant/Job/cycle conflict key with `DO NOTHING`, preserving all existing follow-up and completion evidence.
   - Correct safe-forward comments and add source-contract coverage for ticked/no-tick behavior.
   - Add a defensive contract that an actionable open state requires a durable current-cycle follow-up row.

2. **Actual resolution actor attribution**
   - Retain the current-cycle completion actor in the central outcome loader.
   - Derive `resolved_by_user_id` from the completion actor for resolution-at-completion and the clearing actor for resolution-after-follow-up.
   - Update shared scope counting and dashboard mappings so Resolved by Me Today uses the actual actor, while My Follow-ups and My Reopen Pending remain assignee-scoped.
   - Add tests for reassignment after completion and follow-up-clear attribution, preserving card/list scope parity.

3. **Dependency restoration and verification**
   - Restore only `package.json` and `bun.lock` to their exact contents at input SHA `a3e0cd3b8f20f215f44ce7d6fd7d39422a5834db`.
   - Run frozen install, typecheck, full tests, build, diff check, and targeted lint for WP3B-owned files.
   - Report the final saved SHA and exact changed-file list.

## Boundaries
- Candidate SQL remains unapplied; no database or production data writes.
- No publish/deploy, BEC, ESH, package additions, or unrelated changes.
- Existing completion evidence, follow-up evidence, tenant authority, and server-only mutation paths remain immutable and enforced.
