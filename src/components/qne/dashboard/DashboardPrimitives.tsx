import { Link } from "@tanstack/react-router";
import { ArrowRight, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export type DashboardTone =
  | "blue"
  | "cyan"
  | "emerald"
  | "amber"
  | "orange"
  | "violet"
  | "rose"
  | "navy";

const toneClasses: Record<DashboardTone, { card: string; icon: string; bar: string }> = {
  blue: { card: "bg-dashboard-blue-soft border-dashboard-blue/20", icon: "bg-dashboard-blue text-dashboard-on-accent", bar: "bg-dashboard-blue" },
  cyan: { card: "bg-dashboard-cyan-soft border-dashboard-cyan/20", icon: "bg-dashboard-cyan text-dashboard-on-accent", bar: "bg-dashboard-cyan" },
  emerald: { card: "bg-dashboard-emerald-soft border-dashboard-emerald/20", icon: "bg-dashboard-emerald text-dashboard-on-accent", bar: "bg-dashboard-emerald" },
  amber: { card: "bg-dashboard-amber-soft border-dashboard-amber/25", icon: "bg-dashboard-amber text-dashboard-ink", bar: "bg-dashboard-amber" },
  orange: { card: "bg-dashboard-orange-soft border-dashboard-orange/20", icon: "bg-dashboard-orange text-dashboard-on-accent", bar: "bg-dashboard-orange" },
  violet: { card: "bg-dashboard-violet-soft border-dashboard-violet/20", icon: "bg-dashboard-violet text-dashboard-on-accent", bar: "bg-dashboard-violet" },
  rose: { card: "bg-dashboard-rose-soft border-dashboard-rose/20", icon: "bg-dashboard-rose text-dashboard-on-accent", bar: "bg-dashboard-rose" },
  navy: { card: "bg-dashboard-navy-soft border-dashboard-navy/20", icon: "bg-dashboard-navy text-dashboard-on-accent", bar: "bg-dashboard-navy" },
};

export function DashboardHero({ eyebrow, title, subtitle, meta, actions }: { eyebrow: string; title: string; subtitle: string; meta: ReactNode; actions: ReactNode }) {
  return (
    <header className="dashboard-enter relative overflow-hidden rounded-lg border border-dashboard-blue/20 bg-dashboard-hero p-4 shadow-sm sm:p-6">
      <div className="relative grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wide text-dashboard-blue">{eyebrow}</p>
          <h1 className="mt-2 break-words text-2xl font-bold text-dashboard-ink sm:text-3xl">{title}</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{subtitle}</p>
          <div className="mt-3 text-xs font-medium text-dashboard-navy">{meta}</div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">{actions}</div>
      </div>
    </header>
  );
}

export function DashboardAction({ to, label, icon: Icon, primary = false }: { to: string; label: string; icon: LucideIcon; primary?: boolean }) {
  return (
    <Link to={to} className={primary
      ? "inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-dashboard-navy px-3 text-sm font-semibold text-dashboard-on-accent shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      : "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border bg-card/90 px-3 text-sm font-semibold text-foreground shadow-sm transition hover:-translate-y-0.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"}>
      <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
      <span>{label}</span>
    </Link>
  );
}

export function DashboardSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="min-w-0 space-y-3">
      <div className="min-w-0">
        <h2 className="text-base font-bold text-dashboard-ink">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function DashboardStatCard({ label, value, meaning, icon: Icon, tone, onClick, active = false }: { label: string; value: number | string; meaning?: string; icon: LucideIcon; tone: DashboardTone; onClick?: () => void; active?: boolean }) {
  const colors = toneClasses[tone];
  const body = (
    <div className={`relative h-full min-h-[132px] overflow-hidden rounded-lg border p-3 text-left shadow-sm transition sm:p-4 ${colors.card} ${active ? "ring-2 ring-dashboard-blue ring-offset-2" : ""}`}>
      <div className={`grid h-9 w-9 place-items-center rounded-md shadow-sm ${colors.icon}`}><Icon aria-hidden="true" className="h-4 w-4" /></div>
      <div className="mt-3 flex items-end justify-between gap-2">
        <div className="min-w-0">
          <div className="text-2xl font-bold text-dashboard-ink">{value}</div>
          <div className="mt-0.5 text-xs font-bold text-dashboard-ink">{label}</div>
        </div>
        {onClick ? <ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" /> : null}
      </div>
      {meaning ? <p className="mt-1 line-clamp-1 text-[11px] text-muted-foreground">{meaning}</p> : null}
      <span className={`absolute inset-x-0 bottom-0 h-1 ${colors.bar}`} />
    </div>
  );
  if (!onClick) return body;
  return <button type="button" onClick={onClick} aria-pressed={active} className="dashboard-card block min-h-11 w-full rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">{body}</button>;
}

export function DashboardProgress({ value, max, tone = "blue", label }: { value: number; max: number; tone?: DashboardTone; label: string }) {
  const width = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return <div aria-label={`${label}: ${value} of ${max}`} className="h-1.5 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${toneClasses[tone].bar}`} style={{ width: `${width}%` }} /></div>;
}

export function DashboardSkeletonGrid({ count = 4 }: { count?: number }) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: count }, (_, i) => <div key={i} className="h-[132px] animate-pulse rounded-lg border bg-muted/60 motion-reduce:animate-none" />)}</div>;
}