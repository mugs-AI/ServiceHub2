import { createFileRoute } from "@tanstack/react-router";
import { N3ListExplorer } from "@/components/qne/N3ListExplorer";

export const Route = createFileRoute("/customers")({
  component: () => (
    <N3ListExplorer
      title="Customers"
      hint="Live from N3 Open API. Edit the endpoint path if your tenant exposes a different route."
      defaultPath="/api/customer"
      preferredColumns={["code", "companyName", "name", "email", "phone1", "isActive"]}
    />
  ),
});
