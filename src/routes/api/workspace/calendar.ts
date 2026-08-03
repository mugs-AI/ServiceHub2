// GET /api/workspace/calendar
//
// Day / Week / Month appointment feed. Either:
//   ?date=yyyy-mm-dd                       (single Malaysia day)
//   ?from=yyyy-mm-dd&to=yyyy-mm-dd         (inclusive Malaysia day range)
// plus optional scope=me|team, q, status, priority, support_mode, pic and
// include_unscheduled=1.
//
// Malaysia calendar days are converted to UTC before querying because
// appointments are stored in UTC.

import { createFileRoute } from "@tanstack/react-router";

import { myDayKey, myDayUtcRange } from "@/lib/qne/service-jobs/scheduling";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const SELECT =
  "id, job_number, subject, status, priority, support_mode, customer_code_snapshot, customer_name_snapshot, service_address, assigned_user_id, assigned_user_name_snapshot, scheduled_start_at, scheduled_end_at";

export const Route = createFileRoute("/api/workspace/calendar")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { requireAuthenticatedN3User, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        try {
          const user = await requireAuthenticatedN3User(request);
          const sp = new URL(request.url).searchParams;
          const day = DAY.test(sp.get("date") ?? "") ? sp.get("date")! : myDayKey();
          const from = DAY.test(sp.get("from") ?? "") ? sp.get("from")! : day;
          const to = DAY.test(sp.get("to") ?? "") ? sp.get("to")! : day;
          const scope = sp.get("scope") === "team" ? "team" : "me";
          const me = user.diagnostics.matchedN3UserId ?? user.userCode ?? null;

          const fromIso = myDayUtcRange(from).fromIso;
          const toIso = myDayUtcRange(to).toIso;

          const q = (sp.get("q") ?? "").trim().slice(0, 120);
          const status = sp.get("status") ?? "";
          const priority = sp.get("priority") ?? "";
          const supportMode = sp.get("support_mode") ?? "";
          const pic = sp.get("pic") ?? "";

          function applyFilters<T extends { eq: (c: string, v: string) => T; or: (f: string) => T }>(
            builder: T,
          ): T {
            let b = builder;
            if (scope === "me") b = b.eq("assigned_user_id", me ?? "__none__");
            if (pic) b = b.eq("assigned_user_id", pic);
            if (status) b = b.eq("status", status);
            if (priority) b = b.eq("priority", priority);
            if (supportMode) b = b.eq("support_mode", supportMode);
            if (q) {
              const safe = q.replace(/[%,()]/g, " ");
              b = b.or(
                [
                  `job_number.ilike.%${safe}%`,
                  `subject.ilike.%${safe}%`,
                  `customer_name_snapshot.ilike.%${safe}%`,
                  `customer_code_snapshot.ilike.%${safe}%`,
                  `assigned_user_name_snapshot.ilike.%${safe}%`,
                ].join(","),
              );
            }
            return b;
          }

          const scheduled = applyFilters(
            supabaseAdmin
              .from("service_jobs")
              .select(SELECT)
              .eq("tenant_code", user.tenantCode)
              .eq("is_deleted", false)
              .gte("scheduled_start_at", fromIso)
              .lt("scheduled_start_at", toIso)
              .order("scheduled_start_at", { ascending: true }) as never,
          ) as never as { data: unknown[] | null; error: unknown };

          const { data, error } = await (scheduled as unknown as PromiseLike<{
            data: unknown[] | null;
            error: { message: string } | null;
          }>);
          if (error) throw error;

          let unscheduled: unknown[] = [];
          if (sp.get("include_unscheduled") === "1") {
            const pending = applyFilters(
              supabaseAdmin
                .from("service_jobs")
                .select(SELECT)
                .eq("tenant_code", user.tenantCode)
                .eq("is_deleted", false)
                .is("scheduled_start_at", null)
                .in("status", ["Open", "Assigned", "In Progress", "Draft"])
                .order("created_at", { ascending: false })
                .limit(50) as never,
            ) as never as PromiseLike<{ data: unknown[] | null; error: unknown }>;
            const res = await pending;
            unscheduled = res.data ?? [];
          }

          return Response.json({
            date: day,
            from,
            to,
            scope,
            timezone: "Asia/Kuala_Lumpur",
            appointments: data ?? [],
            unscheduled,
            generatedAt: new Date().toISOString(),
          });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[workspace/calendar] failed", err);
          return Response.json(
            { error: err instanceof Error ? err.message : "Failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});
