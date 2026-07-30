import { createFileRoute } from "@tanstack/react-router";

import { EntitlementCustomerScreen } from "@/components/qne/EntitlementCustomerScreen";

export const Route = createFileRoute("/customers/due-soon")({
  head: () => ({
    meta: [
      { title: "Due Soon Customer List — ServiceHub" },
      {
        name: "description",
        content: "Customers with one or more entitlements due soon.",
      },
      { property: "og:title", content: "Due Soon Customer List — ServiceHub" },
      {
        property: "og:description",
        content: "Customers with one or more entitlements due soon.",
      },
    ],
  }),
  component: DueSoonPage,
});

function DueSoonPage() {
  return (
    <EntitlementCustomerScreen
      status="due_soon"
      title="Due Soon Customer List"
      subtitle="Customers with one or more entitlements due soon."
    />
  );
}
