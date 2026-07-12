import { useMemo, useState } from "react";

import { qneGetList } from "@/lib/qne/client";
import { loadStockMap, type StockMap } from "@/lib/qne/stock-map";
import { useSession } from "@/lib/qne/session-context";

interface Customer {
  code?: string;
  companyName?: string;
  name?: string;
  [k: string]: unknown;
}

interface Doc {
  docNo?: string;
  documentNo?: string;
  docDate?: string;
  date?: string;
  customerCode?: string;
  details?: Array<{ stockCode?: string; [k: string]: unknown }>;
  [k: string]: unknown;
}

type Status = "Active" | "Due Soon" | "Overdue" | "Unknown";

/**
 * Workspace Customer Lookup. Shared by Administrator and Normal User.
 * Uses live N3 data via the same-origin proxy — no fake customers.
 */
export function CustomerLookup() {
  const { session } = useSession();
  const tenant = session?.tenantCode ?? "";
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Customer[]>([]);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<{
    status: Status;
    docNo?: string;
    docDate?: string;
    expiry?: string;
    daysLeft?: number;
    matchedStock?: string;
  } | null>(null);

  const stockMap: StockMap = useMemo(() => loadStockMap(tenant), [tenant]);
  const maintenanceCodes = useMemo(
    () =>
      Object.entries(stockMap)
        .filter(([, v]) => v.type === "maintenance")
        .map(([code, v]) => ({ code, days: v.durationDays ?? 365 })),
    [stockMap],
  );

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSelected(null);
    setStatus(null);
    try {
      const { rows } = await qneGetList<Customer>("main", "/api/customer", {
        pageNo: 1,
        pageSize: 20,
        search: q,
      });
      setResults(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const computeStatus = async (customer: Customer) => {
    setSelected(customer);
    setStatus(null);
    setError(null);
    if (maintenanceCodes.length === 0) {
      setStatus({ status: "Unknown" });
      setError("No stock codes are mapped as Maintenance/Renewal in Settings.");
      return;
    }
    const code = customer.code ?? "";
    if (!code) {
      setStatus({ status: "Unknown" });
      return;
    }
    setBusy(true);
    try {
      const [inv, dos] = await Promise.all([
        qneGetList<Doc>("main", "/api/salesinvoice", {
          pageNo: 1,
          pageSize: 50,
          customerCode: code,
        }).catch(() => ({ rows: [] as Doc[], total: 0 })),
        qneGetList<Doc>("main", "/api/deliveryorder", {
          pageNo: 1,
          pageSize: 50,
          customerCode: code,
        }).catch(() => ({ rows: [] as Doc[], total: 0 })),
      ]);
      const all = [...inv.rows, ...dos.rows];
      const qualifying = all
        .map((doc) => {
          const lines = Array.isArray(doc.details) ? doc.details : [];
          const match = lines
            .map((l) => maintenanceCodes.find((m) => m.code === l.stockCode))
            .find(Boolean);
          if (!match) return null;
          const date = doc.docDate ?? doc.date;
          if (!date) return null;
          const start = new Date(date);
          if (Number.isNaN(start.getTime())) return null;
          const expiry = new Date(start.getTime() + match.days * 86400000);
          return { doc, match, start, expiry };
        })
        .filter(Boolean) as Array<{
        doc: Doc;
        match: { code: string; days: number };
        start: Date;
        expiry: Date;
      }>;

      if (qualifying.length === 0) {
        setStatus({ status: "Unknown" });
        return;
      }
      qualifying.sort((a, b) => b.start.getTime() - a.start.getTime());
      const latest = qualifying[0];
      const now = Date.now();
      const daysLeft = Math.ceil((latest.expiry.getTime() - now) / 86400000);
      const s: Status =
        daysLeft < 0 ? "Overdue" : daysLeft <= 30 ? "Due Soon" : "Active";
      setStatus({
        status: s,
        docNo: latest.doc.docNo ?? latest.doc.documentNo,
        docDate: latest.start.toISOString().slice(0, 10),
        expiry: latest.expiry.toISOString().slice(0, 10),
        daysLeft,
        matchedStock: latest.match.code,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <form onSubmit={search} className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search customer by name or code…"
          className="min-h-11 flex-1 min-w-64 rounded-lg border bg-background px-3 text-sm shadow-sm outline-none focus:ring-2 focus:ring-primary/40"
        />
        <button
          type="submit"
          disabled={busy}
          className="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
        >
          {busy ? "Searching…" : "Search"}
        </button>
      </form>

      {error && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {results.length === 0 && !busy && (
        <div className="rounded-lg border border-dashed bg-card/60 p-6 text-center text-sm text-muted-foreground">
          Start by searching for a Customer above. Their contract status, snapshot
          and service history will appear here.
        </div>
      )}

      {results.length > 0 && (
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
            <div className="border-b bg-muted/60 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Results
            </div>
            <ul className="max-h-96 overflow-y-auto">
              {results.map((c, i) => (
                <li key={i}>
                  <button
                    onClick={() => computeStatus(c)}
                    className={`flex w-full flex-col items-start border-b px-3 py-2 text-left text-sm transition-colors hover:bg-accent ${
                      selected === c ? "bg-accent" : ""
                    }`}
                  >
                    <span className="font-medium text-foreground">
                      {c.companyName ?? c.name ?? "(no name)"}
                    </span>
                    <span className="text-xs text-muted-foreground">{c.code}</span>
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
                  Select a customer to load their snapshot and contract status.
                </p>
              ) : (
                <div className="mt-2 space-y-3">
                  <div>
                    <div className="text-base font-semibold text-foreground">
                      {selected.companyName ?? selected.name}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {selected.code}
                    </div>
                  </div>
                  {status && <StatusBadge status={status.status} />}
                  {status?.docNo && (
                    <dl className="grid grid-cols-2 gap-y-1 text-sm">
                      <dt className="text-muted-foreground">Latest doc</dt>
                      <dd>{status.docNo}</dd>
                      <dt className="text-muted-foreground">Doc date</dt>
                      <dd>{status.docDate}</dd>
                      <dt className="text-muted-foreground">Expiry</dt>
                      <dd>{status.expiry}</dd>
                      <dt className="text-muted-foreground">Days remaining</dt>
                      <dd>{status.daysLeft}</dd>
                      <dt className="text-muted-foreground">Matched stock</dt>
                      <dd className="font-mono text-xs">{status.matchedStock}</dd>
                    </dl>
                  )}
                </div>
              )}
            </div>

            <div className="rounded-lg border border-dashed bg-card/60 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Service history
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Coming soon — Service Jobs, visits and follow-ups for this
                customer will appear here in Phase 1.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const cls: Record<Status, string> = {
    Active: "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200",
    "Due Soon": "bg-amber-100 text-amber-800 ring-1 ring-amber-200",
    Overdue: "bg-red-100 text-red-800 ring-1 ring-red-200",
    Unknown: "bg-muted text-muted-foreground ring-1 ring-border",
  };
  const dot: Record<Status, string> = {
    Active: "bg-emerald-500",
    "Due Soon": "bg-amber-500",
    Overdue: "bg-red-500",
    Unknown: "bg-muted-foreground/60",
  };
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${cls[status]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot[status]}`} />
      {status}
    </span>
  );
}
