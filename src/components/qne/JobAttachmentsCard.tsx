// WP2B — compact "Job Attachments" card for the Service Job detail page.
//
// Internal-only in v1. Everything shown here is decided by the server: the
// list, the per-file quota, whether Delete may appear, and whether a file can
// be previewed. Hiding a control is convenience, not authorisation — the API
// re-checks every request.
//
// Bytes are never addressed by a provider URL from the browser: previews and
// downloads go through the authorised ServiceHub content route.

import { useCallback, useEffect, useRef, useState } from "react";

import {
  ACCEPT_ATTRIBUTE,
  MAX_ACTIVE_FILES,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  effectiveMime,
  formatBytes,
  sanitizeDisplayName,
  validateCandidate,
} from "@/lib/qne/storage/attachment-policy";
import { getStoredToken } from "@/lib/qne/tokens";

interface Attachment {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  provider: string;
  uploadedByName: string | null;
  uploadedAt: string;
  previewable: boolean;
  canDelete: boolean;
  remoteDeleteStatus: string | null;
  remoteDeleteError: string | null;
  contentPath: string | null;
  legacyUrl: string | null;
}

interface Quota {
  activeCount: number;
  activeBytes: number;
  maxFiles: number;
  maxTotalBytes: number;
  maxFileBytes: number;
}

type QueueState = "queued" | "uploading" | "success" | "failed";

interface QueueItem {
  key: string;
  file: File;
  displayName: string;
  state: QueueState;
  error: string | null;
}

function authHeaders(): Record<string, string> {
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function JobAttachmentsCard({ jobId }: { jobId: string }) {
  const [items, setItems] = useState<Attachment[]>([]);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [preview, setPreview] = useState<Attachment | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/workspace/jobs/${jobId}/attachments`, {
        headers: authHeaders(),
      });
      const body = (await res.json().catch(() => ({}))) as {
        attachments?: Attachment[];
        quota?: Quota;
        error?: string;
      };
      if (!alive.current) return;
      if (!res.ok) {
        setErr(body.error ?? "Attachments could not be loaded.");
        return;
      }
      setErr(null);
      setItems(body.attachments ?? []);
      setQuota(body.quota ?? null);
    } catch {
      if (alive.current) setErr("Attachments could not be loaded.");
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  const uploadOne = useCallback(
    async (item: QueueItem, isRetry: boolean): Promise<{ ok: boolean; error?: string }> => {
      const form = new FormData();
      form.append("file", item.file, item.displayName);
      // Bounded, non-authority-bearing marker so the server can audit the
      // retry. It grants nothing: every check is repeated server-side.
      if (isRetry) form.append("retry", "1");
      try {
        const res = await fetch(`/api/workspace/jobs/${jobId}/attachments`, {
          method: "POST",
          headers: authHeaders(),
          body: form,
        });
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          recovery?: string;
        };
        if (!res.ok) {
          return {
            ok: false,
            error: [body.error, body.recovery].filter(Boolean).join(" ") || "Upload failed.",
          };
        }
        return { ok: true };
      } catch {
        return { ok: false, error: "The upload could not reach ServiceHub. Nothing was saved." };
      }
    },
    [jobId],
  );

  const runQueue = useCallback(
    async (pending: QueueItem[], isRetry = false) => {
      setBusy(true);
      // Sequential: the server enforces per-Job count and total limits, and
      // parallel uploads would race those checks.
      for (const item of pending) {
        setQueue((q) =>
          q.map((x) => (x.key === item.key ? { ...x, state: "uploading", error: null } : x)),
        );
        const result = await uploadOne(item, isRetry);
        if (!alive.current) return;
        setQueue((q) =>
          q.map((x) =>
            x.key === item.key
              ? { ...x, state: result.ok ? "success" : "failed", error: result.error ?? null }
              : x,
          ),
        );
      }
      await load();
      if (alive.current) setBusy(false);
    },
    [load, uploadOne],
  );

  const onPick = useCallback(
    (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      const picked: QueueItem[] = [];
      const rejected: QueueItem[] = [];
      for (const file of Array.from(fileList)) {
        const displayName = sanitizeDisplayName(file.name);
        const verdict = validateCandidate({
          name: displayName,
          type: effectiveMime({ name: displayName, type: file.type, size: file.size }),
          size: file.size,
        });
        const base: QueueItem = {
          key: `${displayName}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          file,
          displayName,
          state: "queued",
          error: null,
        };
        // Client-side checks are a courtesy so obvious rejects never leave the
        // device; the server repeats every one of them.
        if (verdict.ok) picked.push(base);
        else rejected.push({ ...base, state: "failed", error: verdict.error });
      }
      setQueue((q) => [...q, ...picked, ...rejected]);
      if (inputRef.current) inputRef.current.value = "";
      if (picked.length) void runQueue(picked);
    },
    [runQueue],
  );

  const retry = useCallback(
    (key: string) => {
      const item = queue.find((x) => x.key === key);
      if (!item || busy) return;
      void runQueue([{ ...item, state: "queued", error: null }]);
    },
    [busy, queue, runQueue],
  );

  const remove = useCallback(
    async (att: Attachment) => {
      if (deleting) return;
      if (
        !window.confirm(
          `Delete "${att.fileName}"? The file will be moved to Trash in Google Drive.`,
        )
      ) {
        return;
      }
      setDeleting(att.id);
      try {
        const res = await fetch(
          `/api/workspace/jobs/${jobId}/attachments?id=${encodeURIComponent(att.id)}`,
          { method: "DELETE", headers: authHeaders() },
        );
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          recovery?: string;
        };
        if (!res.ok) {
          setErr([body.error, body.recovery].filter(Boolean).join(" ") || "Delete failed.");
        } else {
          setErr(null);
        }
      } catch {
        setErr("The delete request could not reach ServiceHub. Nothing was deleted.");
      } finally {
        await load();
        if (alive.current) setDeleting(null);
      }
    },
    [deleting, jobId, load],
  );

  const openHref = (att: Attachment, download: boolean) =>
    att.contentPath ? `${att.contentPath}${download ? "?download=1" : ""}` : (att.legacyUrl ?? "#");

  const atFileLimit = (quota?.activeCount ?? 0) >= (quota?.maxFiles ?? MAX_ACTIVE_FILES);

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Job Attachments</h2>
        <span className="text-xs text-muted-foreground">
          Internal only · {quota?.activeCount ?? items.length}/{quota?.maxFiles ?? MAX_ACTIVE_FILES}{" "}
          files · {formatBytes(quota?.activeBytes ?? 0)} of{" "}
          {formatBytes(quota?.maxTotalBytes ?? MAX_TOTAL_BYTES)}
        </span>
      </div>

      <p className="mt-1 text-xs text-muted-foreground">
        Up to {formatBytes(MAX_FILE_BYTES)} per file. Photos, PDF, text, Office documents and ZIP.
      </p>

      {err && (
        <p className="mt-2 rounded border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          {err}
        </p>
      )}

      <div className="mt-3">
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT_ATTRIBUTE}
          className="hidden"
          onChange={(e) => onPick(e.target.files)}
        />
        <button
          type="button"
          className="rounded border border-border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          disabled={busy || atFileLimit}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? "Uploading…" : "Add files"}
        </button>
        {atFileLimit && (
          <span className="ml-2 text-xs text-muted-foreground">
            This Job has reached the {quota?.maxFiles ?? MAX_ACTIVE_FILES} file limit.
          </span>
        )}
      </div>

      {queue.length > 0 && (
        <ul className="mt-3 space-y-1">
          {queue.map((q) => (
            <li
              key={q.key}
              className="flex flex-wrap items-center gap-2 rounded border border-border px-2 py-1 text-xs"
            >
              <span className="min-w-0 flex-1 truncate">{q.displayName}</span>
              <span
                className={
                  q.state === "failed"
                    ? "text-destructive"
                    : q.state === "success"
                      ? "text-muted-foreground"
                      : ""
                }
              >
                {q.state === "queued" && "Queued"}
                {q.state === "uploading" && "Uploading…"}
                {q.state === "success" && "Uploaded"}
                {q.state === "failed" && "Failed"}
              </span>
              {q.state === "failed" && (
                <>
                  <span className="w-full text-destructive">{q.error}</span>
                  <button
                    type="button"
                    className="rounded border border-border px-2 py-0.5"
                    disabled={busy}
                    onClick={() => retry(q.key)}
                  >
                    Retry
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {loading ? (
        <p className="mt-3 text-xs text-muted-foreground">Loading attachments…</p>
      ) : items.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">No attachments yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {items.map((att) => (
            <li key={att.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-xs">
              <span className="min-w-0 flex-1 truncate font-medium" title={att.fileName}>
                {att.fileName}
              </span>
              <span className="text-muted-foreground">{formatBytes(att.fileSize)}</span>
              <span className="hidden text-muted-foreground sm:inline">
                {att.uploadedByName ?? "Unknown"}
              </span>
              {att.previewable && (
                <button
                  type="button"
                  className="rounded border border-border px-2 py-0.5"
                  onClick={() => setPreview(att)}
                >
                  Preview
                </button>
              )}
              <a
                className="rounded border border-border px-2 py-0.5"
                href={openHref(att, true)}
                target="_blank"
                rel="noreferrer"
              >
                Download
              </a>
              {att.canDelete && (
                <button
                  type="button"
                  className="rounded border border-destructive/50 px-2 py-0.5 text-destructive disabled:opacity-50"
                  disabled={deleting === att.id}
                  onClick={() => void remove(att)}
                >
                  {deleting === att.id ? "Deleting…" : "Delete"}
                </button>
              )}
              {att.remoteDeleteStatus === "failed" && (
                <span className="w-full text-destructive">
                  Still active — Google Drive could not move this file to Trash.{" "}
                  {att.remoteDeleteError}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-label={`Preview of ${preview.fileName}`}
          onClick={() => setPreview(null)}
        >
          <div
            className="flex h-full w-full max-w-3xl flex-col rounded-lg bg-card p-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 pb-2">
              <span className="truncate text-sm font-medium">{preview.fileName}</span>
              <button
                type="button"
                className="rounded border border-border px-2 py-0.5 text-xs"
                onClick={() => setPreview(null)}
              >
                Close
              </button>
            </div>
            {preview.mimeType.startsWith("image/") ? (
              <img
                src={openHref(preview, false)}
                alt={preview.fileName}
                className="min-h-0 flex-1 object-contain"
              />
            ) : (
              <iframe
                src={openHref(preview, false)}
                title={preview.fileName}
                className="min-h-0 flex-1 rounded border border-border"
              />
            )}
          </div>
        </div>
      )}
    </section>
  );
}
