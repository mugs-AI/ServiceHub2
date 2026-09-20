// WP3 — compact, mobile-first "Complete Job" card.
//
// An eligible active Job shows exactly three controls: a required Resolution
// Summary, a "Follow-up still required" checkbox and one primary "Complete
// Job" button. None of the retired legacy completion inputs are collected or
// displayed here; see src/lib/qne/service-jobs/wp3-completion.ts.
//
// Every rule is re-checked on the server inside the completion transaction;
// hiding a control is convenience, not authorisation.

import { useCallback, useEffect, useState } from "react";

import { JobReopenSection } from "@/components/qne/JobReopenSection";
import { formatMYDateTime } from "@/lib/format-date";
import {
  LEGACY_COMPLETION_LABEL,
  MAX_RESOLUTION_SUMMARY,
} from "@/lib/qne/service-jobs/wp3-completion";
import { getStoredToken } from "@/lib/qne/tokens";

import type { CompletionRecord, CompletionView } from "@/lib/qne/service-jobs/wp3-completion";

function authHeaders(): Record<string, string> {
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

interface CompletionState {
  jobNumber: string;
  jobStatus: string;
  canComplete: boolean;
  blockedReason: string | null;
  maxSummary: number;
  view: CompletionView;
}

export function SimpleCompletionCard({
  jobId,
  onCompleted,
}: {
  jobId: string;
  onCompleted?: () => void;
}) {
  const [state, setState] = useState<CompletionState | null>(null);
  const [summary, setSummary] = useState("");
  const [followUp, setFollowUp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/workspace/jobs/${jobId}/complete`, {
        headers: authHeaders(),
      });
      const json = (await res.json()) as CompletionState & { error?: string };
      if (!res.ok) throw new Error(json.error || "Failed to load completion");
      setState(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load completion");
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
      const res = await fetch(`/api/workspace/jobs/${jobId}/complete`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          resolution_summary: summary.trim(),
          follow_up_required: followUp,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Failed to complete job");
      await load();
      onCompleted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to complete job");
    } finally {
      setBusy(false);
    }
  }, [busy, followUp, jobId, load, onCompleted, summary]);

  // WP3A — an approved reopen changes the Job itself (status, workflow,
  // appointment, attendance), not just this card. Reload the card first, then
  // let the parent reload the whole Job page. The promise is awaited inside and
  // never left unhandled at the call site.
  const handleReopenChanged = useCallback(async () => {
    try {
      await load();
    } finally {
      onCompleted?.();
    }
  }, [load, onCompleted]);

  if (!state) {
    return (
      <div className="rounded-xl border bg-card p-3 text-sm text-muted-foreground">
        {error ?? "Loading completion…"}
      </div>
    );
  }

  const view = state.view;

  return (
    <div data-testid="completion-card" className="w-full min-w-0 rounded-xl border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Complete Job</h2>
        {view.mode === "locked" && (
          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
            Completed
          </span>
        )}
      </div>

      {view.mode === "legacy" && (
        <p
          data-testid="legacy-completion"
          className="mt-2 break-words text-xs text-muted-foreground"
        >
          {LEGACY_COMPLETION_LABEL}
        </p>
      )}

      {view.mode === "locked" && <LockedCompletion record={view.record} />}

      {/* WP3A — reopen request / decision for a Completed Job. It renders no
          form control inside the three-control completion form; it only
          appears once the Job is completed (including legacy completions). */}
      {(view.mode === "locked" || view.mode === "legacy") && (
        <JobReopenSection jobId={jobId} onChanged={() => void load()} />
      )}

      {view.mode === "blocked" && (
        <p className="mt-2 break-words text-xs text-muted-foreground">{view.reason}</p>
      )}

      {view.mode === "form" && !state.canComplete && (
        <p className="mt-2 break-words text-xs text-muted-foreground">
          Only the assigned technician or an administrator can complete this Job.
        </p>
      )}

      {view.mode === "form" && state.canComplete && (
        <div className="mt-3 space-y-3">
          <label className="block text-xs font-medium" htmlFor="wp3-resolution">
            Resolution Summary *
          </label>
          <textarea
            id="wp3-resolution"
            value={summary}
            onChange={(e) => setSummary(e.target.value.slice(0, MAX_RESOLUTION_SUMMARY))}
            rows={4}
            maxLength={MAX_RESOLUTION_SUMMARY}
            placeholder="What was resolved for the customer?"
            className="w-full min-w-0 rounded-md border bg-background p-2 text-sm"
          />
          <label className="flex min-h-[44px] items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={followUp}
              onChange={(e) => setFollowUp(e.target.checked)}
            />
            <span className="break-words">Follow-up still required</span>
          </label>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!summary.trim() || busy}
            className="min-h-[44px] w-full rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {busy ? "Completing…" : "Complete Job"}
          </button>
        </div>
      )}

      {error && <p className="mt-2 break-words text-xs text-destructive">{error}</p>}
    </div>
  );
}

function LockedCompletion({ record }: { record: CompletionRecord }) {
  return (
    <dl data-testid="completion-locked" className="mt-2 space-y-1 text-xs">
      <div className="min-w-0">
        <dt className="text-muted-foreground">Resolution</dt>
        <dd className="break-words whitespace-pre-wrap">{record.resolution_summary ?? "—"}</dd>
      </div>
      <div className="min-w-0">
        <dt className="text-muted-foreground">Follow-up still required</dt>
        <dd>{record.follow_up_required ? "Yes" : "No"}</dd>
      </div>
      <div className="min-w-0">
        <dt className="text-muted-foreground">Completed by</dt>
        <dd className="break-words">
          {record.completed_by_name_snapshot ?? record.completed_by_user_id ?? "—"}
        </dd>
      </div>
      <div className="min-w-0">
        <dt className="text-muted-foreground">Completed at</dt>
        <dd className="break-words">{formatMYDateTime(record.completed_at) || "—"}</dd>
      </div>
    </dl>
  );
}
