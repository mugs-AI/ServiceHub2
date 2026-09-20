// POST /api/workspace/jobs/$jobId/waiting — WP3A waiting transition.
//
// Body: { party: "customer" | "vendor", ref_no: string }
//
// The reference number is mandatory and validated here as well as inside the
// transaction: UI-only validation is never sufficient. Tenant and actor are
// resolved from the authenticated N3 session; the request body never carries
// tenant, actor, role or timestamps. The RPC is the single mutation path and
// performs status change + latest reference update + activity evidence in one
// transaction with an exact status recheck under lock.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/workspace/jobs/$jobId/waiting")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const { requireAuthenticatedN3User, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { setWaitingStateAtomic } = await import("@/lib/qne/service-jobs/wp3a.server");
        const { parseWaitingInput } = await import("@/lib/qne/service-jobs/wp3a-waiting");
        try {
          const user = await requireAuthenticatedN3User(request);
          const actor = {
            tenantCode: user.tenantCode,
            userId: user.diagnostics.matchedN3UserId ?? user.userCode ?? null,
            name: user.displayName || user.email || null,
            isAdmin: Boolean(user.isAdministrator),
          };
          if (!actor.userId) {
            return Response.json({ error: "Your user could not be resolved." }, { status: 401 });
          }

          const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
          const parsed = parseWaitingInput(body);
          if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

          const result = await setWaitingStateAtomic(actor, params.jobId, parsed.value);
          if (result.outcome !== "ok") {
            return Response.json(
              { error: result.error ?? "Waiting update failed." },
              { status: result.status ?? 409 },
            );
          }
          return Response.json({
            ok: true,
            status: result.status_value ?? null,
            party: parsed.value.party,
            refNo: parsed.value.ref_no,
          });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          const status = (err as { status?: number }).status;
          if (typeof status === "number" && status !== 500) {
            return Response.json({ error: (err as Error).message }, { status });
          }
          console.error("[jobs/waiting POST] failed", err);
          return Response.json({ error: "Failed to update waiting state" }, { status: 500 });
        }
      },
    },
  },
});
