import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";

import { getStoredToken } from "@/lib/qne/tokens";
import { useSession } from "@/lib/qne/session-context";
import { useTabs } from "@/lib/tabs";
import { allowedTransitionsClient } from "@/lib/qne/service-jobs/workflow";
import { formatMY, formatMYDateTime } from "@/lib/format-date";

interface JobDetail {
  id: string;
  job_number: string;
  customer_code_snapshot: string;
  customer_name_snapshot: string | null;
  contact_person: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  service_address: string | null;
  subject: string;
  problem_description: string;
  status: string;
  priority: string;
  source: string;
  requires_approval: boolean;
  approval_reason: string | null;
  subscription_category_snapshot: string | null;
  stock_code_snapshot: string | null;
  entitlement_expiry_snapshot: string | null;
  entitlement_status_snapshot: string | null;
  internal_note: string | null;
  created_by_user_id: string | null;
  created_by_name: string | null;
  created_at: string;
  assigned_user_id: string | null;
  assigned_user_name_snapshot: string | null;
  assigned_user_code_snapshot: string | null;
  assigned_user_email_snapshot: string | null;
  assigned_at: string | null;
  assigned_by_user_id: string | null;
  assigned_by_name_snapshot: string | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  schedule_status: string | null;
  scheduled_by_name_snapshot: string | null;
  is_deleted: boolean;
  deleted_at: string | null;
  deleted_by_name_snapshot: string | null;
  deletion_reason: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  cancelled_by_name_snapshot: string | null;
  completed_at: string | null;
  approved_at: string | null;
  approved_by_name_snapshot: string | null;
  approval_note: string | null;
  approval_remark_public: string | null;
  approval_remark_private: string | null;
  rejected_at: string | null;
  rejected_by_name_snapshot: string | null;
  rejection_reason: string | null;
}

interface TechnicianRow {
  user_id: string | null;
  user_name: string | null;
  display_name: string | null;
  email: string | null;
}

interface TimelineItem {
  id: string;
  kind: "activity" | "assignment" | "comment";
  event: string;
  old_value: string | null;
  new_value: string | null;
  note: string | null;
  performed_by_name: string | null;
  performed_at: string;
}

interface CommentRow {
  id: string;
  visibility: "internal" | "customer";
  body: string;
  author_name_snapshot: string | null;
  created_at: string;
}

export const Route = createFileRoute("/jobs/$jobId")({
  component: JobDetailPage,
});

function authHeaders(): Record<string, string> {
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function JobDetailPage() {
  const { jobId } = Route.useParams();
  const session = useSession();
  const isAdmin = !!session.currentUser?.isAdministrator;

  const [job, setJob] = useState<JobDetail | null>(null);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPicker, setShowPicker] = useState(false);

  // Progressive loading:
  // - reload()   loads main job details first (blocks initial render),
  //              then loads timeline + comments in the background.
  // - reloadAll() re-fetches everything in parallel and awaits — used
  //              after mutations so callers see refreshed timeline.
  const loadSecondary = useCallback(async () => {
    const [tlRes, cmRes] = await Promise.all([
      fetch(`/api/workspace/jobs/${jobId}/timeline`, { headers: authHeaders() }),
      fetch(`/api/workspace/jobs/${jobId}/comments`, { headers: authHeaders() }),
    ]);
    const tlBody = await tlRes.json().catch(() => ({}));
    const cmBody = await cmRes.json().catch(() => ({}));
    if (tlRes.ok) setTimeline(tlBody.timeline ?? []);
    if (cmRes.ok) setComments(cmBody.comments ?? []);
  }, [jobId]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const jobRes = await fetch(`/api/workspace/jobs/${jobId}`, { headers: authHeaders() });
      const jobBody = await jobRes.json().catch(() => ({}));
      if (!jobRes.ok) {
        setError(jobBody?.error ?? "Unable to load job.");
        setJob(null);
      } else {
        setError(null);
        setJob(jobBody.job);
      }
    } finally {
      setLoading(false);
    }
    // Fire-and-forget secondary sections.
    void loadSecondary();
  }, [jobId, loadSecondary]);

  const reloadAll = useCallback(async () => {
    await reload();
    await loadSecondary();
  }, [reload, loadSecondary]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const { openJobTab } = useTabs();
  useEffect(() => {
    if (job?.job_number) openJobTab(jobId, job.job_number);
  }, [jobId, job?.job_number, openJobTab]);

  if (loading && !job) {
    return <p className="text-sm text-muted-foreground">Loading job…</p>;
  }
  if (error || !job) {
    return (
      <div className="rounded-lg border bg-destructive/10 p-4 text-sm text-destructive">
        {error ?? "Job not found."}
      </div>
    );
  }

  const currentUserId =
    session.currentUser?.diagnostics?.matchedN3UserId ??
    session.currentUser?.userCode ??
    null;
  const isCreator =
    !!job.created_by_user_id &&
    !!currentUserId &&
    job.created_by_user_id === currentUserId;

  const pendingLock = job.status === "Pending Approval" && !isAdmin;

  return (
    <div className="space-y-6">
      <header className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              Service Job
            </span>
            <h1 className="font-mono text-2xl font-bold text-foreground sm:text-3xl">
              {job.job_number}
            </h1>
          </div>
          <p className="mt-1 break-words text-lg font-bold text-foreground sm:text-xl">
            {job.subject}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={job.status} />
          <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold uppercase ${priorityTone(job.priority)}`}>
            {job.priority}
          </span>
          <span className="rounded-full border px-2 py-0.5 text-xs font-semibold uppercase">
            {job.source}
          </span>
          {job.is_deleted && (
            <span className="rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-xs font-semibold uppercase text-red-800">
              Deleted
            </span>
          )}
          <Link
            to="/support"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← Workspace
          </Link>
        </div>
      </header>

      {job.is_deleted && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900 ring-1 ring-red-200">
          Deleted {formatMYDateTime(job.deleted_at)}
          {job.deleted_by_name_snapshot ? ` by ${job.deleted_by_name_snapshot}` : ""}
          {job.deletion_reason ? ` — ${job.deletion_reason}` : ""}
        </div>
      )}

      {job.requires_approval && job.status === "Pending Approval" && (
        <div
          role="alert"
          className="rounded-xl border-2 border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-sm"
        >
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
              🔒 Waiting for Approval
            </span>
            <span className="font-medium">
              {job.approval_reason ?? "Administrator approval required before work can start."}
            </span>
          </div>
          <p className="mt-1 text-xs text-amber-800">
            This Job is waiting for Owner/Admin approval. Operational updates are locked until approval.
          </p>
        </div>
      )}

      {job.requires_approval && job.status === "Pending Approval" && (
        <ApprovalPanel job={job} isAdmin={isAdmin} onDone={reloadAll} />
      )}

      {/* Top summary row — Job Info | Workflow | Assigned Technician.
          Equal-height via grid; stacks on mobile. */}
      <div className="grid grid-cols-1 items-stretch gap-3 md:grid-cols-3">
        <JobInfoCard job={job} />
        <div className={pendingLock ? "pointer-events-none opacity-60" : ""}>
          {!job.is_deleted ? (
            <WorkflowActions job={job} onDone={reloadAll} />
          ) : (
            <section className="flex h-full flex-col rounded-xl border bg-card p-3 shadow-sm sm:p-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Workflow
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                No actions available for a deleted job.
              </p>
            </section>
          )}
        </div>
        <div className={pendingLock ? "pointer-events-none opacity-60" : ""}>
          <AssignmentSection
            job={job}
            canAssign={isAdmin && !job.is_deleted}
            currentUserId={currentUserId}
            currentDisplayName={session.currentUser?.displayName || session.currentUser?.email || ""}
            onOpenPicker={() => setShowPicker(true)}
            onReload={reloadAll}
          />
        </div>
      </div>

      {(job.subscription_category_snapshot ||
        job.stock_code_snapshot ||
        job.entitlement_status_snapshot ||
        job.requires_approval ||
        job.approved_at ||
        job.rejected_at) && (
        <EntitlementCard job={job} isAdmin={isAdmin} />
      )}

      <ScheduleCard
        job={job}
        locked={pendingLock || job.is_deleted}
        canEdit={isAdmin || currentUserId === job.assigned_user_id}
        onDone={reloadAll}
      />

      <div className={pendingLock ? "pointer-events-none opacity-60 space-y-6" : "space-y-6"}>
        <Section title="Job details">
          <Kv k="Customer" v={job.customer_name_snapshot ?? "(no name)"} />
          <Kv k="Problem" v={job.problem_description} multiline />
          <PriorityEditor job={job} onDone={reloadAll} />
        </Section>

        <InternalNoteSection
          job={job}
          canEdit={isCreator && !job.is_deleted && !pendingLock}
          onReload={reloadAll}
        />

        <CommentsSection
          jobId={jobId}
          comments={comments}
          disabled={job.is_deleted || pendingLock}
          onReload={reloadAll}
        />
      </div>

      <TimelineSection items={timeline} />

      <Section title="Contact">
        <Kv k="Customer code" v={job.customer_code_snapshot} />
        <Kv k="Contact person" v={job.contact_person} />
        <Kv k="Phone" v={job.contact_phone} />
        <Kv k="Email" v={job.contact_email} />
        <Kv k="Service address" v={job.service_address} multiline />
      </Section>

      {isAdmin && (
        <AdminDangerZone job={job} onReload={reloadAll} />
      )}

      {showPicker && (
        <TechnicianPicker
          jobId={jobId}
          currentUserId={job.assigned_user_id}
          onClose={() => setShowPicker(false)}
          onDone={async () => {
            setShowPicker(false);
            await reloadAll();
          }}
        />
      )}
    </div>
  );
}

/* ---------------- schedule card ---------------- */

function ScheduleCard({
  job,
  locked,
  canEdit,
  onDone,
}: {
  job: JobDetail;
  locked: boolean;
  canEdit: boolean;
  onDone: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(utcIsoToMyLocal(job.scheduled_start_at));
  const [end, setEnd] = useState(utcIsoToMyLocal(job.scheduled_end_at));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<
    { id: string; job_number: string; scheduled_start_at: string | null }[]
  >([]);

  const scheduled = Boolean(job.scheduled_start_at);
  const allowed = canScheduleJob(job);

  async function submit(force: boolean) {
    setErr(null);
    const startIso = myLocalToUtcIso(start);
    const endIso = myLocalToUtcIso(end);
    const check = validateWindow(startIso, endIso);
    if (!check.ok) {
      setErr(check.error ?? "Invalid appointment window.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/workspace/jobs/${job.id}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ start: startIso, end: endIso, reason: reason || null, force }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setConflicts(body.conflicts ?? []);
        setErr(body.error ?? "Scheduling conflict.");
        return;
      }
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      setConflicts([]);
      setOpen(false);
      setReason("");
      await onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save appointment");
    } finally {
      setBusy(false);
    }
  }

  async function unschedule() {
    if (!window.confirm("Remove this appointment?")) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/workspace/jobs/${job.id}/schedule`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ reason: reason || null }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      setStart("");
      setEnd("");
      setOpen(false);
      await onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to remove appointment");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border bg-card p-3 shadow-sm sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Appointment
        </h2>
        {locked ? (
          <span className="text-xs font-semibold text-amber-700">Locked</span>
        ) : canEdit && allowed.ok ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="min-h-9 rounded-md border px-3 text-xs font-semibold hover:bg-accent"
            >
              {open ? "Close" : scheduled ? "Reschedule" : "Schedule"}
            </button>
            {scheduled && (
              <button
                type="button"
                onClick={() => void unschedule()}
                disabled={busy}
                className="min-h-9 rounded-md border border-destructive/40 px-3 text-xs font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-50"
              >
                Unschedule
              </button>
            )}
          </div>
        ) : null}
      </div>

      <div className="mt-2 grid grid-cols-1 gap-1 text-sm sm:grid-cols-3">
        <div>
          <span className="text-xs text-muted-foreground">Start: </span>
          <span className="font-semibold text-foreground">
            {job.scheduled_start_at ? formatMYDateTime(job.scheduled_start_at) : "Not scheduled"}
          </span>
        </div>
        <div>
          <span className="text-xs text-muted-foreground">End: </span>
          <span className="font-medium text-foreground">
            {job.scheduled_end_at ? formatMYDateTime(job.scheduled_end_at) : "—"}
          </span>
        </div>
        <div>
          <span className="text-xs text-muted-foreground">Duration: </span>
          <span className="font-medium text-foreground">
            {formatDuration(job.scheduled_start_at, job.scheduled_end_at)}
          </span>
        </div>
      </div>
      {!allowed.ok && !locked && (
        <p className="mt-1 text-xs text-muted-foreground">{allowed.reason}</p>
      )}

      {open && !locked && (
        <div className="mt-3 space-y-2 rounded-lg border bg-background p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="block text-xs font-semibold text-muted-foreground">
              Start (Malaysia time)
              <input
                type="datetime-local"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="mt-1 min-h-11 w-full rounded-md border bg-background px-3 text-sm font-normal text-foreground"
              />
            </label>
            <label className="block text-xs font-semibold text-muted-foreground">
              End (Malaysia time)
              <input
                type="datetime-local"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="mt-1 min-h-11 w-full rounded-md border bg-background px-3 text-sm font-normal text-foreground"
              />
            </label>
          </div>
          <label className="block text-xs font-semibold text-muted-foreground">
            Reason / note (optional)
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-1 min-h-11 w-full rounded-md border bg-background px-3 text-sm font-normal text-foreground"
            />
          </label>

          {err && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {err}
              {conflicts.length > 0 && (
                <ul className="mt-1 list-disc pl-4">
                  {conflicts.map((c) => (
                    <li key={c.id}>
                      {c.job_number} — {formatMYDateTime(c.scheduled_start_at)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void submit(false)}
              disabled={busy}
              className="min-h-11 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save appointment"}
            </button>
            {conflicts.length > 0 && (
              <button
                type="button"
                onClick={() => void submit(true)}
                disabled={busy}
                className="min-h-11 rounded-md border border-amber-500 px-4 text-sm font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50"
              >
                Book anyway
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/* ---------------- entitlement card ---------------- */

function EntitlementCard({ job, isAdmin }: { job: JobDetail; isAdmin: boolean }) {
  const status = (job.entitlement_status_snapshot ?? "").toLowerCase();
  const tone =
    status === "active"
      ? "border-emerald-300 bg-emerald-50"
      : status === "due soon"
        ? "border-amber-300 bg-amber-50"
        : status === "overdue" || status === "expired"
          ? "border-rose-300 bg-rose-50"
          : "border-border bg-card";
  const badge =
    status === "active"
      ? "bg-emerald-600 text-white"
      : status === "due soon"
        ? "bg-amber-500 text-white"
        : status === "overdue" || status === "expired"
          ? "bg-rose-600 text-white"
          : "bg-muted text-foreground";
  const approvalLabel =
    job.status === "Pending Approval"
      ? "Waiting for Approval"
      : job.approved_at
        ? "Approved"
        : job.rejected_at
          ? "Rejected"
          : job.requires_approval
            ? "Approval required"
            : null;
  const hasApproval =
    approvalLabel ||
    job.approval_reason ||
    job.approved_at ||
    job.approval_remark_public ||
    job.approval_note ||
    (isAdmin && job.approval_remark_private) ||
    job.rejected_at ||
    job.rejection_reason;

  return (
    <section className={`rounded-xl border-2 p-3 shadow-sm sm:p-4 ${tone}`}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Entitlement &amp; Approval
        </h2>
        {job.entitlement_status_snapshot && (
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${badge}`}>
            {job.entitlement_status_snapshot}
          </span>
        )}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            Entitlement details
          </div>
          <dl className="grid gap-1.5 text-sm">
            <Kv k="Category" v={job.subscription_category_snapshot ?? "—"} />
            <Kv k="Stock" v={job.stock_code_snapshot ?? "—"} />
            <Kv k="Expiry" v={formatMY(job.entitlement_expiry_snapshot) || "—"} />
          </dl>
        </div>
        {hasApproval && (
          <div className="md:border-l md:border-border/60 md:pl-4">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              Approval
            </div>
            <dl className="grid gap-1.5 text-sm">
              {approvalLabel && <Kv k="Status" v={approvalLabel} />}
              {job.approval_reason && <Kv k="Reason" v={job.approval_reason} />}
              {job.approved_at && (
                <Kv k="Approved" v={`${formatMYDateTime(job.approved_at)}${job.approved_by_name_snapshot ? ` · ${job.approved_by_name_snapshot}` : ""}`} />
              )}
              {(job.approval_remark_public ?? job.approval_note) && (
                <Kv k="Remark" v={job.approval_remark_public ?? job.approval_note} multiline />
              )}
              {job.rejected_at && (
                <Kv k="Rejected" v={`${formatMYDateTime(job.rejected_at)}${job.rejected_by_name_snapshot ? ` · ${job.rejected_by_name_snapshot}` : ""}`} />
              )}
              {job.rejection_reason && (
                <Kv k="Rejection reason" v={job.rejection_reason} multiline />
              )}
            </dl>
            {isAdmin && job.approval_remark_private && (
              <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2">
                <div className="text-[10px] font-bold uppercase tracking-wide text-amber-900">
                  Private remark (Owner/Admin only)
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-amber-950">
                  {job.approval_remark_private}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function priorityTone(p: string): string {
  if (p === "High") return "border-red-300 bg-red-50 text-red-800";
  if (p === "Medium") return "border-amber-300 bg-amber-50 text-amber-800";
  return "border-gray-200 bg-gray-50 text-gray-700";
}

/* ---------------- top summary cards ---------------- */

function JobInfoCard({ job }: { job: JobDetail }) {
  return (
    <section className="flex h-full flex-col rounded-xl border bg-card p-3 shadow-sm sm:p-4">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Job information
      </h2>
      <dl className="space-y-1.5 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Source</dt>
          <dd className="text-right font-semibold text-foreground">{job.source}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Created</dt>
          <dd className="text-right text-foreground">{formatMYDateTime(job.created_at)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Created by</dt>
          <dd className="text-right text-foreground">{job.created_by_name ?? "—"}</dd>
        </div>
      </dl>
    </section>
  );
}

/* ---------------- internal note (creator-only edit) ---------------- */

function InternalNoteSection({
  job,
  canEdit,
  onReload,
}: {
  job: JobDetail;
  canEdit: boolean;
  onReload: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(job.internal_note ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setValue(job.internal_note ?? "");
  }, [job.internal_note]);

  const empty = !job.internal_note;
  if (empty && !canEdit) return null;

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/workspace/jobs/${job.id}/internal-note`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ internal_note: value }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "Failed");
      setEditing(false);
      await onReload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm sm:p-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Internal note
        </h2>
        {canEdit && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="min-h-9 rounded-md border bg-background px-3 text-xs font-semibold text-foreground hover:bg-accent"
          >
            {empty ? "Add note" : "Edit"}
          </button>
        )}
      </div>
      {editing ? (
        <div className="space-y-2">
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={5}
            placeholder="Internal note visible only inside your team…"
            className="w-full min-h-[140px] rounded-lg border-[1.5px] border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-600 focus:bg-blue-50"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => {
                setValue(job.internal_note ?? "");
                setEditing(false);
                setErr(null);
              }}
              disabled={busy}
              className="min-h-11 rounded-lg border bg-background px-4 text-sm font-semibold hover:bg-accent"
            >
              Cancel
            </button>
          </div>
          {err && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {err}
            </div>
          )}
        </div>
      ) : empty ? (
        <p className="text-sm text-muted-foreground">No internal note.</p>
      ) : (
        <p className="whitespace-pre-wrap text-sm">{job.internal_note}</p>
      )}
    </section>
  );
}

function PriorityEditor({
  job,
  onDone,
}: {
  job: JobDetail;
  onDone: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const locked =
    job.is_deleted || job.status === "Completed" || job.status === "Cancelled";

  async function change(next: string) {
    if (next === job.priority || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/workspace/jobs/${job.id}/priority`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ priority: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "Failed to update priority.");
      await onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
      <div className="min-w-32 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Priority
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {(["High", "Medium", "Low"] as const).map((p) => {
          const active = job.priority === p;
          return (
            <button
              key={p}
              type="button"
              onClick={() => change(p)}
              disabled={locked || busy}
              className={`min-h-9 rounded-full border px-3 py-1 text-xs font-semibold uppercase transition-colors disabled:opacity-50 ${
                active ? priorityTone(p) + " ring-2 ring-offset-1 ring-blue-500" : "bg-white text-muted-foreground hover:bg-accent"
              }`}
            >
              {p}
            </button>
          );
        })}
        {locked && (
          <span className="text-[10px] uppercase text-muted-foreground">
            Locked ({job.is_deleted ? "deleted" : job.status})
          </span>
        )}
      </div>
      {err && (
        <span className="text-xs text-destructive sm:ml-2">{err}</span>
      )}
    </div>
  );
}


/* ---------------- status ---------------- */

function StatusBadge({ status }: { status: string }) {
  const tone = statusTone(status);
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-xs font-semibold uppercase ${tone}`}
    >
      {status}
    </span>
  );
}

function statusTone(status: string): string {
  switch (status) {
    case "Draft":
      return "bg-blue-100 text-blue-800 border-blue-200";
    case "Pending Approval":
      return "bg-amber-100 text-amber-900 border-amber-200";
    case "Open":
      return "bg-sky-100 text-sky-900 border-sky-200";
    case "Assigned":
      return "bg-purple-100 text-purple-900 border-purple-200";
    case "In Progress":
      return "bg-indigo-100 text-indigo-900 border-indigo-200";
    case "Waiting Customer":
    case "Waiting Vendor":
      return "bg-orange-100 text-orange-900 border-orange-200";
    case "Completed":
      return "bg-emerald-100 text-emerald-900 border-emerald-200";
    case "Cancelled":
      return "bg-gray-200 text-gray-800 border-gray-300";
    default:
      return "bg-gray-100 text-gray-800 border-gray-200";
  }
}

/* ---------------- workflow ---------------- */

function WorkflowActions({
  job,
  onDone,
}: {
  job: JobDetail;
  onDone: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const transitions = useMemo(() => {
    let t = allowedTransitionsClient(job.status);
    // Draft → Open blocked when requires_approval is true.
    if (job.status === "Draft" && job.requires_approval) {
      t = t.filter((x) => x !== "Open" && x !== "Assigned");
    }
    // Draft submit target depends on assignment: assigned → Assigned, else → Open.
    if (job.status === "Draft") {
      if (job.assigned_user_id) t = t.filter((x) => x !== "Open");
      else t = t.filter((x) => x !== "Assigned");
    }
    // Pending Approval handled by ApprovalPanel.
    if (job.status === "Pending Approval") t = t.filter((x) => x !== "Cancelled");
    return t;
  }, [job.status, job.requires_approval, job.assigned_user_id]);

  if (transitions.length === 0) return null;

  async function transition(to: string) {
    let reason: string | null = null;
    if (to === "Cancelled") {
      const r = window.prompt("Cancellation reason (required):");
      if (!r || !r.trim()) return;
      reason = r.trim();
    }
    setBusy(to);
    setErr(null);
    try {
      const res = await fetch(`/api/workspace/jobs/${job.id}/status`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ to, reason }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "Transition failed");
      await onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Transition failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="flex h-full flex-col rounded-xl border bg-card p-3 shadow-sm sm:p-4">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Workflow
      </h2>
      <div className="flex flex-wrap gap-2">
        {transitions.map((to) => (
          <button
            key={to}
            type="button"
            onClick={() => transition(to)}
            disabled={!!busy}
            className={`min-h-10 rounded-lg px-3 text-sm font-semibold shadow-sm disabled:opacity-50 ${
              to === "Cancelled"
                ? "border border-destructive/40 bg-white text-destructive hover:bg-destructive/10"
                : "bg-primary text-primary-foreground hover:bg-primary/90"
            }`}
          >
            {busy === to ? "Working…" : actionLabel(job.status, to)}
          </button>
        ))}
      </div>
      {job.status === "Draft" && (
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
          Submitting a Draft with a technician assigned routes to <strong>Assigned</strong>; without one, to <strong>Open</strong>.
        </p>
      )}
      {err && (
        <div className="mt-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {err}
        </div>
      )}
    </section>
  );
}


function actionLabel(from: string, to: string): string {
  if (from === "Draft" && to === "Open") return "Submit → Open";
  if (from === "Draft" && to === "Assigned") return "Submit → Assigned";
  if (to === "In Progress") return "Start Work";
  if (to === "Completed") return "Complete";
  if (to === "Cancelled") return "Cancel";
  if (to === "Waiting Customer") return "Waiting on Customer";
  if (to === "Waiting Vendor") return "Waiting on Vendor";
  if (to === "Assigned") return "→ Assigned";
  return `→ ${to}`;
}

/* ---------------- approval ---------------- */

function ApprovalPanel({
  job,
  isAdmin,
  onDone,
}: {
  job: JobDetail;
  isAdmin: boolean;
  onDone: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [remarkPublic, setRemarkPublic] = useState("");
  const [remarkPrivate, setRemarkPrivate] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function approve() {
    setBusy("approve");
    setErr(null);
    try {
      const res = await fetch(`/api/workspace/jobs/${job.id}/approve`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          remark_public: remarkPublic.trim() || null,
          remark_private: remarkPrivate.trim() || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "Failed");
      await onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }
  async function reject() {
    const reason = window.prompt("Rejection reason (required):");
    if (!reason || !reason.trim()) return;
    setBusy("reject");
    setErr(null);
    try {
      const res = await fetch(`/api/workspace/jobs/${job.id}/reject`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "Failed");
      await onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 shadow-sm sm:p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-900">
        Approval required
      </h2>
      <p className="mt-1 text-sm text-amber-900">
        {job.approval_reason ?? "This job needs Administrator approval before work can start."}
      </p>
      {isAdmin ? (
        <div className="mt-3 space-y-3">
          <label className="block">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-900">
              Remark 1 — Public (posted to timeline, visible to all)
            </div>
            <textarea
              value={remarkPublic}
              onChange={(e) => setRemarkPublic(e.target.value)}
              placeholder="Explain the approval so technicians and the customer-facing timeline stay informed…"
              rows={3}
              className="w-full rounded-lg border-[1.5px] border-amber-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-600"
            />
          </label>
          <label className="block">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-900">
              Remark 2 — Private (Owner / Admin only)
            </div>
            <textarea
              value={remarkPrivate}
              onChange={(e) => setRemarkPrivate(e.target.value)}
              placeholder="Confidential context. Never shown on the timeline or to non-admin viewers."
              rows={3}
              className="w-full rounded-lg border-[1.5px] border-amber-400 bg-white px-3 py-2 text-sm outline-none focus:border-amber-700"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={approve}
              disabled={!!busy}
              className="min-h-11 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy === "approve" ? "Approving…" : "Approve"}
            </button>
            <button
              type="button"
              onClick={reject}
              disabled={!!busy}
              className="min-h-11 rounded-lg border border-red-400 bg-white px-4 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              {busy === "reject" ? "Rejecting…" : "Reject"}
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-2 text-xs text-amber-900">
          An administrator must approve or reject this job.
        </p>
      )}
      {err && (
        <div className="mt-2 rounded-md bg-red-100 px-3 py-2 text-sm text-red-800">
          {err}
        </div>
      )}
    </section>
  );
}

/* ---------------- assignment ---------------- */

function AssignmentSection({
  job,
  canAssign,
  currentUserId,
  currentDisplayName,
  onOpenPicker,
  onReload,
}: {
  job: JobDetail;
  canAssign: boolean;
  currentUserId: string | null;
  currentDisplayName: string;
  onOpenPicker: () => void;
  onReload: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const assigned = !!job.assigned_user_id;
  const CLAIMABLE = new Set(["Open", "Assigned", "Waiting Customer", "Waiting Vendor"]);
  const canClaim =
    !!currentUserId &&
    !job.is_deleted &&
    CLAIMABLE.has(job.status) &&
    job.assigned_user_id !== currentUserId;

  async function handleUnassign() {
    if (!confirm(`Unassign ${job.assigned_user_name_snapshot ?? "technician"} from ${job.job_number}?`)) {
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/workspace/jobs/${job.id}/assign`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "Unable to unassign.");
      await onReload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Unable to unassign.");
    } finally {
      setBusy(false);
    }
  }

  async function handleClaim() {
    const currentName = job.assigned_user_name_snapshot ?? "(Unassigned)";
    const meName = currentDisplayName || "you";
    const msg = job.assigned_user_id
      ? `Reassign ${job.job_number} from ${currentName} to ${meName}?\n\nThe previous technician stays in the assignment history.`
      : `Assign ${job.job_number} to ${meName}?`;
    if (!confirm(msg)) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/workspace/jobs/${job.id}/claim`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "Unable to claim job.");
      await onReload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Unable to claim job.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex h-full flex-col rounded-xl border bg-card p-4 shadow-sm sm:p-6">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Assigned technician
      </h2>
      {assigned ? (
        <div className="text-base font-semibold text-foreground">
          {job.assigned_user_name_snapshot}
          {job.assigned_user_id === currentUserId && (
            <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
              You
            </span>
          )}
        </div>
      ) : (
        <div className="text-sm font-medium text-muted-foreground">Unassigned</div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {canClaim && (
          <button
            type="button"
            onClick={handleClaim}
            disabled={busy}
            className="min-h-[44px] rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
          >
            {assigned ? "Reassign to Me" : "Assign to Me"}
          </button>
        )}
        {canAssign && (
          <>
            <button
              type="button"
              onClick={onOpenPicker}
              disabled={busy}
              className="min-h-[44px] rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
            >
              {assigned ? "Change" : "Assign Technician"}
            </button>
            {assigned && (
              <button
                type="button"
                onClick={handleUnassign}
                disabled={busy}
                className="min-h-[44px] rounded-lg border border-destructive/40 bg-white px-4 text-sm font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-50"
              >
                Unassign
              </button>
            )}
          </>
        )}
      </div>
      {err && (
        <div className="mt-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {err}
        </div>
      )}
    </section>
  );
}


function TechnicianPicker({
  jobId,
  currentUserId,
  onClose,
  onDone,
}: {
  jobId: string;
  currentUserId: string | null;
  onClose: () => void;
  onDone: () => Promise<void> | void;
}) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<TechnicianRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [assigningId, setAssigningId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      setErr(null);
      try {
        const url = new URL("/api/workspace/technicians", window.location.origin);
        if (q.trim()) url.searchParams.set("q", q.trim());
        const res = await fetch(url.toString(), { headers: authHeaders() });
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setErr(body?.error ?? "Unable to load technicians.");
          setRows([]);
        } else {
          setRows(body.rows ?? []);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  async function assign(userId: string) {
    setAssigningId(userId);
    setErr(null);
    try {
      const res = await fetch(`/api/workspace/jobs/${jobId}/assign`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "Unable to assign.");
      await onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Unable to assign.");
      setAssigningId(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b p-4">
          <h3 className="text-base font-semibold text-foreground">
            Select technician
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] rounded-md px-2 text-sm text-muted-foreground hover:bg-muted"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="border-b p-4">
          <input
            type="search"
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, user code or email"
            className="w-full min-h-[44px] rounded-lg border-[1.5px] border-gray-300 bg-white px-3 text-base outline-none focus:border-blue-600 focus:bg-blue-50"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <p className="p-4 text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              No active technicians match.
            </p>
          ) : (
            <ul className="divide-y">
              {rows.map((r) => {
                const label = r.display_name ?? r.user_name ?? r.email ?? r.user_id ?? "(user)";
                const sub = [r.user_name, r.email].filter(Boolean).join(" · ");
                const isCurrent = r.user_id && r.user_id === currentUserId;
                return (
                  <li key={r.user_id ?? label} className="p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-foreground">
                          {label}
                          {isCurrent && (
                            <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-800">
                              Current
                            </span>
                          )}
                        </div>
                        {sub && (
                          <div className="truncate text-xs text-muted-foreground">
                            {sub}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => r.user_id && assign(r.user_id)}
                        disabled={!r.user_id || assigningId === r.user_id || !!isCurrent}
                        className="min-h-[44px] rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
                      >
                        {isCurrent
                          ? "Assigned"
                          : assigningId === r.user_id
                            ? "Assigning…"
                            : "Assign"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {err && (
          <div className="border-t bg-destructive/10 px-4 py-2 text-sm text-destructive">
            {err}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- comments ---------------- */

function CommentsSection({
  jobId,
  comments,
  disabled,
  onReload,
}: {
  jobId: string;
  comments: CommentRow[];
  disabled: boolean;
  onReload: () => Promise<void>;
}) {
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<"internal" | "customer">("internal");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!body.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/workspace/jobs/${jobId}/comments`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ body: body.trim(), visibility }),
      });
      const bodyR = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(bodyR?.error ?? "Failed");
      setBody("");
      await onReload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm sm:p-6">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Comments
      </h2>

      {!disabled && (
        <div className="mb-4 space-y-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            placeholder="Add a comment…"
            className="w-full min-h-[160px] rounded-lg border-[1.5px] border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-600 focus:bg-blue-50"
          />
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-xs">
              <input
                type="radio"
                checked={visibility === "internal"}
                onChange={() => setVisibility("internal")}
              />
              Internal
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="radio"
                checked={visibility === "customer"}
                onChange={() => setVisibility("customer")}
              />
              Visible to customer
            </label>
            <div className="ml-auto">
              <button
                type="button"
                onClick={submit}
                disabled={busy || !body.trim()}
                className="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
              >
                {busy ? "Posting…" : "Post comment"}
              </button>
            </div>
          </div>
          {err && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {err}
            </div>
          )}
        </div>
      )}

      {comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No comments yet.</p>
      ) : (
        <ul className="space-y-2">
          {comments.map((c) => (
            <li key={c.id} className="rounded-lg border bg-background/50 p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">
                  {c.author_name_snapshot ?? "Unknown"}
                </span>
                <span>
                  <span
                    className={`mr-2 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${
                      c.visibility === "customer"
                        ? "border-blue-300 bg-blue-50 text-blue-800"
                        : "border-gray-300 bg-gray-50 text-gray-700"
                    }`}
                  >
                    {c.visibility}
                  </span>
                  {formatMYDateTime(c.created_at)}
                </span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm">{c.body}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ---------------- timeline ---------------- */

function TimelineSection({ items }: { items: TimelineItem[] }) {
  if (items.length === 0) return null;
  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm sm:p-6">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Timeline
      </h2>
      <ol className="space-y-2">
        {items.map((it) => (
          <li key={it.id} className="rounded-lg border bg-background/50 p-3 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-semibold text-foreground">
                {formatEvent(it)}
              </span>
              <span className="text-xs text-muted-foreground">
                {formatMYDateTime(it.performed_at)}
                {it.performed_by_name ? ` · ${it.performed_by_name}` : ""}
              </span>
            </div>
            <TimelineBody item={it} />
          </li>
        ))}
      </ol>
    </section>
  );
}

function formatEvent(it: TimelineItem): string {
  switch (it.event) {
    case "status_changed":
      return `Status: ${it.old_value ?? "—"} → ${it.new_value ?? "—"}`;
    case "priority_changed":
      return `Priority: ${it.old_value ?? "—"} → ${it.new_value ?? "—"}`;
    case "job_cancelled":
      return `Cancelled`;
    case "job_deleted":
      return `Deleted`;
    case "job_restored":
      return `Restored`;
    case "approval_granted":
      return `Approved`;
    case "approval_remark_private":
      return `Private approval remark recorded`;
    case "approval_rejected":
      return `Rejected`;
    case "technician_assigned":
      return `Assigned to ${it.new_value ?? "—"}`;
    case "technician_reassigned":
      return `Reassigned: ${it.old_value ?? "—"} → ${it.new_value ?? "—"}`;
    case "technician_unassigned":
      return `Unassigned ${it.old_value ?? ""}`;
    case "comment_added":
      return `Comment (${it.new_value ?? "internal"})`;
    case "internal_note_updated":
      return `Internal note updated`;
    default:
      return it.event;
  }
}

function TimelineBody({ item }: { item: TimelineItem }) {
  if (!item.note) return null;
  return (
    <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
      {item.note}
    </p>
  );
}

/* ---------------- danger zone ---------------- */

function AdminDangerZone({
  job,
  onReload,
}: {
  job: JobDetail;
  onReload: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [purgeConfirmed1, setPurgeConfirmed1] = useState(false);
  const [purgeText, setPurgeText] = useState("");

  async function del() {
    const reason = window.prompt("Deletion reason (required):");
    if (!reason || !reason.trim()) return;
    if (!confirm(`Soft-delete ${job.job_number}? Job number will NOT be reused.`)) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/workspace/jobs/${job.id}`, {
        method: "DELETE",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "Failed");
      await onReload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }
  async function restore() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/workspace/jobs/${job.id}/restore`, {
        method: "POST",
        headers: authHeaders(),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "Failed");
      await onReload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }
  async function purge() {
    if (purgeText !== job.job_number) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/workspace/jobs/${job.id}/purge`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: purgeText }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "Failed");
      setPurgeOpen(false);
      navigate({ to: "/support" });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-red-200 bg-red-50/40 p-4 shadow-sm sm:p-6">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-red-800">
        Danger zone
      </h2>
      <p className="mb-3 text-xs text-red-900/80">
        Soft-deleting is reversible via Restore. Permanent deletion removes the
        job and all its history and cannot be undone. Job numbers are never
        reused.
      </p>
      <div className="flex flex-wrap gap-2">
        {!job.is_deleted ? (
          <button
            type="button"
            onClick={del}
            disabled={busy}
            className="min-h-11 rounded-lg border border-red-400 bg-white px-4 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
          >
            {busy ? "Working…" : "Delete Job"}
          </button>
        ) : (
          <button
            type="button"
            onClick={restore}
            disabled={busy}
            className="min-h-11 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy ? "Restoring…" : "Restore Job"}
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setPurgeOpen(true);
            setPurgeConfirmed1(false);
            setPurgeText("");
            setErr(null);
          }}
          disabled={busy}
          className="min-h-11 rounded-lg bg-red-700 px-4 text-sm font-semibold text-white shadow-sm hover:bg-red-800 disabled:opacity-50"
        >
          Permanently delete…
        </button>
      </div>
      {err && (
        <div className="mt-2 rounded-md bg-red-100 px-3 py-2 text-sm text-red-800">
          {err}
        </div>
      )}

      {purgeOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !busy && setPurgeOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-red-800">
              Permanently delete {job.job_number}?
            </h3>
            {!purgeConfirmed1 ? (
              <>
                <p className="mt-2 text-sm text-foreground">
                  This removes the job and its full history (comments,
                  assignments, activity log). This action <strong>cannot be
                  undone</strong>.
                </p>
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setPurgeOpen(false)}
                    className="min-h-11 rounded-lg border bg-background px-4 text-sm font-semibold hover:bg-accent"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => setPurgeConfirmed1(true)}
                    className="min-h-11 rounded-lg bg-red-700 px-4 text-sm font-semibold text-white hover:bg-red-800"
                  >
                    I understand, continue
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="mt-2 text-sm text-foreground">
                  Type the job number{" "}
                  <span className="font-mono font-semibold">{job.job_number}</span>{" "}
                  below to confirm.
                </p>
                <input
                  autoFocus
                  value={purgeText}
                  onChange={(e) => setPurgeText(e.target.value)}
                  placeholder={job.job_number}
                  className="mt-3 w-full min-h-11 rounded-lg border-[1.5px] border-gray-300 bg-white px-3 font-mono text-sm outline-none focus:border-red-600"
                />
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setPurgeOpen(false)}
                    disabled={busy}
                    className="min-h-11 rounded-lg border bg-background px-4 text-sm font-semibold hover:bg-accent"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={purge}
                    disabled={busy || purgeText !== job.job_number}
                    className="min-h-11 rounded-lg bg-red-700 px-4 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
                  >
                    {busy ? "Deleting…" : "Permanently delete"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/* ---------------- primitives ---------------- */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm sm:p-6">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Kv({
  k,
  v,
  multiline = false,
}: {
  k: string;
  v: string | null | undefined;
  multiline?: boolean;
}) {
  if (!v) return null;
  return (
    <div className={multiline ? "" : "flex flex-col gap-0.5 sm:flex-row sm:gap-3"}>
      <div className="min-w-32 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {k}
      </div>
      <div className={"text-sm text-foreground " + (multiline ? "whitespace-pre-wrap" : "")}>
        {v}
      </div>
    </div>
  );
}
