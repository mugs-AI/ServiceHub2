// GET /api/dashboard/my-work — Personal technician workload.
// Returns { summary, items, total, page, pageSize } scoped to the caller's
// tenant and to their immutable N3 user identity (matchedN3UserId).
//
// - Tenant is resolved server-side; browser cannot forge tenant.
// - Assignee identity is resolved server-side; browser cannot forge user.
// - Excludes soft-deleted jobs from summary and items.
// - "Completed by Me Today" uses the Malaysia calendar day (Asia/Kuala_Lumpur).

import { createFileRoute } from "@tanstack/react-router";

type Status =
  | "Draft"
  | "Pending Approval"
  | "Open"
  | "Assigned"
  | "In Progress"
  | "Waiting Customer"
  | "Waiting Vendor"
  | "Completed"
  | "Cancelled";

const PENDING_STATUSES: readonly Status[] = [
  "Assigned",
  "In Progress",
  "Waiting Customer",
  "Waiting Vendor",
];

function trim(v: unknown, max = 200): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

function csv(v: unknown): string[] {
  if (typeof v !== "string") return [];
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

/** [start, end) as ISO strings for today's Malaysia calendar day. */
function malaysiaTodayUtcRange(): { fromIso: string; toIso: string } {
  const OFFSET_MS = 8 * 60 * 60 * 1000; // MYT = UTC+8 (no DST)
  const nowMy = new Date(Date.now() + OFFSET_MS);
  const y = nowMy.getUTCFullYear();
  const m = nowMy.getUTCMonth();
  const d = nowMy.getUTCDate();
  const startMs = Date.UTC(y, m, d, 0, 0, 0) - OFFSET_MS;
  return {
    fromIso: new Date(startMs).toISOString(),
    toIso: new Date(startMs + 24 * 60 * 60 * 1000).toISOString(),
  };
}

export const Route = createFileRoute("/api/dashboard/my-work")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { requireAuthenticatedN3User, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        try {
          const user = await requireAuthenticatedN3User(request);
          const myUserId = user.diagnostics.matchedN3UserId;

          // Empty state if we could not match the caller to an N3 user.
          if (!myUserId) {
            return Response.json({
              summary: {
                assignedToMe: 0,
                myInProgress: 0,
                myWaitingCustomer: 0,
                myWaitingVendor: 0,
                myPendingTasks: 0,
                completedByMeToday: 0,
              },
              items: [],
              total: 0,
              page: 1,
              pageSize: 0,
              me: {
                userId: null,
                displayName: user.displayName || user.email || "",
                reason: user.diagnostics.reason,
              },
            });
          }

          const sp = new URL(request.url).searchParams;
          const q = trim(sp.get("q"), 100);
          const statuses = csv(sp.get("statuses"));
          const priorities = csv(sp.get("priorities"));
          const from = trim(sp.get("from"), 40);
          const to = trim(sp.get("to"), 40);
          const includeCompleted =
            sp.get("includeCompleted") === "1" ||
            sp.get("includeCompleted") === "true";
          const page = Math.max(Number(sp.get("page") ?? 1) || 1, 1);
          const pageSize = Math.min(
            Math.max(Number(sp.get("pageSize") ?? 25) || 25, 1),
            100,
          );

          // --- Summary (parallel counts on tenant + assignee scope) ---
          const base = () =>
            supabaseAdmin
              .from("service_jobs")
              .select("id", { count: "exact", head: true })
              .eq("tenant_code", user.tenantCode)
              .eq("is_deleted", false)
              .eq("assigned_user_id", myUserId);

          const { fromIso: mytFrom, toIso: mytTo } = malaysiaTodayUtcRange();

          const [
            rAssigned,
            rInProgress,
            rWaitCust,
            rWaitVend,
            rCompletedToday,
          ] = await Promise.all([
            base().eq("status", "Assigned"),
            base().eq("status", "In Progress"),
            base().eq("status", "Waiting Customer"),
            base().eq("status", "Waiting Vendor"),
            base()
              .eq("status", "Completed")
              .gte("completed_at", mytFrom)
              .lt("completed_at", mytTo),
          ]);

          const errs = [rAssigned, rInProgress, rWaitCust, rWaitVend, rCompletedToday]
            .map((r) => r.error)
            .filter(Boolean);
          if (errs.length) throw errs[0];

          const summary = {
            assignedToMe: rAssigned.count ?? 0,
            myInProgress: rInProgress.count ?? 0,
            myWaitingCustomer: rWaitCust.count ?? 0,
            myWaitingVendor: rWaitVend.count ?? 0,
            myPendingTasks:
              (rAssigned.count ?? 0) +
              (rInProgress.count ?? 0) +
              (rWaitCust.count ?? 0) +
              (rWaitVend.count ?? 0),
            completedByMeToday: rCompletedToday.count ?? 0,
          };

          // --- Items ---
          let query = supabaseAdmin
            .from("service_jobs")
            .select(
              "id, job_number, customer_code_snapshot, customer_name_snapshot, subject, status, priority, source, requires_approval, assigned_user_id, assigned_user_name_snapshot, assigned_at, started_at, completed_at, created_at, updated_at",
              { count: "exact" },
            )
            .eq("tenant_code", user.tenantCode)
            .eq("is_deleted", false)
            .eq("assigned_user_id", myUserId);

          const effectiveStatuses =
            statuses.length > 0
              ? statuses
              : includeCompleted
                ? [...PENDING_STATUSES, "Completed"]
                : PENDING_STATUSES;
          query = query.in("status", effectiveStatuses as string[]);

          if (priorities.length > 0) query = query.in("priority", priorities);
          if (from) query = query.gte("created_at", from);
          if (to) query = query.lte("created_at", to);
          if (q) {
            const like = `%${q.replace(/[%_,()]/g, "")}%`;
            query = query.or(
              `job_number.ilike.${like},subject.ilike.${like},customer_name_snapshot.ilike.${like}`,
            );
          }

          const { data, error, count } = await query;
          if (error) throw error;

          const weight: Record<string, number> = { High: 0, Medium: 1, Low: 2 };
          const rows = (data ?? []).slice().sort((a, b) => {
            const pw = (weight[a.priority] ?? 3) - (weight[b.priority] ?? 3);
            if (pw !== 0) return pw;
            const wa = (a.assigned_at ?? a.created_at) as string;
            const wb = (b.assigned_at ?? b.created_at) as string;
            const w = wa.localeCompare(wb);
            if (w !== 0) return w;
            return a.created_at.localeCompare(b.created_at);
          });
          const paged = rows.slice((page - 1) * pageSize, page * pageSize);

          return Response.json({
            summary,
            items: paged,
            total: count ?? rows.length,
            page,
            pageSize,
            me: {
              userId: myUserId,
              displayName: user.displayName || user.email || "",
              reason: user.diagnostics.reason,
            },
          });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[dashboard/my-work] failed", err);
          return Response.json(
            { error: err instanceof Error ? err.message : "Failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});
