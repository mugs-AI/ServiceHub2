# Inquiry menu and mobile New Job correction

Status: review candidate; not merged or published.

The owner requested Inquiry as a top-level menu immediately before Tools, containing Job Details Inquiry and Timeline History Inquiry, and a visible top-right + New Job button on phones.

## Scope

- Move permitted users' Job Details navigation out of Tools into Inquiry.
- Show Timeline History Inquiry as disabled Coming soon. WP5B is still unimplemented; this change creates no Timeline route or permissions bypass.
- Keep + New Job visible in the phone top bar. Phone navigation wraps without page overflow.
- Place the header and open Job tabs in a shared sticky container so tabs remain below the actual header height, including an expanded phone menu.
- Preserve the four primary navigation labels, existing job creation route and inquiry access checks. Dropdowns close on outside pointer or Escape.

## Read-only target checks

Protocol 00-MUGS_DIRECTBUILD_PROTOCOL and MDB-01_SERVICEHUB_ADOPTION were read before this correction. Existing requirements and separate release gates remain authoritative.

- Repository: mugs-AI/ServiceHub2; main 30d86597731a96a5025dc52d876b771dbe183dd5.
- Base tree: 7ec9e4e640b5049eba74cdaed97bc3b0aa182325 (matches local accepted combined candidate tree).
- Lovable: 9265adcd-acf6-4fdb-a766-3fc21310ee8f, workspace tJObptvCa2MGSCihecnu; latest commit matches main, is_published true.
- Connected backend enabled, Supabase stack; latest recorded migration 20260920111137.
- Repository declares backend reference yhzsrbwwhflelpxqbisu; connector metadata does not independently confirm the reference.
- No backend, migration, data, credential, N3, main branch or publication writes are part of this candidate.

## Verification

- Browser fixture checks: 320, 375, 390 and 768 pixel widths, plus desktop1440. Inquiry precedes Tools on the same row; Job Details link works; Timeline is disabled; no Inquiries link remains inside Tools.
- - New Job visible at top right with /jobs/new target; dropdown fits viewport; no horizontal page overflow.
- Open Job tabs remain below the header when scrolling and opening the phone profile menu. A regression assertion failed against the fixed57px offset before the shared sticky container correction, then passed.
- Existing inquiry filtering/export, stale results, expired session and revoked-access checks pass; zero browser page errors. All API responses are fixtures; non-localhost browser traffic is blocked.
- 62 test files / 1,056 tests pass; typecheck and production build pass. ESLint passes on AuthGate.tsx and AppTabs.tsx; git diff --check passes.
- Independent code review found the sticky offset regression; the final review confirms it is resolved and reports no Critical or Important findings. Navigation suite independently passed30/30.
- Repository-wide CI had existing lint debt at the accepted baseline (3,676 errors,14 warnings); this candidate does not claim the repository-wide lint gate is clean.

## Release and UAT

Merge and Lovable publish require the owner's separate release approval under MDB-01. After release, verify Inquiry > Job Details, the Coming soon Timeline entry, + New Job on a real phone, and open Job tabs while scrolling. Timeline functionality remains WP5B work.
