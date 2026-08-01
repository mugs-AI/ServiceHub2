import { createFileRoute } from "@tanstack/react-router";
import { AdminOnly } from "@/components/qne/AdminOnly";
import { N3ListExplorer } from "@/components/qne/N3ListExplorer";

export const Route = createFileRoute("/customers/")({
  head: () => ({
    meta: [
      { title: "N3 Customers Explorer — ServiceHub" },
      { name: "description", content: "Administrator explorer for N3 customer master data." },
      { property: "og:title", content: "N3 Customers Explorer — ServiceHub" },
      {
        property: "og:description",
        content: "Administrator explorer for N3 customer master data.",
      },
    ],
  }),
  component: () => (
    <AdminOnly>
      <N3ListExplorer
        title="N3 Customers"
        hint="Administrator explorer — live from the N3 Open API."
        defaultPath="/api/Customers/List"
        preferredColumns={["code", "companyName", "name", "email", "phone1", "isActive"]}
        searchFields={["code", "companyName", "name", "email", "registrationNo", "id"]}
        searchPlaceholder="Search by code, name, email, registration no or ID…"
      />
    </AdminOnly>
  ),
});
