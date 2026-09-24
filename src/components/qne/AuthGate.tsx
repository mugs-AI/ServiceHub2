import { Link, Outlet } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useSession, type CurrentUserInfo } from "@/lib/qne/session-context";
import { TabsProvider, type AppTab } from "@/lib/tabs";
import { AppTabs } from "./AppTabs";
import { DevLoginScreen } from "./DevLoginScreen";
import { RelaunchNotice } from "./RelaunchNotice";

interface NavItem {
  to: string;
  label: string;
}

/** WP3C-2 — persistent header navigation, same order on every width. */
export const PRIMARY_NAV_LABELS = ["Dashboard", "Workspace", "Pending", "Calendar"] as const;

const USER_NAV: NavItem[] = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/support", label: "Workspace" },
  { to: "/jobs/pending", label: "Pending" },
  { to: "/calendar", label: "Calendar" },
];

const ADMIN_NAV: NavItem[] = [
  { to: "/admin/dashboard", label: "Dashboard" },
  { to: "/support", label: "Workspace" },
  { to: "/jobs/pending", label: "Pending" },
  { to: "/calendar", label: "Calendar" },
];

const ADMIN_TOOLS: NavItem[] = [
  { to: "/admin/snapshots", label: "Snapshot Console" },
  { to: "/settings", label: "Settings" },
  { to: "/customers", label: "N3 Customers" },
  { to: "/stock", label: "N3 Stock" },
  { to: "/invoices", label: "N3 Sales & DO" },
  { to: "/users", label: "N3 Users" },
];

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
    <AuthenticatedShell error={error} session={session}>
      {children}
    </AuthenticatedShell>
  );
}

function AuthenticatedShell({
  error,
  session,
  children,
}: {
  error: string | null;
  session: unknown;
  children?: ReactNode;
}) {
  const { currentUser } = useSession();
  const isAdmin = !!currentUser?.isAdministrator;
  const pinned = useMemo<AppTab[]>(
    () => [
      {
        key: "pin:dashboard",
        label: "Dashboard",
        href: isAdmin ? "/admin/dashboard" : "/dashboard",
        closable: false,
        kind: "pinned",
      },
      {
        key: "pin:workspace",
        label: "Workspace",
        href: "/support",
        closable: false,
        kind: "pinned",
      },
      {
        key: "pin:pending",
        label: "Pending",
        href: "/jobs/pending",
        closable: false,
        kind: "pinned",
      },
      {
        key: "pin:calendar",
        label: "Calendar",
        href: "/calendar",
        closable: false,
        kind: "pinned",
      },
    ],
    [isAdmin],
  );

  return (
    <TabsProvider pinned={pinned}>
      <div className="min-h-screen bg-background">
        <AppHeader />
        <AppTabs />
        {error && (
          <div className="border-b bg-destructive/10 px-4 py-2 text-xs text-destructive">
            Session error: {error}
          </div>
        )}
        {!session && !error && (
          <div className="border-b bg-muted px-4 py-2 text-xs text-muted-foreground">
            Loading company profile…
          </div>
        )}
        <main className="mx-auto max-w-7xl px-4 py-6">{children ?? <Outlet />}</main>
      </div>
    </TabsProvider>
  );
}

function AppHeader() {
  const { currentUser } = useSession();
  const isAdmin = !!currentUser?.isAdministrator;
  const nav = isAdmin ? ADMIN_NAV : USER_NAV;
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b bg-card/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-1 px-2 sm:gap-3 sm:px-4">
        <Link
          to={isAdmin ? "/admin/dashboard" : "/support"}
          aria-label="ServiceHub2 home"
          className="flex shrink-0 items-center gap-2 text-base font-semibold text-foreground"
        >
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary text-xs text-primary-foreground">
            S2
          </span>
          <span className="hidden lg:inline">ServiceHub2</span>
        </Link>

        {/* Persistent navigation beside S2 — visible on phones too. */}
        <nav
          aria-label="Main"
          data-testid="primary-nav"
          className="flex min-w-0 flex-1 items-center gap-0.5 text-[12px] sm:gap-1 sm:text-sm"
        >
          {nav.map((item) => (
            <NavLink key={item.to} item={item} />
          ))}
          <div className="hidden md:block">
            <ToolsMenu isAdmin={isAdmin} />
          </div>
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Link
            to="/jobs/new"
            className="hidden min-h-9 items-center rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 md:inline-flex"
          >
            + New Service Job
          </Link>
          <div className="hidden md:block">
            <UserMenu user={currentUser} />
          </div>
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Open menu"
            aria-expanded={mobileOpen}
            className="grid h-10 w-10 place-items-center rounded-md border md:hidden"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M3 6h18M3 12h18M3 18h18" />
            </svg>
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="border-t bg-card md:hidden">
          <nav className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-3 text-sm">
            <Link
              to="/jobs/new"
              onClick={() => setMobileOpen(false)}
              className="mb-1 rounded-md bg-primary px-3 py-2 text-center text-sm font-semibold text-primary-foreground"
            >
              + New Service Job
            </Link>
            <MobileProfile onDone={() => setMobileOpen(false)} />
            {isAdmin && (
              <>
                <div className="mt-2 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Admin tools
                </div>
                {ADMIN_TOOLS.map((item) => (
                  <NavLink key={item.to} item={item} onClick={() => setMobileOpen(false)} />
                ))}
              </>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}

function NavLink({ item, onClick }: { item: NavItem; onClick?: () => void }) {
  return (
    <Link
      to={item.to}
      onClick={onClick}
      activeOptions={{ exact: item.to === "/" }}
      activeProps={{ className: "active" }}
      className="inline-flex min-h-10 items-center whitespace-nowrap rounded-md px-1.5 font-medium sm:px-3 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [&.active]:bg-primary/10 [&.active]:text-primary"
    >
      {item.label}
    </Link>
  );
}

function MobileProfile({ onDone }: { onDone: () => void }) {
  const { session, currentUser, signOut } = useSession();
  const name = currentUser?.displayName || session?.email || "User";
  return (
    <div className="mb-1 rounded-md border px-3 py-2 text-xs">
      <div className="font-semibold text-foreground">{name}</div>
      <div className="text-muted-foreground">
        {session?.companyName || "—"} · {session?.tenantCode || "—"}
        {currentUser?.isAdministrator ? " · Administrator" : ""}
      </div>
      <button
        type="button"
        onClick={() => {
          onDone();
          signOut();
        }}
        className="mt-2 min-h-10 w-full rounded-md border px-3 text-left text-sm text-foreground hover:bg-accent"
      >
        Sign out
      </button>
    </div>
  );
}

function ToolsMenu({ isAdmin }: { isAdmin: boolean }) {
  const items: NavItem[] = isAdmin ? ADMIN_TOOLS : [{ to: "/jobs/new", label: "New Service Job" }];
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        Tools
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-md border bg-popover shadow-lg">
          {items.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              onClick={() => setOpen(false)}
              className="block px-3 py-2 text-sm text-foreground hover:bg-accent"
            >
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function UserMenu({ user }: { user: CurrentUserInfo | null }) {
  const { session, signOut } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const name = user?.displayName || session?.email || "User";
  const initials =
    name
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase() ?? "")
      .join("") || "U";
  const isAdmin = !!user?.isAdministrator;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-md border bg-background px-2 py-1 text-xs hover:bg-accent"
      >
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
          {initials}
        </span>
        <span className="hidden text-left leading-tight sm:flex sm:flex-col">
          <span className="font-medium text-foreground">{name}</span>
          <span className="text-muted-foreground">
            {session?.companyName || session?.tenantCode || "—"}
          </span>
        </span>
        {isAdmin && (
          <span className="hidden rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary sm:inline">
            Admin
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-64 overflow-hidden rounded-md border bg-popover shadow-lg">
          <div className="border-b px-3 py-2 text-xs">
            <div className="font-semibold text-foreground">{name}</div>
            <div className="text-muted-foreground">{session?.email || user?.email || "—"}</div>
            <div className="mt-1 text-muted-foreground">
              {session?.companyName || "—"} · {session?.tenantCode || "—"}
            </div>
            <div className="mt-1">
              {isAdmin ? (
                <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                  Administrator
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Normal user
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              signOut();
            }}
            className="block w-full px-3 py-2 text-left text-sm text-foreground hover:bg-accent"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function TopBrand() {
  return (
    <header className="border-b bg-card">
      <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-3 text-base font-semibold text-foreground">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
          S2
        </span>
        ServiceHub2
      </div>
    </header>
  );
}
