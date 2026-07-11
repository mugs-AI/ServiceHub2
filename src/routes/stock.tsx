import { createFileRoute } from "@tanstack/react-router";
import { N3ListExplorer } from "@/components/qne/N3ListExplorer";

export const Route = createFileRoute("/stock")({
  component: () => (
    <N3ListExplorer
      title="Stock codes"
      hint="Master stock records from N3. Use Settings to mark stock codes as Maintenance / Renewal or Ad-hoc Service."
      defaultPath="/api/stock"
      preferredColumns={["code", "description", "uom", "stockGroup", "isActive"]}
    />
  ),
});
