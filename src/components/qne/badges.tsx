// Shared Status & Priority badges used across Workspace, Pending Queue,
// Job Detail and Dashboards. Keep tones consistent tenant-wide.

import type { ReactNode } from "react";

export type JobStatus =
  | "Draft"
  | "Pending Approval"
  | "Open"
  | "Assigned"
  | "In Progress"
  | "Waiting Customer"
  | "Waiting Vendor"
  | "Completed"
  | "Cancelled"
  | string;

export type JobPriority = "High" | "Medium" | "Low" | string;

const STATUS_TONE: Record<string, string> = {
  Draft: "bg-slate-50 text-slate-700 ring-slate-200",
  "Pending Approval": "bg-amber-50 text-amber-900 ring-amber-300",
  Open: "bg-sky-50 text-sky-900 ring-sky-200",
  Assigned: "bg-blue-50 text-blue-800 ring-blue-200",
  "In Progress": "bg-indigo-50 text-indigo-800 ring-indigo-200",
  "Waiting Customer": "bg-orange-50 text-orange-900 ring-orange-200",
  "Waiting Vendor": "bg-purple-50 text-purple-800 ring-purple-200",
  Completed: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  Cancelled: "bg-rose-50 text-rose-800 ring-rose-200",
};

const PRIORITY_TONE: Record<string, string> = {
  High: "bg-red-50 text-red-700 ring-red-200",
  Medium: "bg-amber-50 text-amber-800 ring-amber-200",
  Low: "bg-slate-50 text-slate-600 ring-slate-200",
};

function Chip({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 " +
        className
      }
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: JobStatus }) {
  const cls = STATUS_TONE[status] ?? "bg-slate-100 text-slate-600 ring-slate-200";
  return <Chip className={cls}>{status || "—"}</Chip>;
}

export function PriorityBadge({ priority }: { priority: JobPriority }) {
  const cls = PRIORITY_TONE[priority] ?? "bg-slate-50 text-slate-600 ring-slate-200";
  return <Chip className={cls}>{priority || "—"}</Chip>;
}

export function EntitlementBadge({ status }: { status: string | null | undefined }) {
  const s = (status ?? "").toLowerCase();
  const cls =
    s === "active"
      ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
      : s === "due soon"
        ? "bg-amber-50 text-amber-800 ring-amber-200"
        : s === "overdue" || s === "expired"
          ? "bg-rose-50 text-rose-800 ring-rose-200"
          : "bg-slate-50 text-slate-600 ring-slate-200";
  return <Chip className={cls}>{status || "unknown"}</Chip>;
}

/** Small skeleton block for loading states. */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={"animate-pulse rounded-md bg-muted/60 " + className}
      aria-hidden="true"
    />
  );
}
