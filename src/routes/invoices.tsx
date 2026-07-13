import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { AdminOnly } from "@/components/qne/AdminOnly";
import { N3ListExplorer } from "@/components/qne/N3ListExplorer";

export const Route = createFileRoute("/invoices")({
  component: () => (
    <AdminOnly>
      <InvoicesPage />
    </AdminOnly>
  ),
});

function InvoicesPage() {
  const [tab, setTab] = useState<"invoice" | "do">("invoice");
  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b">
        {(
          [
            ["invoice", "Sales Invoices"],
            ["do", "Delivery Orders"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              tab === id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "invoice" ? (
        <N3ListExplorer
          key="invoice"
          title="Sales Invoices"
          defaultPath="/api/SalesInvoices/List"
          preferredColumns={["docNo", "docDate", "customerCode", "customerName", "netTotal"]}
        />
      ) : (
        <N3ListExplorer
          key="do"
          title="Delivery Orders"
          defaultPath="/api/DeliveryOrders/List"
          preferredColumns={["docNo", "docDate", "customerCode", "customerName", "netTotal"]}
        />
      )}
    </div>
  );
}
