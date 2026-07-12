import { createFileRoute } from "@tanstack/react-router";
import { AdminOnly } from "@/components/qne/AdminOnly";
import { N3ListExplorer } from "@/components/qne/N3ListExplorer";

export const Route = createFileRoute("/customers")({
  component: () => (
    <AdminOnly>
      <N3ListExplorer
        title="N3 Customers"
        hint="Administrator explorer — live from the N3 Open API."
        defaultPath="/api/customer"
        preferredColumns={["code", "companyName", "name", "email", "phone1", "isActive"]}
      />
    </AdminOnly>
  ),
});
