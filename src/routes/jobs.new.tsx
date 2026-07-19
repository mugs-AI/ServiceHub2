import { createFileRoute, useNavigate, useSearch, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getStoredToken } from "@/lib/qne/tokens";

type Priority = "High" | "Medium" | "Low";
type SourceType =
  | "Phone"
  | "WhatsApp"
  | "Email"
  | "Walk-in"
  | "Remote Support"
  | "Other";

interface CustomerRow {
  customer_code: string;
  customer_name: string | null;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
}

interface SubscriptionRow {
  id: string;
  subscription_category: string | null;
  stock_code: string | null;
  stock_name: string | null;
  expiry_date: string | null;
  subscription_status: string | null;
}

interface JobsNewSearch {
  customerCode?: string;
}

export const Route = createFileRoute("/jobs/new")({
  validateSearch: (search: Record<string, unknown>): JobsNewSearch => ({
    customerCode:
      typeof search.customerCode === "string" ? search.customerCode : undefined,
  }),
  component: NewJobPage,
});

function authHeaders(): HeadersInit {
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function NewJobPage() {
  const search = useSearch({ from: "/jobs/new" });
  const navigate = useNavigate();

  const [q, setQ] = useState(search.customerCode ?? "");
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [customer, setCustomer] = useState<CustomerRow | null>(null);
  const [subs, setSubs] = useState<SubscriptionRow[]>([]);
  const [subsLoading, setSubsLoading] = useState(false);
  const [selectedSubId, setSelectedSubId] = useState<string | "">("");

  const [contactPerson, setContactPerson] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [serviceAddress, setServiceAddress] = useState("");
  const [subject, setSubject] = useState("");
  const [problem, setProblem] = useState("");
  const [priority, setPriority] = useState<Priority>("Medium");
  const [source, setSource] = useState<SourceType>("Phone");
  const [internalNote, setInternalNote] = useState("");

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const inflightRef = useRef(false);

  const runSearch = useCallback(async (term: string) => {
    const trimmed = term.trim();
    if (trimmed.length < 2) {
      setCustomers([]);
      setSearchError(null);
      return;
    }
    setSearching(true);
    setSearchError(null);
    try {
      const res = await fetch(
        `/api/workspace/customers?q=${encodeURIComponent(trimmed)}`,
        { headers: authHeaders() },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSearchError(body?.error ?? "Search failed.");
        setCustomers([]);
      } else {
        setCustomers(body.rows ?? []);
      }
    } catch {
      setSearchError("Search failed.");
    } finally {
      setSearching(false);
    }
  }, []);

  // Auto-search when landing with ?customerCode=…
  useEffect(() => {
    if (search.customerCode) runSearch(search.customerCode);
  }, [search.customerCode, runSearch]);

  // Load entitlements for the picked customer.
  useEffect(() => {
    if (!customer) {
      setSubs([]);
      setSelectedSubId("");
      return;
    }
    let cancelled = false;
    (async () => {
      setSubsLoading(true);
      try {
        const res = await fetch(
          `/api/workspace/customer-subscriptions?customerCode=${encodeURIComponent(customer.customer_code)}`,
          { headers: authHeaders() },
        );
        const body = await res.json().catch(() => ({}));
        if (!cancelled) {
          setSubs(res.ok ? (body.subscriptions ?? []) : []);
          setSelectedSubId("");
        }
      } finally {
        if (!cancelled) setSubsLoading(false);
      }
    })();
    // Prefill contact/address from the customer snapshot.
    setContactPerson(customer.contact_person ?? "");
    setContactPhone(customer.phone ?? "");
    setContactEmail(customer.email ?? "");
    return () => {
      cancelled = true;
    };
  }, [customer]);

  const gate = useMemo(() => {
    if (!customer) return null;
    const hasActive = subs.some((s) =>
      ["Active", "Due Soon"].includes(s.subscription_status ?? ""),
    );
    const hasOverdue = subs.some((s) => s.subscription_status === "Overdue");
    if (hasActive)
      return { tone: "ok" as const, label: "Active entitlement — Draft" };
    if (hasOverdue)
      return {
        tone: "warn" as const,
        label: "Overdue entitlement — Pending Approval",
      };
    return {
      tone: "warn" as const,
      label: "No active entitlement — Pending Approval",
    };
  }, [customer, subs]);

  const canSubmit =
    !!customer &&
    subject.trim().length > 0 &&
    problem.trim().length > 0 &&
    !saving;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || inflightRef.current) return;
    inflightRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/workspace/jobs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify({
          customer_code: customer!.customer_code,
          contact_person: contactPerson || null,
          contact_phone: contactPhone || null,
          contact_email: contactEmail || null,
          service_address: serviceAddress || null,
          subject,
          problem_description: problem,
          priority,
          source,
          internal_note: internalNote || null,
          subscription_snapshot_id: selectedSubId || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveError(body?.error ?? "Failed to save the job.");
        return;
      }
      navigate({ to: "/jobs/$jobId", params: { jobId: body.job.id } });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save the job.");
    } finally {
      setSaving(false);
      inflightRef.current = false;
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">
            Service jobs
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-foreground">
            New service job
          </h1>
        </div>
        <Link
          to="/support"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Back to workspace
        </Link>
      </header>

      <form onSubmit={onSubmit} className="space-y-6">
        {/* 1. Customer */}
        <Section title="Customer">
          {!customer ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      runSearch(q);
                    }
                  }}
                  placeholder="Search by code, name, contact, phone or email…"
                  className="input"
                />
                <button
                  type="button"
                  onClick={() => runSearch(q)}
                  disabled={searching || q.trim().length < 2}
                  className="min-h-11 shrink-0 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                >
                  {searching ? "Searching…" : "Search"}
                </button>
              </div>
              {searchError && (
                <p className="text-sm text-destructive">{searchError}</p>
              )}
              {customers.length > 0 && (
                <ul className="max-h-72 overflow-y-auto rounded-lg border bg-card">
                  {customers.map((c) => (
                    <li key={c.customer_code}>
                      <button
                        type="button"
                        onClick={() => setCustomer(c)}
                        className="flex w-full flex-col items-start border-b px-3 py-2 text-left text-sm hover:bg-accent"
                      >
                        <span className="font-medium">
                          {c.customer_name ?? "(no name)"}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {c.customer_code}
                          {c.contact_person ? ` · ${c.contact_person}` : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="flex items-start justify-between gap-3 rounded-lg border bg-background p-3">
              <div>
                <div className="text-sm font-semibold text-foreground">
                  {customer.customer_name ?? "(no name)"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {customer.customer_code}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCustomer(null)}
                className="text-xs font-medium text-primary hover:text-primary/80"
              >
                Change
              </button>
            </div>
          )}
        </Section>

        {/* 2. Entitlement */}
        {customer && (
          <Section title="Entitlement status">
            {subsLoading ? (
              <p className="text-sm text-muted-foreground">Loading entitlements…</p>
            ) : (
              <>
                <div
                  className={
                    "rounded-lg border px-3 py-2 text-sm font-medium " +
                    (gate?.tone === "ok"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                      : "border-amber-200 bg-amber-50 text-amber-900")
                  }
                >
                  {gate?.label ?? "—"}
                </div>
                {subs.length > 0 && (
                  <ul className="mt-3 space-y-2">
                    {subs.map((s) => {
                      const checked = selectedSubId === s.id;
                      return (
                        <li key={s.id}>
                          <label
                            className={
                              "flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-sm " +
                              (checked ? "border-primary bg-primary/5" : "bg-background")
                            }
                          >
                            <input
                              type="radio"
                              name="entitlement"
                              className="mt-1"
                              checked={checked}
                              onChange={() => setSelectedSubId(s.id)}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold">
                                  {s.subscription_category ?? "Uncategorised"}
                                </span>
                                <span className="rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                                  {s.subscription_status ?? "unknown"}
                                </span>
                              </div>
                              <div className="text-xs text-muted-foreground">
                                Stock: {s.stock_code ?? "—"}
                                {s.expiry_date
                                  ? ` · Expiry: ${new Date(s.expiry_date).toLocaleDateString("en-GB")}`
                                  : ""}
                              </div>
                            </div>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {subs.length === 0 && !subsLoading && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    No live entitlements. You may still create the job — it
                    will require approval.
                  </p>
                )}
              </>
            )}
          </Section>
        )}

        {/* 3. Job details */}
        <Section title="Job details">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Subject *">
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                required
                className="input"
              />
            </Field>
            <Field label="Priority">
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as Priority)}
                className="input"
              >
                <option>High</option>
                <option>Medium</option>
                <option>Low</option>
              </select>
            </Field>
            <Field label="Source">
              <select
                value={source}
                onChange={(e) => setSource(e.target.value as SourceType)}
                className="input"
              >
                {["Phone", "WhatsApp", "Email", "Walk-in", "Remote Support", "Other"].map(
                  (s) => (
                    <option key={s}>{s}</option>
                  ),
                )}
              </select>
            </Field>
            <Field label="Problem description *" className="sm:col-span-2">
              <textarea
                value={problem}
                onChange={(e) => setProblem(e.target.value)}
                required
                rows={4}
                className="input"
              />
            </Field>
          </div>
        </Section>

        {/* 4. Contact details */}
        <Section title="Contact details">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Contact person">
              <input value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} className="input" />
            </Field>
            <Field label="Contact phone">
              <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} className="input" />
            </Field>
            <Field label="Contact email">
              <input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className="input" />
            </Field>
            <Field label="Service address" className="sm:col-span-2">
              <textarea
                value={serviceAddress}
                onChange={(e) => setServiceAddress(e.target.value)}
                rows={2}
                className="input"
              />
            </Field>
          </div>
        </Section>

        {/* 5. Internal note */}
        <Section title="Internal note">
          <textarea
            value={internalNote}
            onChange={(e) => setInternalNote(e.target.value)}
            rows={3}
            className="input"
            placeholder="Optional — not shown to the customer."
          />
        </Section>

        {/* 6. Save */}
        <div className="flex flex-wrap items-center justify-end gap-3">
          {saveError && (
            <span className="text-sm text-destructive">{saveError}</span>
          )}
          <button
            type="submit"
            disabled={!canSubmit}
            className="min-h-11 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save Draft"}
          </button>
        </div>
      </form>

      <style>{`
        .input {
          width: 100%;
          min-height: 44px;
          border-radius: 0.5rem;
          border: 1.5px solid #d1d5db;
          background: #ffffff;
          padding: 0.5rem 0.875rem;
          font-size: 1rem;
          color: #111827;
          outline: none;
          transition: border-color 120ms ease, background-color 120ms ease, box-shadow 120ms ease;
          box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.04);
        }
        .input::placeholder {
          color: #6b7280;
        }
        .input:focus {
          border-color: #2563eb;
          background: #eff6ff;
          box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.18), inset 0 1px 2px rgba(0, 0, 0, 0.04);
        }
        .input:disabled {
          background: #f3f4f6;
          border-color: #e5e7eb;
          color: #9ca3af;
        }
        select.input {
          appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 0.75rem center;
          padding-right: 2.25rem;
        }
        textarea.input {
          min-height: 96px;
          resize: vertical;
        }
        @media (max-width: 640px) {
          .input {
            font-size: 1rem;
            padding: 0.625rem 0.875rem;
          }
        }
      `}</style>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm sm:p-6">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={"flex flex-col gap-1 " + className}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
