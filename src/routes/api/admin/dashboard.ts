// GET /api/admin/dashboard — Owner/Admin operational KPIs for the tenant.
//
// Numbers:
//   jobsToday          — non-deleted jobs created today (Asia/Kuala_Lumpur)
//   pendingApproval    — non-deleted, status = Pending Approval
//   waitingCustomer    — non-deleted, status = Waiting Customer
//   waitingVendor      — non-deleted, status = Waiting Vendor
//   dueSoonCustomers   — DISTINCT customers with ANY Due Soon entitlement
//   overdueCustomers   — DISTINCT customers with ANY Overdue entitlement
//   userWorkload       — active workload per assignee (open, non-completed)
//
// Tenant-scoped. Admin-only.

import { createFileRoute } from "@tanstack/react-router";

function malaysiaTodayUtcRange(): { fromIso: string; toIso: string } {
  const OFFSET_MS = 8 * 60 * 60 * 1000;
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

export const Route = createFileRoute("/api/admin/dashboard")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { requireAdministrator, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        try {
          const user = await requireAdministrator(request);
          const { fromIso, toIso } = malaysiaTodayUtcRange();

          const jobs = () =>
            supabaseAdmin
              .from("service_jobs")
              .select("id", { count: "exact", head: true })
              .eq("tenant_code", user.tenantCode)
              .eq("is_deleted", false);

          const [rToday, rApproval, rWaitCust, rWaitVend] = await Promise.all([
            jobs().gte("created_at", fromIso).lt("created_at", toIso),
            jobs().eq("status", "Pending Approval"),
            jobs().eq("status", "Waiting Customer"),
            jobs().eq("status", "Waiting Vendor"),
          ]);
          for (const r of [rToday, rApproval, rWaitCust, rWaitVend]) {
            if (r.error) throw r.error;
          }

          // Distinct customer counts by entitlement status — SHARED read model,
          // the same module that powers the Due Soon / Overdue list pages, so a
          // KPI can never disagree with the page it links to.
          // Status is derived from expiry_date against today's Malaysia date
          // (never from the cached snapshot status), so a KPI can never
          // disagree with the list page it links to.
          const ent = await import("@/lib/qne/entitlements/query.server");
          const clock = await ent.entitlementClock(user.tenantCode);
          const candidates = ent.deriveRows(
            await ent.loadCandidateRecords(user.tenantCode),
            clock,
          );
          const dueSoonCustomers = ent.totalsFromRecords(
            candidates.filter((r) => r.subscription_status === "Due Soon"),
          ).customers;
          const overdueCustomers = ent.totalsFromRecords(
            candidates.filter((r) => r.subscription_status === "Overdue"),
          ).customers;


          // User workload — group by assignee for active jobs.
          const ACTIVE = [
            "Assigned",
            "In Progress",
            "Waiting Customer",
            "Waiting Vendor",
          ];
          const { data: wl, error: wlErr } = await supabaseAdmin
            .from("service_jobs")
            .select("assigned_user_id, assigned_user_name_snapshot, status")
            .eq("tenant_code", user.tenantCode)
            .eq("is_deleted", false)
            .in("status", ACTIVE)
            .not("assigned_user_id", "is", null)
            .limit(2000);
          if (wlErr) throw wlErr;
          const workloadMap = new Map<
            string,
            { user_id: string; name: string; total: number; inProgress: number; waiting: number }
          >();
          for (const r of wl ?? []) {
            const key = String(r.assigned_user_id);
            const name = r.assigned_user_name_snapshot ?? key;
            const row =
              workloadMap.get(key) ??
              { user_id: key, name, total: 0, inProgress: 0, waiting: 0 };
            row.total++;
            if (r.status === "In Progress") row.inProgress++;
            if (r.status === "Waiting Customer" || r.status === "Waiting Vendor")
              row.waiting++;
            workloadMap.set(key, row);
          }
          const userWorkload = Array.from(workloadMap.values()).sort(
            (a, b) => b.total - a.total,
          );

          // Cancellation decisions are NOT Job approvals: the Job keeps its
          // operational status while a separate request awaits an Owner/Admin
          // decision. Counted through the shared read model so the KPI, the
          // decision queue and the Pending Queue flag always agree.
          const { countPendingCancellationRequests } = await import(
            "@/lib/qne/service-jobs/cancellation.server"
          );
          const cancellationRequests = await countPendingCancellationRequests(
            user.tenantCode,
          );

          return Response.json({
            summary: {
              jobsToday: rToday.count ?? 0,
              pendingApproval: rApproval.count ?? 0,
              cancellationRequests,
              waitingCustomer: rWaitCust.count ?? 0,
              waitingVendor: rWaitVend.count ?? 0,
              dueSoonCustomers,
              overdueCustomers,
            },
            userWorkload,
            generatedAt: new Date().toISOString(),
          });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[admin/dashboard] failed", err);
          return Response.json(
            { error: err instanceof Error ? err.message : "Failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});
