# Roadmap

## WP3A — Job Operations Correction (candidate only)

- [x] Candidate migration `docs/migrations/WP3A_job_operations_correction.candidate.sql`
- [x] Waiting Customer / Vendor reference prompt + atomic endpoint
- [x] Cancellation header correction ([i] balloon + header-row action)
- [x] Completed Job reopen request / approval with completion cycles
- [x] Compact on-site attendance visit rows with peach map buttons
- [ ] Audit blocker 1 — close the generic `/status` waiting bypass (server enforced + tests)
- [ ] Audit blocker 2 — candidate type declarations (no edits to generated types.ts)
- [ ] Audit blocker 3 — drop `service_job_completion_unique` via ALTER TABLE, ordered after the new per-cycle index; contract test
- [ ] Audit blocker 4 — fix the two failing contract tests, then lint, typecheck, full suite, production build, diff review

Standing: no migration applied, nothing published, no package changes.
