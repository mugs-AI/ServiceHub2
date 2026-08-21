// GET /api/workspace/jobs/pending — Pending Queue for the current tenant.
// Includes: Pending Approval, Open+Unassigned, Assigned (not started),
// Waiting Customer, Waiting Vendor. Excludes soft-deleted jobs.
// Sorted by: priority (High > Medium > Low), then oldest created_at.
// Filters (all optional): queueType, customerCode, jobNumber, priority,
// technician (or "__unassigned__"), from, to, status, q.

import { createFileRoute } from "@tanstack/react-router";

type QueueType =
  | "draft"
  | "pending_approval"
  | "open_unassigned"
  | "assigned_not_started"
  | "waiting_customer"
  | "waiting_vendor"
  | "cancellation_requested";

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
              "id, job_number, customer_code_snapshot, customer_name_snapshot, subject, status, priority, source, requires_approval, approval_reason, subscription_category_snapshot, stock_code_snapshot, entitlement_status_snapshot, entitlement_expiry_snapshot, assigned_user_id, assigned_user_name_snapshot, assigned_at, started_at, created_at",
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
