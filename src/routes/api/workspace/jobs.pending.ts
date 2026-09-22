// GET /api/workspace/jobs/pending — Pending Queue for the current tenant.
// Includes: Pending Approval, Open+Unassigned, Assigned (not started),
// Waiting Customer, Waiting Vendor. Excludes soft-deleted jobs.
// Sorted by: priority (High > Medium > Low), then oldest created_at.
// Filters (all optional): queueType, customerCode, jobNumber, priority,
// technician (or "__unassigned__"), from, to, status, q.

import { createFileRoute } from "@tanstack/react-router";
import {
  ADMIN_DASHBOARD_QUEUE_KEYS,
  isAdminDashboardQueueKey,
  statusesForAdminQueue,
} from "@/lib/qne/dashboard/admin-scope";

type QueueType =
  | "draft"
  | "pending_approval"
  | "open_unassigned"
  | "assigned_not_started"
  | "waiting_customer"
  | "waiting_vendor"
  | "cancellation_requested"
  // WP3A queue categories (stable URL keys for dashboard deep links).
  | "completed_followup"
  | "completed"
  // WP3B outcome categories (same stable-key rule).
  | "follow_up_open"
  | "reopen_pending"
  | "resolved";
  | "jobs_today"
  | "active"
  | "in_progress"
  | "resolved_today"
  | "legacy_completed";

function trim(v: unknown, max = 200): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

export const Route = createFileRoute("/api/workspace/jobs/pending")({
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
          const sp = new URL(request.url).searchParams;
          const queueType = trim(sp.get("queueType"), 40) as QueueType | null;
          const validQueueTypes = new Set([
            "draft", "pending_approval", "open_unassigned", "assigned_not_started",
            "waiting_customer", "waiting_vendor", "cancellation_requested",
            "completed_followup", "completed", "follow_up_open", "reopen_pending", "resolved",
            ...ADMIN_DASHBOARD_QUEUE_KEYS,
          ]);
          if (queueType && !validQueueTypes.has(queueType)) {
            return Response.json({ error: "Invalid queue scope." }, { status: 400 });
          }
          const customerCode = trim(sp.get("customerCode"), 100);
          const jobNumber = trim(sp.get("jobNumber"), 40);
          const priority = trim(sp.get("priority"), 20);
          const technician = trim(sp.get("technician"), 100);
          const from = trim(sp.get("from"), 40);
          const to = trim(sp.get("to"), 40);
          const q = trim(sp.get("q"), 100);
          // Run 2 — "Pending from My Team": exclude jobs assigned to caller.
          const excludeMe =
            sp.get("excludeMe") === "1" || sp.get("excludeMe") === "true";
          const page = Math.max(Number(sp.get("page") ?? 1) || 1, 1);
          const pageSize = Math.min(
            Math.max(Number(sp.get("pageSize") ?? 50) || 50, 1),
            200,
          );

          let query = supabaseAdmin
            .from("service_jobs")
            .select(
              "id, job_number, customer_code_snapshot, customer_name_snapshot, subject, status, priority, source, requires_approval, approval_reason, subscription_category_snapshot, stock_code_snapshot, entitlement_status_snapshot, entitlement_expiry_snapshot, assigned_user_id, assigned_user_name_snapshot, assigned_at, started_at, created_at, completed_at, completion_cycle",
              { count: "exact" },
            )
            .eq("tenant_code", user.tenantCode)
            .eq("is_deleted", false);

          // Queue-type predicate.
          if (queueType === "draft") {
            query = query.eq("status", "Draft");
          } else if (queueType === "pending_approval") {
            query = query.eq("status", "Pending Approval");
          } else if (queueType === "open_unassigned") {
            query = query.eq("status", "Open").is("assigned_user_id", null);
          } else if (queueType === "assigned_not_started") {
            query = query.eq("status", "Assigned");
          } else if (queueType === "waiting_customer") {
            query = query.eq("status", "Waiting Customer");
          } else if (queueType === "waiting_vendor") {
            query = query.eq("status", "Waiting Vendor");
          } else if (queueType && isAdminDashboardQueueKey(queueType)) {
            const statuses = statusesForAdminQueue(queueType);
            if (statuses) query = query.in("status", [...statuses]);
            if (queueType === "jobs_today") {
              const offset = 8 * 60 * 60 * 1000;
              const nowMy = new Date(Date.now() + offset);
              const start = Date.UTC(nowMy.getUTCFullYear(), nowMy.getUTCMonth(), nowMy.getUTCDate()) - offset;
              query = query.gte("created_at", new Date(start).toISOString()).lt("created_at", new Date(start + 86_400_000).toISOString());
            }
          } else if (
            queueType === "completed" ||
            queueType === "completed_followup" ||
            queueType === "follow_up_open" ||
            queueType === "reopen_pending" ||
            queueType === "resolved"
          ) {
            // WP3A — Completed lists. is_deleted = false is already applied
            // above, so a soft-deleted Job can never appear here.
            query = query.eq("status", "Completed");
          } else {
            // All pending statuses (non-terminal, non-In-Progress, non-deleted).
            query = query.in("status", [
              "Draft",
              "Pending Approval",
              "Open",
              "Assigned",
              "Waiting Customer",
              "Waiting Vendor",
            ]);
          }

          if (customerCode) query = query.eq("customer_code_snapshot", customerCode);
          if (jobNumber) query = query.ilike("job_number", `%${jobNumber}%`);
          if (priority) query = query.eq("priority", priority);
          if (technician) {
            if (technician === "__unassigned__") query = query.is("assigned_user_id", null);
            else query = query.eq("assigned_user_id", technician);
          }
          if (excludeMe) {
            const me = user.diagnostics.matchedN3UserId;
            if (me) {
              // Exclude jobs whose assignee is me. Unassigned rows remain.
              query = query.or(
                `assigned_user_id.is.null,assigned_user_id.neq.${me}`,
              );
            }
          }
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

          // Sort in memory: priority weight then oldest waiting.
          const weight: Record<string, number> = { High: 0, Medium: 1, Low: 2 };
          let rows = (data ?? []).slice().sort((a, b) => {
            const pw = (weight[a.priority] ?? 3) - (weight[b.priority] ?? 3);
            if (pw !== 0) return pw;
            return a.created_at.localeCompare(b.created_at);
          });

          // WP3A — Completed lists read newest completion first.
          if (
            queueType === "completed" ||
            queueType === "completed_followup" ||
            queueType === "follow_up_open" ||
            queueType === "reopen_pending" ||
             queueType === "resolved" || queueType === "resolved_today" || queueType === "legacy_completed"
          ) {
            rows = rows
              .slice()
              .sort((a, b) =>
                String(b.completed_at ?? b.created_at).localeCompare(
                  String(a.completed_at ?? a.created_at),
                ),
              );
          }

          // WP3A — "Completed Follow-up": only evidence belonging to the Job's
          // CURRENT completion cycle counts, so an earlier cycle's follow-up
          // flag can never leak into a later cycle.
          let followUpOnly = false;

          // WP3B — outcome lists (Follow-up Open / Reopen Pending / Resolved).
          // The SAME shared derivation the dashboard cards count with decides
          // membership here, so a card count and its list always agree.
          // Legacy Completed jobs without modern evidence are never included.
          if (
            queueType === "follow_up_open" ||
            queueType === "reopen_pending" ||
            queueType === "resolved" || queueType === "resolved_today" || queueType === "legacy_completed"
          ) {
            followUpOnly = true;
            const { loadCompletionOutcomes } = await import("@/lib/qne/service-jobs/wp3b.server");
            const { outcomesForQueue } = await import("@/lib/qne/dashboard/followup-scope");
            const wanted = new Set<string>(
              queueType === "legacy_completed" ? ["legacy_unknown"] : outcomesForQueue("resolved"),
            );
            const outcomeRows = await loadCompletionOutcomes(user.tenantCode);
            const keep = new Set(
              outcomeRows.filter((r) => {
                if (!wanted.has(r.outcome)) return false;
                if (queueType !== "resolved_today") return true;
                const resolvedAt = r.outcome === "resolved_after_follow_up" ? r.followup?.resolved_at : r.completed_at;
                const offset = 8 * 60 * 60 * 1000;
                const nowMy = new Date(Date.now() + offset);
                const start = Date.UTC(nowMy.getUTCFullYear(), nowMy.getUTCMonth(), nowMy.getUTCDate()) - offset;
                return !!resolvedAt && resolvedAt >= new Date(start).toISOString() && resolvedAt < new Date(start + 86_400_000).toISOString();
              }).map((r) => r.id),
            );
            rows = rows.filter((r) => keep.has(r.id));
          }

          if (queueType === "completed_followup") {
            followUpOnly = true;
            const ids = rows.map((r) => r.id);
            if (ids.length === 0) {
              rows = [];
            } else {
              const { data: evidence, error: evErr } = await supabaseAdmin
                .from("service_job_completions")
                .select("service_job_id, completion_cycle, follow_up_required")
                .eq("tenant_code", user.tenantCode)
                .in("service_job_id", ids);
              if (evErr) throw evErr;
              const { followUpJobIds } = await import(
                "@/lib/qne/service-jobs/wp3a-queues"
              );
              const keep = followUpJobIds(rows, evidence ?? []);
              rows = rows.filter((r) => keep.has(r.id));
            }
          }

          // Shared cancellation-state awareness. Every authenticated
          // same-tenant user may know that a Job they can already see carries
          // an active cancellation request; no request detail is ever exposed
          // here. One query per result set, never per row.
          const { pendingCancellationJobIds } = await import(
            "@/lib/qne/service-jobs/cancellation.server"
          );
          const cancellationOnly = queueType === "cancellation_requested";
          let flagged: Set<string>;
          let total: number;
          if (cancellationOnly) {
            // Filter before pagination and count so `total` means "matching
            // cancellation-requested Jobs".
            flagged = await pendingCancellationJobIds(
              user.tenantCode,
              rows.map((r) => r.id),
            );
            rows = rows.filter((r) => flagged.has(r.id));
            total = rows.length;
          } else if (followUpOnly) {
            // Filtered above, so the count must come from the filtered rows.
            total = rows.length;
            flagged = new Set();
          } else {
            total = count ?? rows.length;
            flagged = new Set();
          }
          const paged = rows.slice((page - 1) * pageSize, page * pageSize);
          if (!cancellationOnly && paged.length > 0) {
            flagged = await pendingCancellationJobIds(
              user.tenantCode,
              paged.map((r) => r.id),
            );
          }

          const jobs = paged.map((r) => ({
            ...r,
            has_active_cancellation_request: flagged.has(r.id),
          }));

          return Response.json({
            jobs,
            total,
            page,
            pageSize,
          });
        } catch (err) {

          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[workspace/jobs/pending] failed", err);
          return Response.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
        }
      },
    },
  },
});
