# WP5A Job Details Inquiry implementation plan

Owner-approved goal: one bounded Job Details Inquiry grid and filtered Excel export. Extend the existing Jobs read model and WP4 permission guard. Use one validated query for list and export; select sensitive fields only when granted. Native OOXML ZIP avoids package or lock changes.

Constraints: server N3 identity and tenant; current Primary PIC for Own Jobs; DD/MM/YYYY; preserve Google Drive and lifecycle; no migration, merge, N3 write or public publish. Review focus: malicious filters cannot alter tenant/scope; denied sensitive fields cannot be selected, filtered, sorted or exported; export must not silently truncate; stale requests cannot overwrite newer rows.

- [x] Validate input, columns, DTO and database query with fake Supabase request URLs.
- [x] Build real XLSX encoding, guarded HTTP routes and failure-checked export audit.
- [x] Mount `/reports` and `/reports/job-details` with responsive grid, chooser, filters, paging, Job links and navigation.
- [ ] Reverify full suite, typecheck, lint, build, mocked desktop/mobile, diff and remote review branch.
