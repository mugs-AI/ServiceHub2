import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";

import { getStoredToken } from "@/lib/qne/tokens";
import { useSession } from "@/lib/qne/session-context";
import { useTabs } from "@/lib/tabs";
import { allowedTransitionsClient } from "@/lib/qne/service-jobs/workflow";

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
  created_by_name: string | null;
  created_at: string;
  assigned_user_id: string | null;
  assigned_user_name_snapshot: string | null;
  assigned_user_code_snapshot: string | null;
  assigned_user_email_snapshot: string | null;
  assigned_at: string | null;
  assigned_by_user_id: string | null;
  assigned_by_name_snapshot: string | null;
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

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [jobRes, tlRes, cmRes] = await Promise.all([
        fetch(`/api/workspace/jobs/${jobId}`, { headers: authHeaders() }),
        fetch(`/api/workspace/jobs/${jobId}/timeline`, { headers: authHeaders() }),
        fetch(`/api/workspace/jobs/${jobId}/comments`, { headers: authHeaders() }),
      ]);
      const jobBody = await jobRes.json().catch(() => ({}));
      const tlBody = await tlRes.json().catch(() => ({}));
      const cmBody = await cmRes.json().catch(() => ({}));
      if (!jobRes.ok) {
        setError(jobBody?.error ?? "Unable to load job.");
        setJob(null);
      } else {
        setError(null);
        setJob(jobBody.job);
      }
      if (tlRes.ok) setTimeline(tlBody.timeline ?? []);
      if (cmRes.ok) setComments(cmBody.comments ?? []);
    } finally {
      setLoading(false);
    }
  }, [jobId]);

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

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">
            Service job
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-foreground">
            {job.job_number}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Created {new Date(job.created_at).toLocaleString()}
            {job.created_by_name ? ` by ${job.created_by_name}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={job.status} />
          <span className="rounded-full border px-2 py-0.5 text-xs font-semibold uppercase">
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
          Deleted {job.deleted_at ? new Date(job.deleted_at).toLocaleString() : ""}
          {job.deleted_by_name_snapshot ? ` by ${job.deleted_by_name_snapshot}` : ""}
          {job.deletion_reason ? ` — ${job.deletion_reason}` : ""}
        </div>
      )}

      {job.requires_approval && job.status === "Pending Approval" && (
        <ApprovalPanel job={job} isAdmin={isAdmin} onDone={reload} />
      )}

      {/* Workflow + Assigned technician — same row on md+, stacked on mobile */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
        <div className="md:col-span-3">
          {!job.is_deleted ? (
            <WorkflowActions job={job} onDone={reload} />
          ) : (
            <section className="rounded-xl border bg-card p-4 shadow-sm sm:p-6">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Workflow
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                No actions available for a deleted job.
              </p>
            </section>
          )}
        </div>
        <div className="md:col-span-2">
          <AssignmentSection
            job={job}
            canAssign={isAdmin && !job.is_deleted}
            onOpenPicker={() => setShowPicker(true)}
            onReload={reload}
          />
        </div>
      </div>

      <Section title="Job details">
        <Kv k="Customer" v={job.customer_name_snapshot ?? "(no name)"} />
        <Kv k="Customer code" v={job.customer_code_snapshot} />
        <Kv k="Subject" v={job.subject} />
        <Kv k="Problem" v={job.problem_description} multiline />
        <Kv k="Priority" v={job.priority} />
        <Kv k="Source" v={job.source} />
        {(job.subscription_category_snapshot || job.stock_code_snapshot) && (
          <>
            <Kv k="Entitlement" v={job.subscription_category_snapshot} />
            <Kv k="Stock" v={job.stock_code_snapshot} />
            <Kv
              k="Expiry"
              v={
                job.entitlement_expiry_snapshot
                  ? new Date(job.entitlement_expiry_snapshot).toLocaleDateString("en-GB")
                  : null
              }
            />
            <Kv k="Entitlement status" v={job.entitlement_status_snapshot} />
          </>
        )}
        {job.requires_approval && (
          <Kv k="Approval" v={job.status === "Pending Approval" ? "Pending" : (job.approved_at ? "Approved" : job.rejected_at ? "Rejected" : "Required")} />
        )}
      </Section>

      {job.internal_note && (
        <Section title="Internal note">
          <p className="whitespace-pre-wrap text-sm">{job.internal_note}</p>
        </Section>
      )}

      <CommentsSection
        jobId={jobId}
        comments={comments}
        disabled={job.is_deleted}
        onReload={reload}
      />

      <TimelineSection items={timeline} />

      <Section title="Contact">
        <Kv k="Contact person" v={job.contact_person} />
        <Kv k="Phone" v={job.contact_phone} />
        <Kv k="Email" v={job.contact_email} />
        <Kv k="Service address" v={job.service_address} multiline />
      </Section>

      {isAdmin && (
        <AdminDangerZone job={job} onReload={reload} />
      )}

      {showPicker && (
        <TechnicianPicker
          jobId={jobId}
          currentUserId={job.assigned_user_id}
          onClose={() => setShowPicker(false)}
          onDone={async () => {
            setShowPicker(false);
            await reload();
          }}
        />
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
    <section className="rounded-xl border bg-card p-4 shadow-sm sm:p-6">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Workflow
      </h2>
      <div className="flex flex-wrap gap-2">
        {transitions.map((to) => (
          <button
            key={to}
            type="button"
            onClick={() => transition(to)}
            disabled={!!busy}
            className={`min-h-11 rounded-lg px-4 text-sm font-semibold shadow-sm disabled:opacity-50 ${
              to === "Cancelled"
                ? "border border-destructive/40 bg-white text-destructive hover:bg-destructive/10"
                : "bg-primary text-primary-foreground hover:bg-primary/90"
            }`}
          >
            {busy === to ? "Working…" : actionLabel(job.status, to)}
          </button>
        ))}
      </div>
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
  if (to === "In Progress") return "Start Work";
  if (to === "Completed") return "Complete";
  if (to === "Cancelled") return "Cancel";
  if (to === "Waiting Customer") return "Waiting on Customer";
  if (to === "Waiting Vendor") return "Waiting on Vendor";
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
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function approve() {
    setBusy("approve");
    setErr(null);
    try {
      const res = await fetch(`/api/workspace/jobs/${job.id}/approve`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ note: note.trim() || null }),
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
        <div className="mt-3 space-y-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional approval note"
            rows={2}
            className="w-full rounded-lg border-[1.5px] border-amber-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-600"
          />
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
  onOpenPicker,
  onReload,
}: {
  job: JobDetail;
  canAssign: boolean;
  onOpenPicker: () => void;
  onReload: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const assigned = !!job.assigned_user_id;

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

  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm sm:p-6">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Assigned technician
      </h2>
      {assigned ? (
        <div className="space-y-2">
          <div className="text-base font-semibold text-foreground">
            {job.assigned_user_name_snapshot}
          </div>
          <div className="text-sm text-muted-foreground">
            {job.assigned_user_code_snapshot ?? ""}
            {job.assigned_user_code_snapshot && job.assigned_user_email_snapshot
              ? " · "
              : ""}
            {job.assigned_user_email_snapshot ?? ""}
          </div>
          <div className="text-xs text-muted-foreground">
            Assigned{" "}
            {job.assigned_at ? new Date(job.assigned_at).toLocaleString() : ""}
            {job.assigned_by_name_snapshot ? ` by ${job.assigned_by_name_snapshot}` : ""}
          </div>
        </div>
      ) : (
        <div className="text-sm font-medium text-muted-foreground">Unassigned</div>
      )}

      {canAssign && (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={onOpenPicker}
            disabled={busy}
            className="min-h-[44px] rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
          >
            {assigned ? "Change technician" : "Assign technician"}
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
        </div>
      )}
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
            rows={3}
            placeholder="Add a comment…"
            className="w-full rounded-lg border-[1.5px] border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-600 focus:bg-blue-50"
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
                  {new Date(c.created_at).toLocaleString()}
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
                {new Date(it.performed_at).toLocaleString()}
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
    case "job_cancelled":
      return `Cancelled`;
    case "job_deleted":
      return `Deleted`;
    case "job_restored":
      return `Restored`;
    case "approval_granted":
      return `Approved`;
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
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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

  return (
    <section className="rounded-xl border border-red-200 bg-red-50/40 p-4 shadow-sm sm:p-6">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-red-800">
        Administrator actions
      </h2>
      <p className="mb-3 text-xs text-red-900/80">
        Deleting a Service Job is reversible via Restore. Job numbers are never
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
      </div>
      {err && (
        <div className="mt-2 rounded-md bg-red-100 px-3 py-2 text-sm text-red-800">
          {err}
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
