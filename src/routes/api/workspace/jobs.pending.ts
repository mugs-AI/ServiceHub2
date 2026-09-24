// GET /api/workspace/jobs/pending — Pending Queue for the current tenant.
// Default (All Pending): Draft, Pending Approval, Open, Assigned, In Progress,
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
import {
  ALL_JOB_STATUSES,
  ALL_PENDING_STATUSES,
  malaysiaDayRangeToUtc,
} from "@/lib/qne/dashboard/pending-queue-groups";

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
  | "resolved"
  // WP3C — Admin Dashboard deep-link scopes (bounded, server-validated).
  | "jobs_today"
  | "active"
  | "in_progress"
  | "resolved_today"
  | "legacy_completed"
  | "completed_current_cycle"
  // WP3C-2 — consolidated groups.
  | "waiting"
  | "cancelled"
  | "all_jobs";

function trim(v: unknown, max = 200): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

/** [start, end) as ISO strings for today's Malaysia calendar day (UTC+8). */
function malaysiaTodayUtcRange(): { fromIso: string; toIso: string } {
  const OFFSET_MS = 8 * 60 * 60 * 1000;
  const nowMy = new Date(Date.now() + OFFSET_MS);
  const startMs =
    Date.UTC(nowMy.getUTCFullYear(), nowMy.getUTCMonth(), nowMy.getUTCDate()) - OFFSET_MS;
  return {
    fromIso: new Date(startMs).toISOString(),
    toIso: new Date(startMs + 24 * 60 * 60 * 1000).toISOString(),
  };
}

export const Route = createFileRoute("/api/workspace/jobs/pending")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { requireAuthenticatedN3User, guardResponse } =
          await import("@/lib/qne/session/current-user.server");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        try {
          const user = await requireAuthenticatedN3User(request);
          const sp = new URL(request.url).searchParams;
          const queueType = trim(sp.get("queueType"), 40) as QueueType | null;
          const validQueueTypes = new Set([
            "draft",
            "pending_approval",
            "open_unassigned",
            "assigned_not_started",
            "waiting_customer",
            "waiting_vendor",
            "cancellation_requested",
            "completed_followup",
            "completed",
            "follow_up_open",
            "reopen_pending",
            "resolved",
            "waiting",
            "cancelled",
            "all_jobs",
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
          // WP3C-2 — server-backed Completed date range (Malaysia days).
          const dayRe = /^\d{4}-\d{2}-\d{2}$/;
          const completedFromDay = trim(sp.get("completedFrom"), 10);
          const completedToDay = trim(sp.get("completedTo"), 10);
          if (
            (completedFromDay && !dayRe.test(completedFromDay)) ||
            (completedToDay && !dayRe.test(completedToDay))
          ) {
            return Response.json({ error: "Invalid completed date range." }, { status: 400 });
          }
          // Run 2 — "Pending from My Team": exclude jobs assigned to caller.
          const excludeMe = sp.get("excludeMe") === "1" || sp.get("excludeMe") === "true";
          const page = Math.max(Number(sp.get("page") ?? 1) || 1, 1);
          const pageSize = Math.min(Math.max(Number(sp.get("pageSize") ?? 50) || 50, 1), 200);

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
          } else if (queueType === "waiting") {
            query = query.in("status", ["Waiting Customer", "Waiting Vendor"]);
          } else if (queueType === "cancelled") {
            query = query.eq("status", "Cancelled");
          } else if (queueType === "all_jobs") {
            query = query.in("status", [...ALL_JOB_STATUSES]);
          } else if (queueType && isAdminDashboardQueueKey(queueType)) {
            const statuses = statusesForAdminQueue(queueType);
            if (statuses) query = query.in("status", [...statuses]);
            if (queueType === "jobs_today") {
              const { fromIso, toIso } = malaysiaTodayUtcRange();
              query = query.gte("created_at", fromIso).lt("created_at", toIso);
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
            // WP3C-2 — All Pending: every non-terminal, non-deleted status,
            // In Progress included. A pending cancellation is only an overlay.
            query = query.in("status", [...ALL_PENDING_STATUSES]);
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
              query = query.or(`assigned_user_id.is.null,assigned_user_id.neq.${me}`);
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

          const isCompletedStatusList =
            queueType === "completed" ||
            queueType === "completed_followup" ||
            queueType === "follow_up_open" ||
            queueType === "reopen_pending" ||
            queueType === "resolved" ||
            queueType === "resolved_today" ||
            queueType === "legacy_completed" ||
            queueType === "completed_current_cycle";
          if (isCompletedStatusList && (completedFromDay || completedToDay)) {
            const { fromIso: cf, toIso: ct } = malaysiaDayRangeToUtc(
              completedFromDay,
              completedToDay,
            );
            if (cf) query = query.gte("completed_at", cf);
            if (ct) query = query.lt("completed_at", ct);
          }

          // WP3C-2 — plain status lists that can grow large are paginated in
          // the database, never loaded whole.
          const dbPaged =
            queueType === "completed" || queueType === "cancelled" || queueType === "all_jobs";
          if (dbPaged) {
            const sortCol = queueType === "all_jobs" ? "created_at" : "completed_at";
            const {
              data: pageRows,
              error: pageErr,
              count: pageCount,
            } = await query
              .order(sortCol, { ascending: false, nullsFirst: false })
              .order("created_at", { ascending: false })
              .range((page - 1) * pageSize, page * pageSize - 1);
            if (pageErr) throw pageErr;
            const { pendingCancellationJobIds: flaggedIds } =
              await import("@/lib/qne/service-jobs/cancellation.server");
            const list = pageRows ?? [];
            const marks =
              list.length > 0
                ? await flaggedIds(
                    user.tenantCode,
                    list.map((r) => r.id),
                  )
                : new Set<string>();
            // WP3C-2A — Completed page: derive the shared WP3B outcome for
            // this page's Job IDs only (never the whole tenant). Cancelled
            // and All Jobs rows are not decorated.
            let pageOutcomes = new Map<string, string>();
            if (queueType === "completed" && list.length > 0) {
              const { loadCompletionOutcomes: loadPageOutcomes } =
                await import("@/lib/qne/service-jobs/wp3b.server");
              const pageIds = list.map((r) => r.id);
              try {
                const rows = await loadPageOutcomes(user.tenantCode, pageIds);
                pageOutcomes = new Map(rows.map((r) => [r.id, r.outcome as string]));
              } catch (e) {
                console.warn("[jobs.pending] page outcome load failed", e);
              }
            }
            return Response.json({
              jobs: list.map((r) => ({
                ...r,
                has_active_cancellation_request: marks.has(r.id),
                ...(queueType === "completed" ? { outcome: pageOutcomes.get(r.id) ?? null } : {}),
              })),
              total: pageCount ?? list.length,
              page,
              pageSize,
            });
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

          // WP3A/WP3C — Completed outcome lists read newest completion first
          // (plain "completed" is already DB-ordered and returned above).
          if (isCompletedStatusList) {
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
          // Outcome indicator (Resolved / Follow-up Open / Reopen Pending /
          // Legacy) for rows decided by the shared outcome read model.
          let outcomeById = new Map<string, string>();

          // WP3B/WP3C — outcome lists. The SAME shared derivation the dashboard
          // cards count with decides membership here, so a card count and the
          // list it opens always agree. Legacy Completed jobs without modern
          // evidence only ever appear in the explicit legacy scope.
          // completed_followup is kept only as a stable alias of Follow-up
          // Open: membership is outcome-derived, so a cleared follow-up
          // (Resolved after Follow-up) can never appear as still needing one.
          if (
            queueType === "completed_followup" ||
            queueType === "follow_up_open" ||
            queueType === "reopen_pending" ||
            queueType === "resolved" ||
            queueType === "resolved_today" ||
            queueType === "legacy_completed" ||
            queueType === "completed_current_cycle"
          ) {
            followUpOnly = true;
            const { loadCompletionOutcomes } = await import("@/lib/qne/service-jobs/wp3b.server");
            const { outcomesForQueue, matchesWp3bCard } =
              await import("@/lib/qne/dashboard/followup-scope");
            const outcomeRows = await loadCompletionOutcomes(user.tenantCode);
            const { fromIso, toIso } = malaysiaTodayUtcRange();
            const keep = new Set(
              outcomeRows
                .filter((r) => {
                  if (queueType === "legacy_completed") return r.outcome === "legacy_unknown";
                  if (queueType === "completed_current_cycle") {
                    return r.outcome !== "legacy_unknown";
                  }
                  if (queueType === "resolved_today") {
                    return matchesWp3bCard(
                      {
                        outcome: r.outcome,
                        assigned_user_id: r.assigned_user_id,
                        completed_at: r.completed_at,
                        followup_resolved_at: r.followup?.resolved_at ?? null,
                        resolved_by_user_id: r.resolved_by_user_id,
                      },
                      "resolvedToday",
                      { todayFromIso: fromIso, todayToIso: toIso },
                    );
                  }
                  const outcomeKey =
                    queueType === "completed_followup" ? "follow_up_open" : queueType;
                  return (
                    outcomesForQueue(
                      outcomeKey as "follow_up_open" | "reopen_pending" | "resolved",
                    ) as string[]
                  ).includes(r.outcome);
                })
                .map((r) => r.id),
            );
            rows = rows.filter((r) => keep.has(r.id));
            outcomeById = new Map(outcomeRows.map((r) => [r.id, r.outcome as string]));
          }

          // Shared cancellation-state awareness. Every authenticated
          // same-tenant user may know that a Job they can already see carries
          // an active cancellation request; no request detail is ever exposed
          // here. One query per result set, never per row.
          const { pendingCancellationJobIds } =
            await import("@/lib/qne/service-jobs/cancellation.server");
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
            outcome: outcomeById.get(r.id) ?? null,
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
          return Response.json(
            { error: err instanceof Error ? err.message : "Failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});
