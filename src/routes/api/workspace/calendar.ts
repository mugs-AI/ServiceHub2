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

          const orFilter = q
            ? [
                `job_number.ilike.%${q.replace(/[%,()]/g, " ")}%`,
                `subject.ilike.%${q.replace(/[%,()]/g, " ")}%`,
                `customer_name_snapshot.ilike.%${q.replace(/[%,()]/g, " ")}%`,
                `customer_code_snapshot.ilike.%${q.replace(/[%,()]/g, " ")}%`,
                `assigned_user_name_snapshot.ilike.%${q.replace(/[%,()]/g, " ")}%`,
              ].join(",")
            : null;

          let query = supabaseAdmin
            .from("service_jobs")
            .select(SELECT)
            .eq("tenant_code", user.tenantCode)
            .eq("is_deleted", false)
            .gte("scheduled_start_at", fromIso)
            .lt("scheduled_start_at", toIso)
            .order("scheduled_start_at", { ascending: true });
          if (scope === "me") query = query.eq("assigned_user_id", me ?? "__none__");
          if (pic) query = query.eq("assigned_user_id", pic);
          if (status) query = query.eq("status", status);
          if (priority) query = query.eq("priority", priority);
          if (supportMode) query = query.eq("support_mode", supportMode);
          if (orFilter) query = query.or(orFilter);

          const { data, error } = await query;
          if (error) throw error;

          let unscheduled: typeof data = [];
          if (sp.get("include_unscheduled") === "1") {
            let pending = supabaseAdmin
              .from("service_jobs")
              .select(SELECT)
              .eq("tenant_code", user.tenantCode)
              .eq("is_deleted", false)
              .is("scheduled_start_at", null)
              .in("status", ["Open", "Assigned", "In Progress", "Draft"])
              .order("created_at", { ascending: false })
              .limit(50);
            if (scope === "me") pending = pending.eq("assigned_user_id", me ?? "__none__");
            if (pic) pending = pending.eq("assigned_user_id", pic);
            if (status) pending = pending.eq("status", status);
            if (priority) pending = pending.eq("priority", priority);
            if (supportMode) pending = pending.eq("support_mode", supportMode);
            if (orFilter) pending = pending.or(orFilter);
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
