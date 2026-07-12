import { createFileRoute } from "@tanstack/react-router";

import { useSession } from "@/lib/qne/session-context";

export const Route = createFileRoute("/support")({
  component: SupportHome,
});

function SupportHome() {
  const { session, currentUser } = useSession();
  const name = currentUser?.displayName || session?.email || "there";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Welcome, {name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {session?.companyName || "—"} · Support workspace
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <ComingSoonCard title="My Jobs" description="Jobs assigned to you." />
        <ComingSoonCard title="Pending" description="Draft jobs awaiting approval." />
        <ComingSoonCard title="Calendar" description="Upcoming visits and follow-ups." />
      </div>

      <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        Your daily workspace will appear here as job features ship in Phase 1.
      </p>
    </div>
  );
}

function ComingSoonCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-start justify-between">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Coming soon
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </div>
  );
}
