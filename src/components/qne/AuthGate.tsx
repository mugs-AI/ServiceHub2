import { Link, Outlet } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { useSession } from "@/lib/qne/session-context";
import { DevLoginScreen } from "./DevLoginScreen";
import { RelaunchNotice } from "./RelaunchNotice";

const NAV = [
  { to: "/", label: "Service Console" },
  { to: "/customers", label: "Customers" },
  { to: "/stock", label: "Stock" },
  { to: "/invoices", label: "Sales & DO" },
  { to: "/users", label: "N3 Users" },
  { to: "/settings", label: "Settings" },
] as const;

export function AuthGate({ children }: { children?: ReactNode }) {
  const { ready, token, session, error } = useSession();

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Loading session…</p>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="min-h-screen bg-background">
        <TopBrand />
        {import.meta.env.DEV ? <DevLoginScreen /> : <RelaunchNotice />}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-3">
          <Link to="/" className="text-base font-semibold text-foreground">
            ServiceHub2
          </Link>
          <nav className="flex flex-wrap items-center gap-1 text-sm">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                activeOptions={{ exact: item.to === "/" }}
                className="rounded-md px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground [&.active]:bg-accent [&.active]:text-foreground"
                activeProps={{ className: "active" }}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-4 text-xs">
            <SessionBadge />
            <SignOutButton />
          </div>
        </div>
        {error && (
          <div className="border-t bg-destructive/10 px-4 py-2 text-xs text-destructive">
            Session error: {error}
          </div>
        )}
        {!session && !error && (
          <div className="border-t bg-muted px-4 py-2 text-xs text-muted-foreground">
            Loading company profile…
          </div>
        )}
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children ?? <Outlet />}</main>
    </div>
  );
}

function TopBrand() {
  return (
    <header className="border-b bg-card">
      <div className="mx-auto max-w-7xl px-4 py-3 text-base font-semibold text-foreground">
        ServiceHub2
      </div>
    </header>
  );
}

function SessionBadge() {
  const { session } = useSession();
  if (!session) return null;
  return (
    <div className="flex flex-col text-right leading-tight">
      <span className="font-medium text-foreground">
        {session.companyName || "—"}
      </span>
      <span className="text-muted-foreground">
        {session.tenantCode || "—"} · {session.email || "—"}
      </span>
    </div>
  );
}

function SignOutButton() {
  const { signOut } = useSession();
  return (
    <button
      onClick={signOut}
      className="rounded-md border px-2 py-1 text-xs font-medium text-foreground hover:bg-accent"
    >
      Sign out
    </button>
  );
}
