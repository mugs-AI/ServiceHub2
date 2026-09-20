// WP3A — Completed Job reopen request and Owner/Admin decision.
//
// Rendered inside the completion card's locked / legacy view. A request never
// reopens the Job: it records one pending request plus activity evidence, and
// only an Owner/Admin decision can return the Job to In Progress. Every rule
// is re-checked on the server inside the reopen transaction; hiding a control
// is convenience, not authorisation.

import { useCallback, useEffect, useState } from "react";

import { formatMYDateTime } from "@/lib/format-date";
import { MAX_REOPEN_NOTE, MAX_REOPEN_REASON } from "@/lib/qne/service-jobs/wp3a-reopen";
import { getStoredToken } from "@/lib/qne/tokens";

import type { ReopenRequestRow, ReopenView } from "@/lib/qne/service-jobs/wp3a-reopen";

function authHeaders(): Record<string, string> {
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

interface ReopenState {
  jobStatus: string;
  isAdmin: boolean;
  view: ReopenView;
  history: ReopenRequestRow[];
}

export function JobReopenSection({
  jobId,
  onChanged,
}: {
  jobId: string;
  onChanged?: () => void;
}) {
  const [state, setState] = useState<ReopenState | null>(null);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/workspace/jobs/${jobId}/reopen`, { headers: authHeaders() });
      const json = (await res.json()) as ReopenState & { error?: string };
      if (!res.ok) throw new Error(json.error || "Failed to load reopen state");
      setState(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load reopen state");
    }
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  const submitRequest = useCallback(async () => {
    if (busy) return;
    setBusy("request");
    setError(null);
    try {
      const res = await fetch(`/api/workspace/jobs/${jobId}/reopen`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Failed to request reopen");
      setOpen(false);
      setReason("");
      await load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to request reopen");
    } finally {
      setBusy(null);
    }
  }, [busy, jobId, load, onChanged, reason]);

  const decide = useCallback(
    async (decision: "approve" | "reject", requestId: string) => {
      if (busy) return;
      setBusy(decision);
      setError(null);
      try {
        const res = await fetch(`/api/workspace/jobs/${jobId}/reopen/decision`, {
          method: "POST",
          headers: { "content-type": "application/json", ...authHeaders() },
          body: JSON.stringify({ decision, note: note.trim() || null, requestId }),
        });
        const json = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(json.error || "Decision failed");
        setNote("");
        await load();
        onChanged?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Decision failed");
      } finally {
        setBusy(null);
      }
    },
    [busy, jobId, load, note, onChanged],
  );

  if (!state) return null;
  const view = state.view;
  if (view.mode === "hidden") return null;

  return (
    <div data-testid="reopen-section" className="mt-3 w-full min-w-0 border-t pt-3">
      {view.mode === "request" && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="min-h-[44px] w-full rounded-md border px-3 text-sm font-semibold hover:bg-accent"
        >
          Request Reopen
        </button>
      )}

      {view.mode === "blocked" && (
        <p className="break-words text-xs text-muted-foreground">{view.reason}</p>
      )}

      {view.mode === "pending" && (
        <div
          data-testid="reopen-pending"
          className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900"
        >
          <p className="font-semibold">Reopen requested — awaiting Owner/Admin decision</p>
          <p className="mt-1 break-words">
            {view.request.requested_by_name_snapshot ?? "A support user"} ·{" "}
            {formatMYDateTime(view.request.requested_at)}
          </p>
          <p className="mt-1 break-words whitespace-pre-wrap">Reason: {view.request.reason}</p>

          {view.canDecide && (
            <div className="mt-2 space-y-2">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, MAX_REOPEN_NOTE))}
                rows={2}
                maxLength={MAX_REOPEN_NOTE}
                placeholder="Decision note (optional)"
                className="w-full min-w-0 rounded-md border bg-background p-2 text-xs text-foreground"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => void decide("approve", view.request.id)}
                  className="min-h-[44px] flex-1 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                >
                  {busy === "approve" ? "Approving…" : "Approve Reopen"}
                </button>
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => void decide("reject", view.request.id)}
                  className="min-h-[44px] flex-1 rounded-md border px-3 text-sm font-semibold hover:bg-accent disabled:opacity-50"
                >
                  {busy === "reject" ? "Rejecting…" : "Reject"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {state.history.filter((h) => h.status !== "pending").length > 0 && (
        <ul className="mt-2 space-y-1 text-[11px] text-muted-foreground">
          {state.history
            .filter((h) => h.status !== "pending")
            .slice(0, 3)
            .map((h) => (
              <li key={h.id} className="break-words">
                Reopen {h.status === "approved" ? "approved" : "rejected"} by{" "}
                {h.decided_by_name_snapshot ?? "Administrator"} · {formatMYDateTime(h.decided_at)}
              </li>
            ))}
        </ul>
      )}

      {error && <p className="mt-2 break-words text-xs text-destructive">{error}</p>}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label="Request Reopen"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border bg-card p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-foreground">Request Reopen</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              An Owner or Administrator must approve before this Job returns to In Progress. The
              existing completion record is kept unchanged.
            </p>
            <label
              className="mt-3 block text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              htmlFor="wp3a-reopen-reason"
            >
              Reason *
            </label>
            <textarea
              id="wp3a-reopen-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, MAX_REOPEN_REASON))}
              rows={3}
              maxLength={MAX_REOPEN_REASON}
              placeholder="Why does this Job need to be reopened?"
              className="mt-1 w-full min-w-0 rounded-md border bg-background p-2 text-sm text-foreground"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={!!busy}
                className="min-h-[44px] rounded-lg border px-4 text-sm font-semibold hover:bg-accent disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!reason.trim() || !!busy}
                onClick={() => void submitRequest()}
                className="min-h-[44px] rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
                {busy === "request" ? "Working…" : "Submit Request"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
