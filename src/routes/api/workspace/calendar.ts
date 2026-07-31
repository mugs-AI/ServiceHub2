// GET /api/workspace/calendar?date=yyyy-mm-dd&scope=me|team
//
// Technician Day View feed. `date` is a Malaysia calendar day; the range is
// converted to UTC before querying because appointments are stored in UTC.

import { createFileRoute } from "@tanstack/react-router";

import { myDayKey, myDayUtcRange } from "@/lib/qne/service-jobs/scheduling";

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
          const day = /^\d{4}-\d{2}-\d{2}$/.test(sp.get("date") ?? "")
            ? sp.get("date")!
            : myDayKey();
          const scope = sp.get("scope") === "team" ? "team" : "me";
          const me = user.diagnostics.matchedN3UserId ?? user.userCode ?? null;
          const { fromIso, toIso } = myDayUtcRange(day);

          let query = supabaseAdmin
            .from("service_jobs")
            .select(
              "id, job_number, subject, status, priority, customer_code_snapshot, customer_name_snapshot, service_address, assigned_user_id, assigned_user_name_snapshot, scheduled_start_at, scheduled_end_at",
            )
            .eq("tenant_code", user.tenantCode)
            .eq("is_deleted", false)
            .gte("scheduled_start_at", fromIso)
            .lt("scheduled_start_at", toIso)
            .order("scheduled_start_at", { ascending: true });

          if (scope === "me") query = query.eq("assigned_user_id", me ?? "__none__");

          const { data, error } = await query;
          if (error) throw error;

          return Response.json({
            date: day,
            scope,
            timezone: "Asia/Kuala_Lumpur",
            appointments: data ?? [],
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
