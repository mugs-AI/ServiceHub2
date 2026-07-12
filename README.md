# ServiceHub2 — N3 AI Cloud Accounting integration

A service-maintenance console for N3 (QNE) AI Cloud Accounting. Track
customer contract status, map stock codes as Maintenance / Renewal or
Ad-hoc Service, and browse live customers, stock, sales invoices,
delivery orders and N3 users through a same-origin backend proxy.

## Architecture

- **Frontend**: React + Vite + TypeScript (TanStack Router / Start).
  The browser only calls this app's own `/api/*` routes.
- **Backend**: TanStack Start server routes (same-origin) that forward
  requests to the N3 Open API with the caller's Bearer JWT.
  Base URLs live in server-side env vars only and never ship to the
  browser bundle. This is functionally equivalent to the "Node + Express
  proxy" pattern from the N3 development brief.
- **Persistence**: Lovable Cloud (Postgres) hosts tenant-scoped snapshot
  tables (`customer_snapshots`, `stock_snapshots`,
  `customer_contract_snapshots`, `renewal_stock_mappings`,
  `general_settings`, `notifications`, `snapshot_sync_logs`,
  `snapshot_health`). All rows carry `tenant_code`; RLS is deny-default
  and every read/write goes through server routes that resolve the
  tenant from the authenticated N3 session.

## Environment (server-side only)

```
OPEN_API_BASE_URL=https://openapi.account.qne.cloud
OPEN_API_REPORTING_BASE_URL=https://openapi-reporting.account.qne.cloud
```

Both fall back to the production defaults above if unset.

## Authentication

### Production (Path A — required)
1. Deploy this app to a public HTTPS URL and register that URL in N3 →
   My Apps as the App URL for ServiceHub2.
2. When a user opens the app from My Apps, N3 appends `?token=<jwt>`.
   On startup the app reads the token, saves it to
   `localStorage['qne_access_token']`, and calls
   `history.replaceState({}, '', location.pathname)` to strip it from
   the address bar.
3. Subsequent reloads read the JWT from localStorage. A 401 clears the
   token and shows an "Open from My Apps" screen (no API-key login is
   ever offered in production).

### Local development (Path B — dev only)
1. Run `bun run dev` (or `npm run dev`). If no JWT is in localStorage,
   an API-key connect form is shown.
2. Submitting the form calls `POST /api/auth/connect`, which proxies
   `GET https://openapi.account.qne.cloud/api/auth/connect?api-key=…`
   and persists the returned JWT to localStorage under the same key
   used in production.
3. After one successful connect, restarting the dev server or
   rebuilding the app opens straight into an authenticated session.
   The API key is never persisted — only the JWT.
4. `POST /api/auth/connect` returns 404 when
   `process.env.NODE_ENV === 'production'`, and the dev-only login UI
   is gated behind `import.meta.env.DEV`, so neither the route nor the
   form is reachable in a production build.

**Never commit an API key.** Treat it like a password.

## Session context

On every authenticated load, `GET /api/companyprofile/BasicInfo` is
called through the proxy and the returned company name, tenant code,
and user email are shown in the app header. This is refreshed on each
load — not cached in sessionStorage — as required by the N3 brief.

## N3 Open API scopes used (Phase 1)

Discovered via `GET /doc/index.json` on the two Open API hosts. The
initial slice touches:

- **`platform-v1`** — company profile, users
  - `GET /api/companyprofile/BasicInfo`
  - `GET /api/user`
- **Subsidiary / master data**
  - `GET /api/customer` — customers list
  - `GET /api/stock` — stock master
- **Sales transactions**
  - `GET /api/salesinvoice`
  - `GET /api/deliveryorder`

Endpoint paths are user-editable in the list explorer UI so different
tenant configurations can be probed without a code change. Additional
scopes will be added as Jobs, Approvals and Reporting features land in
later phases.

## Phase roadmap

Phase 1 (this build):
- Same-origin proxy + Path A/B auth + session header
- Read-only Customers / Stock / Invoices / DO / Users explorers
- Stock-code mapping (Maintenance / Ad-hoc) in Settings
- Customer Service Console: search + contract status (Active / Due
  Soon / Overdue / Unknown) using latest qualifying Invoice or DO

Deferred to later phases:
- Service Jobs (workflow, comments, attachments, reassignment,
  vendor referral, approvals)
- Quick Job mobile flow
- Reports workspace + Excel export
- Fine-grained role experience
- Lovable Cloud migration for tenant-scoped storage
