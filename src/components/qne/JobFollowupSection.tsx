// WP3B — follow-up outcome badge and Clear Follow-up action.
//
// Rendered inside the locked / legacy completion card. Clearing a follow-up
// keeps the Job Completed: it only changes the derived outcome from
// "Follow-up Open" to "Resolved". The original completion record, its
// resolution summary, its follow-up flag, its actor and its timestamp are
// never modified. Every rule is re-checked on the server inside the follow-up
// transaction; hiding a control is convenience, not authorisation.

import { useCallback, useEffect, useState } from "react";

import { formatMYDateTime } from "@/lib/format-date";
import { MAX_FOLLOWUP_NOTE } from "@/lib/qne/service-jobs/wp3b-followup";
import { getStoredToken } from "@/lib/qne/tokens";

import type { CompletionOutcome, FollowupView } from "@/lib/qne/service-jobs/wp3b-followup";

function authHeaders(): Record<string, string> {
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

interface FollowupState {
  completionCycle: number;
  outcome: CompletionOutcome | null;
  outcomeLabel: string | null;
  maxNote: number;
  view: FollowupView;
}

const BADGE_TONE: Record<CompletionOutcome, string> = {
  resolved_at_completion:
    "border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300",
  resolved_after_follow_up:
    "border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300",
  follow_up_open: "border-orange-300 bg-orange-100 text-orange-900",
  reopen_pending: "border-amber-400 bg-amber-100 text-amber-900",
  legacy_unknown: "border-muted bg-muted text-muted-foreground",
};

export function JobFollowupSection({
  jobId,
  onChanged,
}: {
  jobId: string;
  onChanged?: () => void;
}) {
  const [state, setState] = useState<FollowupState | null>(null);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/workspace/jobs/${jobId}/followup`, { headers: authHeaders() });
      const json = (await res.json()) as FollowupState & { error?: string };
      if (!res.ok) throw new Error(json.error || "Failed to load follow-up state");
      setState(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load follow-up state");
    }
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/workspace/jobs/${jobId}/followup`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ resolution_note: note.trim() }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Failed to clear follow-up");
      setOpen(false);
      setNote("");
      await load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear follow-up");
    } finally {
      setBusy(false);
    }
  }, [busy, jobId, load, note, onChanged]);

  if (!state) return null;
  const view = state.view;

  return (
    <div data-testid="followup-section" className="mt-3 w-full min-w-0 space-y-2">
      {state.outcome && state.outcomeLabel && (
        <span
          data-testid="completion-outcome-badge"
          className={`inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold break-words ${BADGE_TONE[state.outcome]}`}
        >
          {state.outcomeLabel}
        </span>
      )}

      {view.mode === "open" && view.canClear && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          data-testid="followup-clear-button"
          className="min-h-[44px] w-full rounded-md border border-orange-400 bg-orange-100 px-3 text-sm font-semibold text-orange-900 transition-colors hover:bg-orange-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2"
        >
          Clear Follow-up
        </button>
      )}

      {view.mode === "open" && !view.canClear && (
        <p className="break-words text-xs text-muted-foreground">
          Only the assigned technician or an administrator can clear this follow-up.
        </p>
      )}

      {view.mode === "resolved" && (
        <dl data-testid="followup-resolved" className="space-y-1 text-xs">
          <div className="min-w-0">
            <dt className="text-muted-foreground">Follow-up result</dt>
            <dd className="break-words whitespace-pre-wrap">
              {view.record.resolution_note ?? "—"}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted-foreground">Cleared by</dt>
            <dd className="break-words">
              {view.record.resolved_by_name_snapshot ?? view.record.resolved_by_user_id ?? "—"}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted-foreground">Cleared at</dt>
            <dd className="break-words">{formatMYDateTime(view.record.resolved_at) || "—"}</dd>
          </div>
        </dl>
      )}

      {error && <p className="break-words text-xs text-destructive">{error}</p>}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label="Clear Follow-up"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border bg-card p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-foreground">Clear Follow-up</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              The Job stays Completed. Clearing records the follow-up result and marks this
              completion as resolved; the original completion record is kept unchanged.
            </p>
            <label
              className="mt-3 block text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              htmlFor="wp3b-followup-note"
            >
              Follow-up Result *
            </label>
            <textarea
              id="wp3b-followup-note"
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, MAX_FOLLOWUP_NOTE))}
              rows={3}
              maxLength={MAX_FOLLOWUP_NOTE}
              placeholder="What was done to close out the follow-up?"
              className="mt-1 w-full min-w-0 rounded-md border bg-background p-2 text-sm text-foreground"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="min-h-[44px] rounded-lg border px-4 text-sm font-semibold hover:bg-accent disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!note.trim() || busy}
                onClick={() => void submit()}
                className="min-h-[44px] rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
                {busy ? "Working…" : "Clear Follow-up"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
