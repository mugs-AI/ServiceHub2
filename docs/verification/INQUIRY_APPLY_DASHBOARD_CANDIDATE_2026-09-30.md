# Inquiry Apply filters and compact administrator Dashboard

Status: review candidate; not merged or published.

## Owner request and behavior

- Opening Job Details Inquiry must not load records. The initial grid shows Apply filters to load Jobs; Apply filters submits the draft query. Clear filters and Reset only update the draft until Apply. Pagination, sorting and Refresh work after an explicit Apply. The applied-state gate is bound to the current token and resolved user/tenant identity; export cannot run before records are loaded.
- Returning from another program must not replace a same-session inquiry with Checking inquiry access. The old hook cleared access on every focus event. The corrected hook keeps verified same-session access while revalidating, preserves its reference for unchanged grants, and avoids automatically reloading records or losing unapplied draft edits. Failed checks clear access; changed/revoked grants update the view. Server authorization remains unchanged.
- The administrator Dashboard keeps its company title and an information button beside it. Description, tenant, user, last update and Refresh move into that popup. Snapshot Console, Workspace and Settings shortcuts are removed from this Dashboard header on desktop and phones; those destinations remain in existing navigation. No replacement shortcuts are added. Normal-user Dashboard behavior and all operational cards remain unchanged.

## Target and protocol verification

Read 00-MUGS_DIRECTBUILD_PROTOCOL and MDB-01_SERVICEHUB_ADOPTION before this correction; requirements and independent release lanes remain authoritative. Screenshots were inspected; their real tenant/customer details are not reproduced in this evidence.

- Repository mugs-AI/ServiceHub2; remote main and Lovable latest 304c8f57efb680b4a85333bc3f1db6d3460aa532.
- Accepted base tree a34453160dca209fad0db65d0f744d9ea724ee62 matches the clean local tree.
- Lovable project 9265adcd-acf6-4fdb-a766-3fc21310ee8f; workspace tJObptvCa2MGSCihecnu.
- Connected Supabase backend enabled; latest applied migration 20260920111137. Repository declares reference yhzsrbwwhflelpxqbisu; connector metadata does not independently confirm it.
- No dependency/lockfile, generated types, server guard, migration, database, credentials, N3, main-branch or publication changes in this candidate.

## Verification

- Browser assertions first failed against the accepted initial automatic query and original Dashboard header; corrected behavior passes.
- Fixture browser: zero Job-detail reads on opening; selected first filter submitted on Apply; export disabled initially and exports the applied query despite draft edits.
- Delayed focus check preserves grid and draft filters with no Checking inquiry access screen and no new record fetch when grants are unchanged.
- Existing expiry, revoked access, stale-response, filtering, export, Job-tab and 320/375/390/768 header/layout checks pass; zero browser page errors.
- Admin popup checks at320/390/1440: no shortcut links in the compact header, hidden metadata until [i] is opened, Refresh inside popup, Escape dismissal, no popup or page overflow. Long mock company name and unbroken tenant identifier also pass at320.
- All browser API responses are fixtures and non-localhost traffic is blocked. No real-tenant UAT or N3 write was performed.
- 62 files / 1,056 tests pass; typecheck, final production build, ESLint for all changed product files and git diff --check pass.
- Independent reviewer ran100 affected tests, reported no Critical or Important findings, and suggested wrapping long popup identity text. That wrapping is implemented and covered by the long-identity browser fixture.
- Prior repository-wide CI has existing lint debt; changed-file lint passing is not a claim that repository-wide CI is clean.

## Release and owner UAT

Await approval of the exact review candidate before merge and Lovable publish. After release: open Inquiry and confirm no records; Apply a chosen filter; alt-tab away/back and confirm the grid stays visible; open Dashboard [i] on desktop/phone; confirm the three redundant shortcuts are absent and Refresh is inside [i].
