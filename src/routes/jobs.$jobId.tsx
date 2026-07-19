import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";

import { getStoredToken } from "@/lib/qne/tokens";
import { useSession } from "@/lib/qne/session-context";
import { useTabs } from "@/lib/tabs";

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
}

interface TechnicianRow {
  user_id: string | null;
  user_name: string | null;
  display_name: string | null;
  email: string | null;
}

interface HistoryRow {
  id: string;
  action: "assigned" | "reassigned" | "unassigned";
  assigned_user_id: string | null;
  assigned_user_name_snapshot: string | null;
  previous_assigned_user_id: string | null;
  previous_assigned_user_name_snapshot: string | null;
  performed_by_name_snapshot: string | null;
  performed_at: string;
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
  const canAssign = !!session.currentUser?.isAdministrator;

  const [job, setJob] = useState<JobDetail | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPicker, setShowPicker] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [jobRes, histRes] = await Promise.all([
        fetch(`/api/workspace/jobs/${jobId}`, { headers: authHeaders() }),
        fetch(`/api/workspace/jobs/${jobId}/history`, { headers: authHeaders() }),
      ]);
      const jobBody = await jobRes.json().catch(() => ({}));
      const histBody = await histRes.json().catch(() => ({}));
      if (!jobRes.ok) {
        setError(jobBody?.error ?? "Unable to load job.");
        setJob(null);
      } else {
        setError(null);
        setJob(jobBody.job);
      }
      if (histRes.ok) setHistory(histBody.history ?? []);
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

  const statusTone =
    job.status === "Draft"
      ? "bg-blue-100 text-blue-800 border-blue-200"
      : "bg-amber-100 text-amber-900 border-amber-200";

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
          <span
            className={`rounded-full border px-2 py-0.5 text-xs font-semibold uppercase ${statusTone}`}
          >
            {job.status}
          </span>
          <span className="rounded-full border px-2 py-0.5 text-xs font-semibold uppercase">
            {job.priority}
          </span>
          <span className="rounded-full border px-2 py-0.5 text-xs font-semibold uppercase">
            {job.source}
          </span>
          <Link
            to="/support"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← Workspace
          </Link>
        </div>
      </header>

      {job.requires_approval && (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
          Requires approval — {job.approval_reason}.
        </div>
      )}

      <AssignmentSection
        job={job}
        canAssign={canAssign}
        onOpenPicker={() => setShowPicker(true)}
        onReload={reload}
      />

      <Section title="Customer">
        <div className="text-sm">
          <div className="font-semibold">
            {job.customer_name_snapshot ?? "(no name)"}
          </div>
          <div className="text-muted-foreground">
            {job.customer_code_snapshot}
          </div>
        </div>
      </Section>

      <Section title="Job details">
        <Kv k="Subject" v={job.subject} />
        <Kv k="Problem" v={job.problem_description} multiline />
      </Section>

      <Section title="Contact">
        <Kv k="Contact person" v={job.contact_person} />
        <Kv k="Phone" v={job.contact_phone} />
        <Kv k="Email" v={job.contact_email} />
        <Kv k="Service address" v={job.service_address} multiline />
      </Section>

      {(job.subscription_category_snapshot || job.stock_code_snapshot) && (
        <Section title="Entitlement snapshot">
          <Kv k="Category" v={job.subscription_category_snapshot} />
          <Kv k="Stock" v={job.stock_code_snapshot} />
          <Kv
            k="Expiry"
            v={
              job.entitlement_expiry_snapshot
                ? new Date(job.entitlement_expiry_snapshot).toLocaleDateString("en-GB")
                : null
            }
          />
          <Kv k="Status" v={job.entitlement_status_snapshot} />
        </Section>
      )}

      {job.internal_note && (
        <Section title="Internal note">
          <p className="whitespace-pre-wrap text-sm">{job.internal_note}</p>
        </Section>
      )}

      <AssignmentHistory rows={history} />

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
            {job.assigned_by_name_snapshot
              ? ` by ${job.assigned_by_name_snapshot}`
              : ""}
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

  const filteredRows = useMemo(() => rows, [rows]);

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
          ) : filteredRows.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              No active technicians match.
            </p>
          ) : (
            <ul className="divide-y">
              {filteredRows.map((r) => {
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
                        disabled={
                          !r.user_id || assigningId === r.user_id || !!isCurrent
                        }
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

function AssignmentHistory({ rows }: { rows: HistoryRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm sm:p-6">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Assignment history
      </h2>
      <ol className="space-y-2">
        {rows.map((r) => (
          <li key={r.id} className="rounded-lg border bg-background/50 p-3 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-semibold capitalize text-foreground">
                {r.action}
              </span>
              <span className="text-xs text-muted-foreground">
                {new Date(r.performed_at).toLocaleString()}
                {r.performed_by_name_snapshot
                  ? ` · ${r.performed_by_name_snapshot}`
                  : ""}
              </span>
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {r.action === "unassigned"
                ? `Removed ${r.previous_assigned_user_name_snapshot ?? "technician"}`
                : r.action === "reassigned"
                  ? `${r.previous_assigned_user_name_snapshot ?? "—"} → ${r.assigned_user_name_snapshot ?? "—"}`
                  : `Assigned to ${r.assigned_user_name_snapshot ?? "—"}`}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

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
