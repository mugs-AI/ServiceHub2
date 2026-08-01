import { createFileRoute, Outlet } from "@tanstack/react-router";

// Layout route only. `/customers` itself renders in customers.index.tsx.
// This MUST return <Outlet /> so /customers/due-soon and /customers/overdue mount.
export const Route = createFileRoute("/customers")({
  component: () => <Outlet />,
});
