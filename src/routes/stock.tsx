import { createFileRoute } from "@tanstack/react-router";
import { AdminOnly } from "@/components/qne/AdminOnly";
import { N3ListExplorer } from "@/components/qne/N3ListExplorer";

export const Route = createFileRoute("/stock")({
  component: () => (
    <AdminOnly>
      <N3ListExplorer
        title="N3 Stock codes"
        hint="Administrator explorer — master stock records from N3. Use Settings to map stock codes."
        defaultPath="/api/stock"
        preferredColumns={["code", "description", "uom", "stockGroup", "isActive"]}
      />
    </AdminOnly>
  ),
});
