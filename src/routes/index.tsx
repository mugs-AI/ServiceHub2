import { createFileRoute, Navigate } from "@tanstack/react-router";

import { useSession } from "@/lib/qne/session-context";

export const Route = createFileRoute("/")({
  component: HomeRouter,
});

/**
 * Root route only routes the authenticated user to the correct dashboard
 * for their role. All operational functions live under their own routes.
 */
function HomeRouter() {
  const { currentUser, currentUserReady } = useSession();
  if (!currentUserReady) {
    return (
      <div className="rounded-lg border bg-card px-4 py-6 text-sm text-muted-foreground shadow-sm">
        Loading workspace…
      </div>
    );
  }
  if (currentUser?.isAdministrator) {
    return <Navigate to="/admin/dashboard" replace />;
  }
  return <Navigate to="/dashboard" replace />;
}
