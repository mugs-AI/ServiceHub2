// Attachments panel (Run 7 Phase I/J).
// Private-bucket uploads with browser-side image compression, tenant limits,
// type + visibility tagging, preview and audited delete.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { formatMYDateTime } from "@/lib/format-date";
import { getStoredToken } from "@/lib/qne/tokens";
import {
  ATTACHMENT_TYPES,
  ATTACHMENT_TYPE_LABEL,
  VISIBILITIES,
  VISIBILITY_LABEL,
  type AttachmentType,
} from "@/lib/qne/service-jobs/field-ops";
import { compressImage, formatBytes, isCompressibleImage } from "@/lib/qne/service-jobs/image-compress";
import {
  DEFAULT_TENANT_SETTINGS,
  mergeTenantSettings,
  type AttachmentSettings,
} from "@/lib/qne/service-jobs/tenant-settings";

export interface AttachmentRow {
  id: string;
  attachment_type: string;
  file_name: string;
  mime_type: string | null;
  file_size: number | null;
  visibility: string;
  uploaded_by_name_snapshot: string | null;
  created_at: string;
  url: string | null;
}

function authHeaders(): Record<string, string> {
  const t = getStoredToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

const BTN =
  "min-h-11 rounded-md border px-3 text-sm font-semibold transition-colors hover:bg-accent disabled:opacity-50";
const BTN_PRIMARY =
  "min-h-11 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50";

function limitMB(settings: AttachmentSettings, type: string, mime: string): number {
  if (type === "error_screenshot") return settings.maxScreenshotMB;
  if (mime.startsWith("image/")) return settings.maxPhotoMB;
  return settings.maxDocumentMB;
}

export function AttachmentsPanel({
  jobId,
  locked,
  onCountChange,
}: {
  jobId: string;
  locked: string | null;
  onCountChange?: (n: number) => void;
}) {
  const [rows, setRows] = useState<AttachmentRow[]>([]);
  const [settings, setSettings] = useState<AttachmentSettings>(DEFAULT_TENANT_SETTINGS.attachments);
  const [type, setType] = useState<AttachmentType>("error_screenshot");
  const [visibility, setVisibility] = useState<string>("internal");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/workspace/jobs/${jobId}/attachments`, {
        headers: authHeaders(),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      const list = (body.attachments ?? []) as AttachmentRow[];
      setRows(list);
      onCountChange?.(list.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load attachments.");
    }
  }, [jobId, onCountChange]);

  useEffect(() => {
    void load();
    void (async () => {
      try {
        const res = await fetch("/api/settings/tenant", { headers: authHeaders() });
        const body = await res.json().catch(() => ({}));
        if (res.ok && body?.settings) {
          setSettings(mergeTenantSettings(body.settings).attachments);
        }
      } catch {
        /* defaults are fine */
      }
    })();
  }, [load]);

  const usedBytes = useMemo(
    () => rows.reduce((n, r) => n + (r.file_size ?? 0), 0),
    [rows],
  );
  const quotaPct = Math.round(
    (usedBytes / (settings.maxTotalMBPerJob * 1024 * 1024)) * 100,
  );
  const storageOff = settings.storageMode === "disabled";

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      for (const raw of Array.from(files)) {
        if (rows.length >= settings.maxPerJob) {
          throw new Error(`This Job already has the maximum of ${settings.maxPerJob} attachments.`);
        }
        let file: File = raw;
        if (settings.compressionEnabled && isCompressibleImage(raw.type)) {
          const out = await compressImage(raw, {
            maxDimension: settings.maxDimension,
            quality: settings.imageQuality,
          });
          file = out.file;
          if (out.file.size < raw.size) {
            setNotice(
              `Compressed ${raw.name}: ${formatBytes(raw.size)} → ${formatBytes(out.file.size)}.`,
            );
          }
        }
        const capMB = limitMB(settings, type, file.type);
        if (file.size > capMB * 1024 * 1024) {
          throw new Error(
            `${file.name} is ${formatBytes(file.size)} — the limit for this file type is ${capMB} MB.`,
          );
        }
        if (usedBytes + file.size > settings.maxTotalMBPerJob * 1024 * 1024) {
          throw new Error(
            `Uploading ${file.name} would exceed the ${settings.maxTotalMBPerJob} MB storage limit for this Job.`,
          );
        }

        const form = new FormData();
        form.append("file", file);
        form.append("attachment_type", type);
        form.append("visibility", visibility);
        const res = await fetch(`/api/workspace/jobs/${jobId}/attachments`, {
          method: "POST",
          headers: authHeaders(),
          body: form,
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove(id: string, name: string) {
    if (!window.confirm(`Delete "${name}"? This is recorded in the Job history.`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/workspace/jobs/${jobId}/attachments?id=${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm sm:p-6">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <h2 className="truncate text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Attachments ({rows.length}/{settings.maxPerJob})
        </h2>
        <button type="button" onClick={() => void load()} className={BTN + " shrink-0 text-xs"}>
          Refresh
        </button>
      </div>

      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={
            "h-full " + (quotaPct >= settings.warnThresholdPct ? "bg-amber-500" : "bg-primary")
          }
          style={{ width: `${Math.min(100, quotaPct)}%` }}
        />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {formatBytes(usedBytes)} of {settings.maxTotalMBPerJob} MB used ({quotaPct}%) · Images are
        compressed to {settings.maxDimension}px · Videos are not accepted.
      </p>

      {storageOff && (
        <p className="mt-3 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          Attachment storage is disabled for this tenant. An Owner can enable it in Settings →
          Attachments &amp; Storage.
        </p>
      )}
      {locked && (
        <p className="mt-3 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          {locked} Uploads are disabled.
        </p>
      )}
      {error && (
        <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p className="mt-3 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          {notice}
        </p>
      )}

      {!locked && !storageOff && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            value={type}
            onChange={(e) => setType(e.target.value as AttachmentType)}
            className="min-h-11 rounded-md border bg-background px-2 text-sm"
          >
            {ATTACHMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {ATTACHMENT_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value)}
            className="min-h-11 rounded-md border bg-background px-2 text-sm"
          >
            {VISIBILITIES.map((v) => (
              <option key={v} value={v}>
                {VISIBILITY_LABEL[v]}
              </option>
            ))}
          </select>
          <input
            ref={inputRef}
            type="file"
            multiple
            disabled={busy}
            onChange={(e) => void upload(e.target.files)}
            className="max-w-full text-sm"
          />
          {busy && <span className="text-xs text-muted-foreground">Uploading…</span>}
        </div>
      )}

      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {rows.map((r) => {
          const isImage = (r.mime_type ?? "").startsWith("image/");
          return (
            <li key={r.id} className="rounded-lg border bg-background/60 p-3">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{r.file_name}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {ATTACHMENT_TYPE_LABEL[r.attachment_type as AttachmentType] ??
                      r.attachment_type}{" "}
                    · {r.visibility === "internal" ? "Internal" : "Visible to customer"} ·{" "}
                    {formatBytes(r.file_size ?? 0)}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatMYDateTime(r.created_at)} · {r.uploaded_by_name_snapshot ?? "—"}
                  </p>
                </div>
                {r.url && isImage && (
                  <img
                    src={r.url}
                    alt={r.file_name}
                    loading="lazy"
                    className="h-16 w-16 shrink-0 rounded-md object-cover"
                  />
                )}
              </div>
              <div className="mt-2 flex gap-2">
                {r.url && (
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noreferrer"
                    className={BTN + " inline-flex items-center"}
                  >
                    Open
                  </a>
                )}
                {!locked && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void remove(r.id, r.file_name)}
                    className={BTN + " text-destructive"}
                  >
                    Delete
                  </button>
                )}
              </div>
            </li>
          );
        })}
        {rows.length === 0 && (
          <li className="rounded-md border border-dashed px-3 py-6 text-center text-xs text-muted-foreground sm:col-span-2">
            No attachments yet.
          </li>
        )}
      </ul>
    </section>
  );
}
