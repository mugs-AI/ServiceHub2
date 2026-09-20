# Roadmap

## WP3A — Job Operations Correction (candidate only)

- [x] Candidate migration `docs/migrations/WP3A_job_operations_correction.candidate.sql`
- [x] Waiting Customer / Vendor reference prompt + atomic endpoint
- [x] Cancellation header correction ([i] balloon + header-row action)
- [x] Completed Job reopen request / approval with completion cycles
- [x] Compact on-site attendance visit rows with peach map buttons
- [x] Audit blocker 1 — generic `/status` waiting bypass closed (400 + tests)
- [x] Audit blocker 2 — `wp3a-candidate-types.ts`; generated types untouched
- [x] Audit blocker 3 — guarded `ALTER TABLE ... DROP CONSTRAINT`, ordered after the new per-cycle index; contract test
- [x] Audit blocker 4 — lint/format, typecheck, 827 tests, production build, diff review

Standing: migration not applied, nothing published, no package changes.
