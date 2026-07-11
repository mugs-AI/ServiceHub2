## ServiceHub2 — N3 AI Cloud Accounting integration

The brief describes a full multi-tenant ServiceHub with jobs, approvals, roles, reports, mobile flows, attachments and more. That is several weeks of work. I'll build it in phases and start with **Phase 1 (foundation + auth + read-only N3 data)** so you can verify the integration end-to-end before we invest in the Jobs domain.

### Stack mapping (satisfies brief's architecture rule)

The brief says "React + Vite + TS frontend, Node + Express backend". This project is TanStack Start on Cloudflare Workers, which is functionally equivalent:
- **Frontend**: React + Vite + TS SPA under `src/routes/*` (browser talks only to same-origin `/api/*`).
- **Backend**: TanStack **server routes** under `src/routes/api/*` — same-origin, holds N3 base URLs in `process.env`, forwards `Authorization: Bearer <jwt>` to N3. This is the required proxy layer; the browser never calls `openapi.account.qne.cloud`.
- **Persistence for Jobs/Settings/Approvals**: Lovable Cloud (Postgres + RLS), keyed by N3 `tenantCode` for multi-tenant isolation.

### Phase 1 (this build)

1. **Env + proxy backbone**
   - `OPEN_API_BASE_URL`, `OPEN_API_REPORTING_BASE_URL` server-only env with sane defaults.
   - `POST /api/proxy/main/*` and `POST /api/proxy/reporting/*` — forward method, path, query, body, and the caller's Bearer token to N3. Return the raw JSON response.
   - Shared `unwrapApiResponse` and `unwrapPageList` helpers used on both server and client.

2. **Auth (Paths A + B)**
   - On app load: read `?token=` → save to `localStorage['qne_access_token']` → `history.replaceState` to strip it.
   - Else: use JWT from localStorage.
   - Else in **dev only** (`import.meta.env.DEV`): show API-key connect form → `POST /api/auth/connect` (dev-only server route; returns 404 when `process.env.NODE_ENV === 'production'`) → proxies `GET /api/auth/connect?api-key=…` → persists returned JWT.
   - Else in prod: "Open from My Apps" screen.
   - 401 anywhere → clear token, prompt relaunch (prod) or re-connect (dev).

3. **Session header**
   - On every authenticated load, call `GET /api/companyprofile/BasicInfo` via the proxy and show **company name / tenant code / user email** in the app chrome. Refreshed on load, not cached in sessionStorage.

4. **Scope discovery**
   - Fetch `/doc/index.json` once server-side, cache, and expose a `/api/scopes` route the frontend uses to know which N3 scopes are available. README documents the specific scopes we implemented.

5. **Read-only N3 data screens** (proof the proxy works, feeds later phases)
   - **Customers list** (search + paginate) from N3.
   - **Stock codes list** (search + paginate) from N3.
   - **Sales Invoices** and **Delivery Orders** list for a selected customer.
   - **N3 Users** list (`platform-v1`) — used later for Assignee pickers.
   - All lists parse `PageQueryResult` correctly (`data.value` / `data.count`).

6. **Settings shell (Administrator only)**
   - Stock-code mapping UI: mark N3 stock codes as **Maintenance/Renewal** (with duration days: 365 / 183 / custom) or **Ad Hoc Service**. Stored in Lovable Cloud, scoped by tenantCode.
   - No admin role invention — "Administrator" gate = a Lovable Cloud `tenant_admins` table seeded on first login of a given tenant with the current user email (bootstrap). Documented so you can revise once N3 exposes an official admin claim.

7. **Customer Service Console (read-only status)**
   - Search customer → show latest qualifying Invoice/DO based on mapped Maintenance stock codes → compute Active / Due Soon / Overdue / Unknown + expiry date + remaining days. No job creation yet.

8. **Docs**
   - `README.md` with: Local development (Path B, JWT persistence, key never committed), Production (My Apps launch only), list of N3 scopes used and endpoints called.

### Explicitly deferred (later phases, on your go-ahead)

- Service Job CRUD, job number generator, workflow states, comments, attachments, reassignment, vendor referral, approval rules.
- Quick Job mobile flow.
- Reports workspace + Excel export.
- Fine-grained role experience beyond Admin vs Support.
- Suspended status (needs official N3 signal).

### Assumptions (flag now if wrong)

- Lovable Cloud (Postgres) is acceptable for the ServiceHub-owned tables (Jobs, settings, approvals). Alternative is to store them via a separate service, but Cloud keeps everything one deploy.
- "Administrator" bootstrap = first user of a tenant; you can grant more admins from Settings. No N3-side admin claim is assumed.
- Cloudflare Worker runtime is fine as the "backend" since it's same-origin and holds env server-side — this matches the brief's intent even though it isn't literally Node+Express.

### Confirm to proceed

Reply "go" and I'll build Phase 1. If you want a different starting slice (e.g. skip Cloud and jobs entirely, or start with Jobs skeleton first), say so and I'll re-plan.
