# ServiceHub Settings session recovery — review candidate

Owner report, 30/09/2026: the header displays ADMIN while System Options / Google Drive returns Administrator access required; leaving, reloading and returning can recover. Access settings also fail intermittently. The screenshot does not supply upstream network statuses, so the production cause is not independently confirmed. Reports / Job Details absence has a separate verified explanation: WP5A remains unmerged in draft PR #1.

Read MDB-01 protocol, ServiceHub adoption and experience register before repair. This bounded correction follows the Owner's issue report using an isolated direct review branch. Existing product identity, role rules, tenant isolation and separate merge/backend/publish gates remain authoritative. The prior WP5A candidate is unchanged.

GitHub main and Lovable latest commit both observed at `67f6c4cf279bc60117c780e629892f2820bd51e6`; Lovable project `9265adcd-acf6-4fdb-a766-3fc21310ee8f`, published flag true. The public serving commit is not exposed. Lovable backend enabled, latest recorded migration `20260920111137`, confirmed read-only. Backend reference declared in repository `yhzsrbwwhflelpxqbisu` remains not independently confirmed by connection metadata. No backend change is needed by this correction.

Red/green reproduction against real server guards with fixture fetch responses established:
- Cold parallel same-token requests can independently resolve owner and denied decisions.
- An upstream temporary failure is converted to a 403 and its unresolved role is cached for 60 seconds.
- An upstream 403 remains cached even after a later successful owner lookup is available.
- Different complete tokens sharing the last 96 characters can reuse the same cached permissions.

Correction: use complete token keys in bounded server memory; share pending lookups per runtime; release pending state on success or rejection; cache only successful Users lookups. Verified non-owner and disabled-owner decisions remain denied. Upstream forbidden responses do not grant administrator privileges and remain uncached. Transient network, body-read, malformed JSON, 429 and 5xx failures return a safe retryable 503 when no explicit emergency fallback succeeds. Existing opted-in emergency fallback and 60-second successful cache TTL remain unchanged. Tokens are never logged or returned.

Compatibility: failure to verify Users now temporarily blocks every caller of the shared authenticated-user guard, including Dashboard/Workspace as well as Settings. This avoids acting on an unresolved identity; it does not silently retain administrator privileges. Singleflight is per runtime, not a distributed cache. No automatic browser retry was added; retry is a fresh request/page reload. The change does not prove this exact live screenshot cause or remove all upstream outages.

Verification: baseline 1,021 tests; corrected suite 1,034 tests / 58 files, including 13 server-guard cases. Typecheck and production build passed. New test file ESLint passed; semantic ESLint on both changed source files passed. The existing server file retains 16 baseline Prettier diagnostics; full lint is not claimed clean. Diff whitespace check passed. Independent review found no Critical or Important implementation findings. The body-stream failure noted during review was reproduced and corrected with an additional red/green test.

No dependency, lockfile, generated type, migration, storage behavior, N3 transaction, credential, backend deploy, main merge or public publish change. Authenticated live and responsive UAT remain pending after separately approved delivery. Live checks: navigate among all four System Options sections, reload Settings directly, verify real normal-user denial, check Drive connection status, and separately verify WP5A Reports after its release.
