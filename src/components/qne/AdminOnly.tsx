import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

import { useSession } from "@/lib/qne/session-context";

/**
 * Client-side administrator guard. Server routes enforce this independently
 * via requireAdministrator — this component only prevents Normal Users from
 * seeing Administrator UI shells and provides the 403 messaging required by
 * the Phase 0.9 brief.
 */
export function AdminOnly({ children }: { children: ReactNode }) {
  const { currentUser, currentUserReady } = useSession();

  if (!currentUserReady) {
    return (
      <div className="rounded-md border bg-muted/40 px-3 py-4 text-sm text-muted-foreground">
        Checking permissions…
      </div>
    );
  }

  if (!currentUser?.isAdministrator) {
    return (
      <div className="mx-auto max-w-lg rounded-lg border bg-card p-6 text-center">
        <div className="inline-flex items-center justify-center rounded-full bg-destructive/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-destructive">
          403 — Administrator access required
        </div>
        <h1 className="mt-3 text-lg font-semibold text-foreground">
          You don't have access to this page
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Administrator sections are limited to users on the ServiceHub
          administrator allowlist for your company. If you need access, ask an
          existing administrator to add your N3 email.
        </p>
        <div className="mt-4">
          <Link
            to="/support"
            className="inline-flex items-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Back to workspace
          </Link>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
