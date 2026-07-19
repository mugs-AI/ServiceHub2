// POST /api/workspace/jobs — create a Service Job (Draft or Pending Approval).
// GET  /api/workspace/jobs?limit=... — recent tenant jobs (for future listing).
//
// - Tenant is resolved server-side from the N3 session; browser-supplied
//   tenantCode is ignored.
// - Job number is minted atomically via the SECURITY DEFINER RPC
//   sh_next_job_number (INSERT ... ON CONFLICT ... RETURNING), so two
//   concurrent submissions cannot collide.
// - Entitlement gate re-reads customer_subscription_snapshots server-side —
//   the client cannot forge Active/Overdue/None classification.
// - Selected entitlement is verified against the same tenant/customer
//   before it is snapshotted onto the job.
// - The Subscription Engine is NOT mutated — this only reads snapshots.

import { createFileRoute } from "@tanstack/react-router";

type Priority = "High" | "Medium" | "Low";
type SourceType =
  | "Phone"
  | "WhatsApp"
  | "Email"
  | "Walk-in"
  | "Remote Support"
  | "Other";

const PRIORITIES: readonly Priority[] = ["High", "Medium", "Low"];
const SOURCES: readonly SourceType[] = [
  "Phone",
  "WhatsApp",
  "Email",
  "Walk-in",
  "Remote Support",
  "Other",
];
const ACTIVE_STATUSES = ["Active", "Due Soon", "Overdue"] as const;

function trim(v: unknown, max = 2000): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

function dateKey(now: Date): { key: string; yy: string; mm: string; dd: string } {
  const yy = String(now.getUTCFullYear() % 100).padStart(2, "0");
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return { key: `${yy}${mm}${dd}`, yy, mm, dd };
}

export const Route = createFileRoute("/api/workspace/jobs")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { requireAuthenticatedN3User, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        try {
          const user = await requireAuthenticatedN3User(request);
          const body = (await request.json().catch(() => ({}))) as Record<
            string,
            unknown
          >;

          const customerCode = trim(body.customer_code, 100);
          const subject = trim(body.subject, 200);
          const problem = trim(body.problem_description, 5000);
          const priority = (trim(body.priority, 20) ?? "Medium") as Priority;
          const source = (trim(body.source, 20) ?? "Phone") as SourceType;

          if (!customerCode || !subject || !problem) {
            return Response.json(
              { error: "Customer, subject and problem description are required." },
              { status: 400 },
            );
          }
          if (!PRIORITIES.includes(priority)) {
            return Response.json({ error: "Invalid priority." }, { status: 400 });
          }
          if (!SOURCES.includes(source)) {
            return Response.json({ error: "Invalid source." }, { status: 400 });
          }

          // 1) Verify customer belongs to this tenant, and grab display + N3 id.
          const { data: cust, error: custErr } = await supabaseAdmin
            .from("customer_snapshots")
            .select(
              "customer_code, customer_name, contact_person, phone, email, address, n3_customer_id",
            )
            .eq("tenant_code", user.tenantCode)
            .eq("customer_code", customerCode)
            .limit(1)
            .maybeSingle();
          if (custErr) throw custErr;
          if (!cust) {
            return Response.json(
              { error: "Customer not found in this tenant." },
              { status: 404 },
            );
          }

          // 2) Server-side entitlement classification (never trust client).
          const { data: subs, error: subsErr } = await supabaseAdmin
            .from("customer_subscription_snapshots")
            .select(
              "id, subscription_category, stock_code, n3_stock_id, expiry_date, subscription_status",
            )
            .eq("tenant_code", user.tenantCode)
            .eq("customer_code", customerCode)
            .in("subscription_status", ACTIVE_STATUSES);
          if (subsErr) throw subsErr;

          const hasActiveish = (subs ?? []).some((s) =>
            ["Active", "Due Soon"].includes(s.subscription_status ?? ""),
          );
          const hasOverdue = (subs ?? []).some(
            (s) => (s.subscription_status ?? "") === "Overdue",
          );

          let status: "Draft" | "Pending Approval" = "Draft";
          let requiresApproval = false;
          let approvalReason: string | null = null;
          if (!hasActiveish && hasOverdue) {
            status = "Pending Approval";
            requiresApproval = true;
            approvalReason = "Overdue Entitlement";
          } else if (!hasActiveish && !hasOverdue) {
            status = "Pending Approval";
            requiresApproval = true;
            approvalReason = "No Active Entitlement";
          }

          // 3) Optional selected entitlement — verify it belongs to this
          //    tenant/customer before we snapshot it onto the job.
          const selectedId = trim(body.subscription_snapshot_id, 64);
          let entitlementSnap: {
            id: string;
            category: string | null;
            n3_stock_id: string | null;
            stock_code: string | null;
            expiry_date: string | null;
            status: string | null;
          } | null = null;
          if (selectedId) {
            const match = (subs ?? []).find((s) => s.id === selectedId);
            if (match) {
              entitlementSnap = {
                id: match.id,
                category: match.subscription_category,
                n3_stock_id: match.n3_stock_id,
                stock_code: match.stock_code,
                expiry_date: match.expiry_date,
                status: match.subscription_status,
              };
            }
          }

          // 4) Mint job number atomically.
          const { key: dk, yy, mm, dd } = dateKey(new Date());
          const { data: seqData, error: seqErr } = await supabaseAdmin.rpc(
            "sh_next_job_number",
            { p_tenant_code: user.tenantCode, p_date_key: dk },
          );
          if (seqErr) throw seqErr;
          const seq = Number(seqData);
          if (!Number.isFinite(seq) || seq < 1) {
            throw new Error("Job number allocator returned invalid value");
          }
          const jobNumber = `JB${yy}${mm}${dd}${String(seq).padStart(2, "0")}`;

          // 5) Insert the job.
          const insert = {
            tenant_code: user.tenantCode,
            job_number: jobNumber,
            n3_customer_id: cust.n3_customer_id,
            customer_code_snapshot: cust.customer_code,
            customer_name_snapshot: cust.customer_name,
            contact_person: trim(body.contact_person, 200) ?? cust.contact_person,
            contact_phone: trim(body.contact_phone, 100) ?? cust.phone,
            contact_email: trim(body.contact_email, 200) ?? cust.email,
            service_address: trim(body.service_address, 500) ?? cust.address,
            subject,
            problem_description: problem,
            status,
            priority,
            source,
            requires_approval: requiresApproval,
            approval_reason: approvalReason,
            subscription_snapshot_id: entitlementSnap?.id ?? null,
            subscription_category_snapshot: entitlementSnap?.category ?? null,
            n3_stock_id_snapshot: entitlementSnap?.n3_stock_id ?? null,
            stock_code_snapshot: entitlementSnap?.stock_code ?? null,
            entitlement_expiry_snapshot: entitlementSnap?.expiry_date ?? null,
            entitlement_status_snapshot: entitlementSnap?.status ?? null,
            internal_note: trim(body.internal_note, 5000),
            created_by_user_id: user.diagnostics.matchedN3UserId ?? user.userCode ?? null,
            created_by_name: user.displayName || user.email || null,
          };
          const { data: inserted, error: insErr } = await supabaseAdmin
            .from("service_jobs")
            .insert(insert)
            .select("*")
            .single();
          if (insErr) throw insErr;

          return Response.json({ job: inserted }, { status: 201 });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[workspace/jobs POST] failed", err);
          return Response.json(
            { error: err instanceof Error ? err.message : "Failed" },
            { status: 500 },
          );
        }
      },

      GET: async ({ request }) => {
        const { requireAuthenticatedN3User, guardResponse } = await import(
          "@/lib/qne/session/current-user.server"
        );
        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        try {
          const user = await requireAuthenticatedN3User(request);
          const url = new URL(request.url);
          const sp = url.searchParams;
          const page = Math.max(Number(sp.get("page") ?? 1) || 1, 1);
          const pageSize = Math.min(
            Math.max(Number(sp.get("pageSize") ?? sp.get("limit") ?? 20) || 20, 1),
            100,
          );
          const customerCode = trim(sp.get("customerCode"), 100);
          const q = trim(sp.get("q"), 100);
          const status = trim(sp.get("status"), 40);
          const priority = trim(sp.get("priority"), 20);
          const technician = trim(sp.get("technician"), 100);
          const from = trim(sp.get("from"), 40);
          const to = trim(sp.get("to"), 40);

          let query = supabaseAdmin
            .from("service_jobs")
            .select(
              "id, job_number, customer_code_snapshot, customer_name_snapshot, subject, status, priority, source, requires_approval, approval_reason, assigned_user_id, assigned_user_name_snapshot, assigned_at, created_at",
              { count: "exact" },
            )
            .eq("tenant_code", user.tenantCode);

          if (customerCode) query = query.eq("customer_code_snapshot", customerCode);
          if (status) query = query.eq("status", status);
          if (priority) query = query.eq("priority", priority);
          if (technician) {
            if (technician === "__unassigned__") {
              query = query.is("assigned_user_id", null);
            } else {
              query = query.eq("assigned_user_id", technician);
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

          const fromIdx = (page - 1) * pageSize;
          const toIdx = fromIdx + pageSize - 1;
          const { data, error, count } = await query
            .order("created_at", { ascending: false })
            .range(fromIdx, toIdx);
          if (error) throw error;
          return Response.json({
            jobs: data ?? [],
            total: count ?? 0,
            page,
            pageSize,
          });
        } catch (err) {
          const resp = guardResponse(err);
          if (resp) return resp;
          console.error("[workspace/jobs GET] failed", err);
          return Response.json(
            { error: err instanceof Error ? err.message : "Failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});
