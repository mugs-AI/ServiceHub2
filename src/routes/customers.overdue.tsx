import { createFileRoute } from "@tanstack/react-router";

import { EntitlementCustomerScreen } from "@/components/qne/EntitlementCustomerScreen";

export const Route = createFileRoute("/customers/overdue")({
  head: () => ({
    meta: [
      { title: "Overdue Customer List — ServiceHub" },
      {
        name: "description",
        content: "Customers with one or more expired entitlements.",
      },
      { property: "og:title", content: "Overdue Customer List — ServiceHub" },
      {
        property: "og:description",
        content: "Customers with one or more expired entitlements.",
      },
    ],
  }),
  component: OverduePage,
});

function OverduePage() {
  return (
    <EntitlementCustomerScreen
      status="overdue"
      title="Overdue Customer List"
      subtitle="Customers with one or more expired entitlements."
    />
  );
}
