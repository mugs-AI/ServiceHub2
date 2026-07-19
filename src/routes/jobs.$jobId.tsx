import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { getStoredToken } from "@/lib/qne/tokens";

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
}

export const Route = createFileRoute("/jobs/$jobId")({
  component: JobDetailPage,
});

function JobDetailPage() {
  const { jobId } = Route.useParams();
  const [job, setJob] = useState<JobDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const token = getStoredToken();
        const res = await fetch(`/api/workspace/jobs/${jobId}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setError(body?.error ?? "Unable to load job.");
        } else {
          setJob(body.job);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  if (loading) {
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

      <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900 ring-1 ring-emerald-200">
        Job {job.job_number} saved successfully.
      </div>

      {job.requires_approval && (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
          Requires approval — {job.approval_reason}.
        </div>
      )}

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
    </div>
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
