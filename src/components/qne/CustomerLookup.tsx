import { useCallback, useEffect, useRef, useState } from "react";

import { getStoredToken } from "@/lib/qne/tokens";
import { useSession } from "@/lib/qne/session-context";

interface CustomerRow {
  customer_code: string;
  customer_name: string | null;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  last_synced_at: string | null;
}

interface SearchResponse {
  query: string;
  tenantHasSnapshots: boolean;
  rows: CustomerRow[];
  tooShort: boolean;
  error?: string;
}

type Phase =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "results"; data: SearchResponse }
  | { kind: "empty-tenant" }
  | { kind: "no-match" }
  | { kind: "error"; message: string };

/**
 * Workspace Customer Lookup — searches tenant-scoped `customer_snapshots`
 * via the server. Never calls N3 OpenAPI or /api/proxy.
 */
export function CustomerLookup() {
  const { currentUser } = useSession();
  const isAdmin = !!currentUser?.isAdministrator;
  const [q, setQ] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [selected, setSelected] = useState<CustomerRow | null>(null);
  const inflightRef = useRef<string | null>(null);

  const runSearch = useCallback(async (term: string) => {
    const trimmed = term.trim();
    if (trimmed.length < 2) {
      setPhase({ kind: "idle" });
      return;
    }
    if (inflightRef.current === trimmed) return;
    inflightRef.current = trimmed;
    setPhase({ kind: "loading" });
    try {
      const token = getStoredToken();
      const res = await fetch(
        `/api/workspace/customers?q=${encodeURIComponent(trimmed)}`,
        {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        },
      );
      const body = (await res.json().catch(() => ({}))) as SearchResponse;
      if (inflightRef.current !== trimmed) return;
      if (!res.ok) {
        setPhase({
          kind: "error",
          message:
            body?.error ??
            "Customer Lookup is temporarily unavailable. Please try again.",
        });
        return;
      }
      if (!body.tenantHasSnapshots) {
        setPhase({ kind: "empty-tenant" });
        return;
      }
      if (body.rows.length === 0) {
        setPhase({ kind: "no-match" });
        return;
      }
      setPhase({ kind: "results", data: body });
    } catch {
      if (inflightRef.current !== trimmed) return;
      setPhase({
        kind: "error",
        message:
          "Customer Lookup is temporarily unavailable. Please try again.",
      });
    } finally {
      if (inflightRef.current === trimmed) inflightRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (selected && phase.kind === "results") {
      const stillThere = phase.data.rows.some(
        (r) => r.customer_code === selected.customer_code,
      );
      if (!stillThere) setSelected(null);
    }
  }, [phase, selected]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSelected(null);
    runSearch(q);
  };

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by Customer name, code, contact person, phone or email."
          className="min-h-11 flex-1 min-w-64 rounded-lg border bg-background px-3 text-sm shadow-sm outline-none focus:ring-2 focus:ring-primary/40"
        />
        <button
          type="submit"
          disabled={phase.kind === "loading" || q.trim().length < 2}
          className="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
        >
          {phase.kind === "loading" ? "Searching…" : "Search"}
        </button>
      </form>

      {phase.kind === "idle" && (
        <div className="rounded-lg border border-dashed bg-card/60 p-6 text-center text-sm text-muted-foreground">
          Start by searching for a Customer.
        </div>
      )}

      {phase.kind === "loading" && (
        <div className="flex items-center gap-2 rounded-lg border bg-card/60 px-3 py-2 text-sm text-muted-foreground">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          Searching Customer snapshots…
        </div>
      )}

      {phase.kind === "no-match" && (
        <div className="rounded-lg border bg-card/60 p-4 text-sm text-muted-foreground">
          No Customer was found for this search.
        </div>
      )}

      {phase.kind === "empty-tenant" && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p>
            Customer snapshots are empty for this Client. Ask an Administrator
            to run Customer Snapshot Sync.
          </p>
          {isAdmin && (
            <a
              href="/admin/snapshots"
              className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-amber-900 underline underline-offset-2 hover:text-amber-950"
            >
              Open Snapshot Console →
            </a>
          )}
        </div>
      )}

      {phase.kind === "error" && (
        <div className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {phase.message}
        </div>
      )}

      {phase.kind === "results" && (
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
            <div className="border-b bg-muted/60 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Results ({phase.data.rows.length})
            </div>
            <ul className="max-h-96 overflow-y-auto">
              {phase.data.rows.map((c) => (
                <li key={c.customer_code}>
                  <button
                    onClick={() => setSelected(c)}
                    className={`flex w-full flex-col items-start border-b px-3 py-2 text-left text-sm transition-colors hover:bg-accent ${
                      selected?.customer_code === c.customer_code
                        ? "bg-accent"
                        : ""
                    }`}
                  >
                    <span className="font-medium text-foreground">
                      {c.customer_name ?? "(no name)"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {c.customer_code}
                      {c.contact_person ? ` · ${c.contact_person}` : ""}
                    </span>
                    {(c.phone || c.email) && (
                      <span className="text-xs text-muted-foreground">
                        {[c.phone, c.email].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-4">
            <div className="rounded-lg border bg-card p-4 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Customer summary
              </div>
              {!selected ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  Select a customer to view their snapshot details.
                </p>
              ) : (
                <div className="mt-2 space-y-3">
                  <div>
                    <div className="text-base font-semibold text-foreground">
                      {selected.customer_name ?? "(no name)"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {selected.customer_code}
                    </div>
                  </div>
                  <dl className="grid grid-cols-2 gap-y-1 text-sm">
                    {selected.contact_person && (
                      <>
                        <dt className="text-muted-foreground">Contact</dt>
                        <dd>{selected.contact_person}</dd>
                      </>
                    )}
                    {selected.phone && (
                      <>
                        <dt className="text-muted-foreground">Phone</dt>
                        <dd>{selected.phone}</dd>
                      </>
                    )}
                    {selected.email && (
                      <>
                        <dt className="text-muted-foreground">Email</dt>
                        <dd className="truncate">{selected.email}</dd>
                      </>
                    )}
                    {selected.last_synced_at && (
                      <>
                        <dt className="text-muted-foreground">Snapshot synced</dt>
                        <dd>
                          {new Date(selected.last_synced_at).toLocaleString()}
                        </dd>
                      </>
                    )}
                  </dl>
                </div>
              )}
            </div>

            <div
              className="rounded-lg border border-dashed bg-card/60 p-4"
              data-extension="contract-status"
            >
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Contract status
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Contract, expiry and remaining days will appear here once the
                Contract Snapshot surface is wired in the next milestone.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
