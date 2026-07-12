import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { qneGetList } from "@/lib/qne/client";
import { loadStockMap, type StockMap } from "@/lib/qne/stock-map";
import { useSession } from "@/lib/qne/session-context";

export const Route = createFileRoute("/")({
  component: HomeRouter,
});

function HomeRouter() {
  const { currentUser, currentUserReady } = useSession();
  if (!currentUserReady) {
    return (
      <div className="rounded-md border bg-muted/40 px-3 py-4 text-sm text-muted-foreground">
        Loading workspace…
      </div>
    );
  }
  if (!currentUser?.isAdministrator) {
    return <Navigate to="/support" replace />;
  }
  return <ServiceConsole />;
}

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

function ServiceConsole() {
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
      // Search recent invoices and delivery orders for this customer.
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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Customer Service Console</h1>
        <p className="text-sm text-muted-foreground">
          Search a customer and inspect their maintenance-contract status. Configure
          which stock codes count as Maintenance / Renewal in <span className="font-medium">Settings</span>.
        </p>
      </div>

      <form onSubmit={search} className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Customer name or code…"
          className="w-80 rounded-md border bg-background px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          Search
        </button>
      </form>

      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {results.length > 0 && (
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="overflow-hidden rounded-md border">
            <div className="border-b bg-muted px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">
              Results
            </div>
            <ul>
              {results.map((c, i) => (
                <li key={i}>
                  <button
                    onClick={() => computeStatus(c)}
                    className={`flex w-full flex-col items-start border-b px-3 py-2 text-left text-sm hover:bg-accent ${
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

          <div className="rounded-md border p-4">
            {!selected && (
              <p className="text-sm text-muted-foreground">
                Select a customer to compute contract status.
              </p>
            )}
            {selected && status && (
              <div className="space-y-3">
                <div>
                  <div className="text-xs uppercase text-muted-foreground">Customer</div>
                  <div className="text-base font-semibold text-foreground">
                    {selected.companyName ?? selected.name}
                  </div>
                  <div className="text-xs text-muted-foreground">{selected.code}</div>
                </div>
                <StatusBadge status={status.status} />
                {status.docNo && (
                  <dl className="grid grid-cols-2 gap-2 text-sm">
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
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const cls: Record<Status, string> = {
    Active: "bg-emerald-100 text-emerald-800",
    "Due Soon": "bg-amber-100 text-amber-800",
    Overdue: "bg-red-100 text-red-800",
    Unknown: "bg-muted text-muted-foreground",
  };
  return (
    <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${cls[status]}`}>
      {status}
    </span>
  );
}
