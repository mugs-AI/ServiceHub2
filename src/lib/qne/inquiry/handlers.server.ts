import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { guardResponse, requireAuthenticatedN3User } from "@/lib/qne/session/current-user.server";
import { malaysiaTodayIso } from "@/lib/qne/malaysia-date";
import { requireInquiryAccess, resolveInquiryAccessForUser } from "./permissions.server";
import { InquiryInputError, parseJobDetailsQuery } from "./job-details";
import { queryJobDetails } from "./job-details.server";
import { buildJobDetailsWorkbook, exportJobColumns } from "./excel.server";

export async function handleInquiry(
  request: Request,
  operation: "access" | "list" | "export",
): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  try {
    const user = await requireAuthenticatedN3User(request);
    if (operation === "access")
      return Response.json(
        { access: await resolveInquiryAccessForUser(user, "job_details_inquiry") },
        { headers },
      );
    const access = await requireInquiryAccess(
      user,
      "job_details_inquiry",
      operation === "export" ? "can_export_excel" : "can_view",
    );
    const input = parseJobDetailsQuery(new URL(request.url).searchParams, access);
    let columns;
    if (operation === "export") {
      const text = await request.text();
      if (text.length > 8192) throw new InquiryInputError("Export request is too large.");
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        throw new InquiryInputError("Invalid export request.");
      }
      columns = exportJobColumns(body?.columns, access);
    }
    const actor = { tenantCode: user.tenantCode, userId: user.diagnostics.matchedN3UserId };
    const result = await queryJobDetails(
      supabaseAdmin,
      actor,
      access,
      input,
      operation === "export",
    );
    if (!columns) return Response.json(result, { headers });
    const workbook = buildJobDetailsWorkbook(result.rows, columns);
    const { error } = await supabaseAdmin.from("settings_audit_log").insert({
      tenant_code: user.tenantCode,
      area: "inquiry_export",
      action: "exported",
      performed_by_user_id: actor.userId,
      performed_by_name: user.displayName || user.email || null,
      new_value: {
        inquiry: "job_details_inquiry",
        rowCount: result.total,
        columns: columns.map((c) => c.key),
        scope: access.scope,
        dateField: input.dateField,
        from: input.from,
        to: input.to,
        filterKeys: Object.keys(input.filters),
        hasSearch: !!input.q,
        sort: input.sort,
        direction: input.direction,
      },
    });
    if (error) throw error;
    return new Response(new Uint8Array(workbook), {
      headers: {
        ...headers,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="Job_Details_${malaysiaTodayIso()}.xlsx"`,
      },
    });
  } catch (error) {
    const guard = guardResponse(error);
    if (guard) {
      guard.headers.set("Cache-Control", "no-store");
      return guard;
    }
    if (error instanceof InquiryInputError)
      return Response.json({ error: error.message }, { status: 400, headers });
    return Response.json(
      { error: "Unable to load or export Jobs. Refresh and try again." },
      { status: 500, headers },
    );
  }
}
