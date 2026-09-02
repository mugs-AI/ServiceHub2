// WP0E-R — Job Detail cancellation experience.
//
// Everything here is driven by the server: eligibility, wording and the
// Approve/Reject controls all come from GET /api/workspace/jobs/:id/cancellation.
// Hiding a control is never the authorization boundary — the API re-checks.

import { useCallback, useEffect, useState, type ReactNode } from "react";

import { formatMYDateTime } from "@/lib/format-date";
import {
  CANCEL_APPROVAL_MODE_LABEL,
  cancelActionLabel,
  type CancelApprovalMode,
  type CancelRequesterPolicy,
} from "@/lib/qne/service-jobs/cancellation";
import { getStoredToken } from "@/lib/qne/tokens";

interface CancellationRequest {
  id: string;
  status: string;
  reason: string;
  requested_by_name_snapshot: string | null;
  requested_at: string;
  prior_status: string;
  decision: string | null;
  decided_by_name_snapshot: string | null;
  decided_at: string | null;
  decision_note: string | null;
}

interface CancellationState {
  settings: { requesterPolicy: CancelRequesterPolicy; approvalMode: CancelApprovalMode };
  canRequest: boolean;
  isAdmin: boolean;
  activeRequest: CancellationRequest | null;
  history: CancellationRequest[];
}

function authHeaders(): Record<string, string> {
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function CancellationPanel({
  jobId,
  jobStatus,
  isDeleted,
  onDone,
  embedded = false,
}: {
  jobId: string;
  jobStatus: string;
  isDeleted: boolean;
  onDone: () => Promise<void>;
  /** When true the panel renders inline (no card chrome) so it can live
      inside another card — behaviour and API calls are unchanged. */
  embedded?: boolean;
}) {
  const [state, setState] = useState<CancellationState | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [decisionNote, setDecisionNote] = useState("");

  const wrap = (children: ReactNode) =>
    embedded ? (
      <div data-testid="cancellation-embedded" className="min-w-0">
        {children}
      </div>
    ) : (
      <section className="rounded-xl border bg-card p-3 shadow-sm sm:p-4">{children}</section>
    );


  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/workspace/jobs/${jobId}/cancellation`, {
        headers: authHeaders(),
      });
      const body = (await res.json().catch(() => ({}))) as Partial<CancellationState> & {
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? "Failed to load cancellation state");
      setState(body as CancellationState);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load cancellation state");
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load, jobStatus]);

  async function submitRequest() {
    setBusy("request");
    setErr(null);
    try {
      const res = await fetch(`/api/workspace/jobs/${jobId}/cancellation`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Cancellation failed");
      setOpen(false);
      setReason("");
      await load();
      await onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Cancellation failed");
    } finally {
      setBusy(null);
    }
  }

  async function decide(decision: "approve" | "reject") {
    setBusy(decision);
    setErr(null);
    try {
      const res = await fetch(`/api/workspace/jobs/${jobId}/cancellation/decision`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note: decisionNote.trim() || null }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Decision failed");
      setDecisionNote("");
      await load();
      await onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Decision failed");
    } finally {
      setBusy(null);
    }
  }

  if (isDeleted) return null;
  if (loading && !state) {
    return wrap(<p className="text-sm text-muted-foreground">Loading cancellation state…</p>);
  }
  if (!state) {
    return err ? wrap(<p className="text-sm text-destructive">{err}</p>) : null;
  }

  const active = state.activeRequest;
  const terminal = jobStatus === "Cancelled" || jobStatus === "Completed";
  const label = cancelActionLabel(state.settings.approvalMode);
  const decided = state.history.filter((h) => h.status !== "pending").slice(0, 3);

  if (terminal && !active && decided.length === 0) return null;

  return wrap(
    <>
      <div
        className={
          embedded
            ? "flex flex-wrap items-baseline gap-x-2 gap-y-1"
            : "flex flex-wrap items-baseline justify-between gap-2"
        }
      >
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Cancellation
        </h2>
        <span className="text-[11px] text-muted-foreground">
          {CANCEL_APPROVAL_MODE_LABEL[state.settings.approvalMode]}
        </span>
      </div>


      {active && (
        <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p className="font-semibold">Cancellation requested — awaiting Owner/Admin decision</p>
          <p className="mt-1">
            {active.requested_by_name_snapshot ?? "A support user"} ·{" "}
            {formatMYDateTime(active.requested_at)} · from {active.prior_status}
          </p>
          <p className="mt-1 whitespace-pre-wrap">Reason: {active.reason}</p>

          {state.isAdmin && (
            <div className="mt-3 space-y-2">
              <textarea
                value={decisionNote}
                onChange={(e) => setDecisionNote(e.target.value)}
                rows={2}
                placeholder="Decision note (optional)"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => decide("approve")}
                  className="min-h-10 rounded-lg bg-destructive px-4 text-sm font-semibold text-destructive-foreground shadow-sm disabled:opacity-50"
                >
                  {busy === "approve" ? "Approving…" : "Approve Cancellation"}
                </button>
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => decide("reject")}
                  className="min-h-10 rounded-lg border px-4 text-sm font-semibold hover:bg-accent disabled:opacity-50"
                >
                  {busy === "reject" ? "Rejecting…" : "Reject Request"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {!active && !terminal && state.canRequest && (
        <div className="mt-2">
          <button
            type="button"
            disabled={!!busy}
            onClick={() => setOpen(true)}
            className="min-h-10 rounded-lg border border-destructive/40 bg-background px-3 text-sm font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            {label}
          </button>
        </div>
      )}

      {!active && !terminal && !state.canRequest && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          You are not permitted to cancel this Job under the current company policy.
        </p>
      )}

      {decided.length > 0 && (
        <ul className="mt-3 space-y-1 text-[11px] text-muted-foreground">
          {decided.map((h) => (
            <li key={h.id}>
              {h.status === "approved" ? "Approved" : "Rejected"} by{" "}
              {h.decided_by_name_snapshot ?? "Administrator"} · {formatMYDateTime(h.decided_at)} —
              requested by {h.requested_by_name_snapshot ?? "a support user"}: {h.reason}
            </li>
          ))}
        </ul>
      )}

      {err && (
        <div className="mt-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {err}
        </div>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label={label}
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border bg-card p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-foreground">{label}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {state.settings.approvalMode === "direct"
                ? "This cancels the Job immediately."
                : "An Owner or Administrator must approve before this Job is cancelled."}
            </p>
            <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Reason *
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground"
              placeholder="Why is this Job being cancelled?"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={!!busy}
                className="min-h-10 rounded-lg border px-4 text-sm font-semibold hover:bg-accent disabled:opacity-50"
              >
                Back
              </button>
              <button
                type="button"
                disabled={!reason.trim() || !!busy}
                onClick={submitRequest}
                className="min-h-10 rounded-lg bg-destructive px-4 text-sm font-semibold text-destructive-foreground shadow-sm disabled:opacity-50"
              >
                {busy === "request" ? "Working…" : label}
              </button>
            </div>
          </div>
        </div>
      )}
    </>,
  );

}
