# WP2B — Google Drive Job Attachments (Preflight Plan)

Run ID: SH22-WP2B-PREFLIGHT-20260901
Baseline verified: project `9265adcd-acf6-4fdb-a766-3fc21310ee8f`, repo `ServiceHub2`, SHA `7c56fd3a0ae5071b75fdec2cce3b0a5b3d5c3b57`, clean tree. BASELINE OK.
Inspection only — nothing was edited, migrated, deployed or published.

## Current state (verified by reading the code)

- `src/routes/api/workspace/jobs.$jobId.attachments.ts` exists with GET/POST/DELETE against the private Supabase bucket `job-attachments`. POST is fail-closed by `ATTACHMENT_BYTES_ENABLED = false` in `src/lib/qne/storage/attachment-bytes.ts`.
- `src/components/qne/AttachmentsPanel.tsx` exists but is **not mounted** anywhere; `src/routes/jobs.$jobId.tsx` currently mounts neither `AttachmentsPanel` nor `FieldOperationsPanel` (the WP1 freeze removed the latter).
- `service_job_attachments` already carries `storage_provider`, `storage_connection_id`, `storage_container`, `external_file_id`, `checksum`, `availability_status` (migration `20260802003847_…`), plus soft-delete columns. Google Drive rows fit without a schema rewrite.
- WP2A Drive engine (`src/lib/qne/storage/google-drive.server.ts`) already provides: `loadConnection`, `accessTokenFor` (refresh + rotation + fail-closed `needs_reconnect`), `revalidateFolder`, `createRootFolder`, `readSharing`, `applyConnection` (atomic mutate+audit), `auditDrive`. It has **no file upload / download / trash** calls yet.
- `src/lib/qne/storage/provider.server.ts` returns a `pendingAdapter` for `google_drive` — the seam to implement.
- Validation in `field-ops.ts` (`validateAttachment`) currently caps at 15 MB and has its own MIME/extension lists; limits differ from WP2B (20 MB/file, 10 files, 100 MB/job).
- Google account/root-folder mutations live in `src/routes/api/integrations/google-drive/connection.ts` (`disconnect`, `create_folder`, `select_folder`) and the OAuth callback — the guard points.

## 1) Files and migrations to change

New:
- `src/lib/qne/storage/drive-files.server.ts` — Drive file vertical: ensure `Root/ServiceHub Jobs/{job_number}` folder chain (create-or-reuse, cached in a mapping table), resumable/multipart upload, metadata read, `files.update {trashed:true}`, media download stream.
- `src/lib/qne/storage/attachment-policy.ts` — pure WP2B limits/allowlist (20 MB, 10 active, 100 MB, MIME+extension pairs, blocklist), shared by client and server.
- `src/routes/api/workspace/jobs.$jobId.attachments.$attachmentId.content.ts` — server-proxied download/preview (no Drive token to the browser).
- `src/components/qne/JobAttachmentsCard.tsx` — compact card: multi-file queue, per-file progress/error/retry, preview for image/PDF, download otherwise, delete when permitted.
- Tests (below).

Modified:
- `src/lib/qne/storage/attachment-bytes.ts` — enable bytes for Google Drive only; Supabase production writes stay refused (no silent fallback).
- `src/lib/qne/storage/provider.server.ts` — real `google_drive` adapter delegating to `drive-files.server.ts`; Supabase adapter keeps read/link for legacy rows, loses `put`.
- `src/routes/api/workspace/jobs.$jobId.attachments.ts` — tenant/job access check, WP2B server-side validation (MIME, extension, size, active count, job total), Drive upload, metadata insert with `external_file_id`/folder mapping, audit; DELETE performs Drive trash first and only soft-deletes on confirmed trash.
- `src/lib/qne/service-jobs/field-ops.ts` — `validateAttachment` re-pointed at `attachment-policy.ts` (single source of truth).
- `src/routes/jobs.$jobId.tsx` — mount the compact card only; `FieldOperationsPanel` stays unmounted.
- `src/routes/api/integrations/google-drive/connection.ts` + `callback.ts` — provider-switch guard.
- `src/lib/qne/service-jobs/wp1-session-integrity.test.ts` — keep the freeze assertion valid alongside the new card.

Migration (one, additive):
- `service_job_job_folders` (tenant_code, service_job_id, connection_id, drive_folder_id, job_number, created_at/updated_at, unique per tenant+job+connection) with GRANTs to `service_role` only, RLS enabled, no anon/authenticated policies (server-role access only, matching the existing Drive tables).
- Add `remote_delete_status text NOT NULL DEFAULT 'n/a'`, `remote_delete_error text`, `remote_deleted_at timestamptz` to `service_job_attachments` for truthful trash retry/reconciliation.
- Partial index for the active-count/total queries.

## 2) Schema compatibility and migration strategy

Existing legacy rows (`storage_provider='supabase'`) are untouched and remain listable/downloadable through the existing signed-URL path; only new bytes are refused for Supabase. New rows write `storage_provider='google_drive'`, `storage_connection_id` = active connection id, `storage_container` = job folder id, `external_file_id` = Drive file id, `storage_path` = the human path `ServiceHub Jobs/{job_number}/{file}` (kept non-null for compatibility, never used to address Drive). No column is dropped, renamed or backfilled destructively. Generated `src/integrations/supabase/types.ts` regenerates after the migration is approved; code touching the new columns lands after that.

## 3) Access-control plan

- Server always derives tenant from the N3 session (`requireAuthenticatedN3User`); job is loaded by `tenant_code` + `id`, 404 otherwise. No browser-supplied provider path, folder id, or token.
- List / view / download / upload: any authenticated same-tenant user who can load the Job. Visibility is forced to `internal` for v1; the visibility selector is removed from the new card and the server rejects any other value.
- Delete: uploader (`uploaded_by_user_id`), current Primary PIC (`assigned_user_id`), or Owner/Admin (`isAdministrator`) — expressed as a pure predicate in `attachment-policy.ts` so UI and server cannot drift, enforced server-side.
- Preview/download goes through the server proxy route which re-authorizes on every request and streams bytes; Drive access/refresh tokens never reach the browser and no long-lived Drive link is issued.
- Every upload, view/download, delete, failure and retry writes an audit row with the real actor (`service_job_activity_log` for job history + `google_drive_audit_log` for provider actions); audit failure aborts the operation (existing `AuditWriteError` contract).

## 4) Provider-switch guard plan

- New server helper `activeDriveAttachmentCount(tenantCode)`.
- Block, with an explicit message, when active Google Drive attachments exist: `disconnect`, `create_folder`, `select_folder` (root-folder change), the settings `set_mode`/`disconnect`/`set_root_folder` actions, and a callback that returns a **different** Google account (`permissionId` mismatch) — the callback fails closed and revokes the new grant, preserving the known-good connection (WP2A behaviour retained).
- Allowed unchanged: same-account token refresh and same-account reconnect keeping the identical root folder.
- No automatic migration of existing bytes in v1; the message names the count and tells the Owner what must happen first.

## 5) Test plan

Pure/unit: `attachment-policy.test.ts` — size/count/total boundaries (20 MB, 10 active, 100 MB), MIME+extension allow/deny matrix incl. HEIC/WebP/DOCX/XLSX/ZIP and rejection of exe/script/macro/video, MIME-vs-extension mismatch, delete-permission matrix (uploader / PIC / admin / unrelated teammate).

Route-level (existing mock-Supabase style, e.g. `wp0e-routes.test.ts`): upload rejects cross-tenant and inaccessible jobs; upload refused when no accepted active connection or `needs_reconnect`; count/total enforced server-side even if the client lies; content route re-authorizes and never returns a Drive token; delete by unauthorized actor is 403; **Drive trash failure returns an error and leaves the row active with truthful `remote_delete_status`**; successful delete soft-deletes and audits.

Guard tests: disconnect / root-folder change / account change blocked with active Drive attachments; same-account refresh and reconnect allowed.

Regression: Supabase POST still refused (no new production bytes, no fallback); legacy rows still listed and downloadable; `FieldOperationsPanel` remains unmounted; existing 517-test suite, typecheck, ESLint on changed files, and production build all green.

## 6) Risks and blockers

- **Live Google behaviour remains NOT VERIFIED** in this environment — upload, trash, and job-folder creation can only be proven against real credentials (`GOOGLE_DRIVE_CLIENT_ID/SECRET/REDIRECT_URI`, `GOOGLE_DRIVE_TOKEN_ENC_KEY`). Plan assumes these are configured; if absent the vertical stays fail-closed with an explicit message.
- Cloudflare Worker runtime: large uploads must stream; 20 MB per file is within request limits but the proxy download must stream rather than buffer.
- `drive.file` scope only reaches files this app created — correct for WP2B, but it means the ServiceHub Jobs subtree must be created by ServiceHub; folders the user made by hand outside the picker are not addressable.
- HEIC has an unreliable browser MIME (`image/heic` vs empty) — the policy must accept extension-based fallback for HEIC while keeping the blocklist strict.
- Trash failure handling deliberately leaves the attachment visible; product must accept "delete can fail and say so".
- Existing generated-types drift and pre-existing Prettier debt in `jobs.$jobId.tsx` are untouched.
- Two migrations require owner approval before any code that reads the new columns can typecheck.
