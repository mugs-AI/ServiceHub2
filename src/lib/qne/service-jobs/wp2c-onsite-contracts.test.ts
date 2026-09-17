// WP2C — source-text contracts: API surface, SQL candidate, UI placement,
// mobile safety, and preservation of the frozen legacy Field Operations.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");

const ROUTE = read("src", "routes", "jobs.$jobId.tsx");
const CARD = read("src", "components", "qne", "OnSiteAttendanceCard.tsx");
const API = read("src", "routes", "api", "workspace", "jobs.$jobId.onsite-attendance.ts");
const SERVER = read("src", "lib", "qne", "service-jobs", "onsite-attendance.server.ts");
const SQL = read("docs", "migrations", "WP2C_onsite_gps_attendance.candidate.sql");
const FIELD_ROUTE = read("src", "routes", "api", "workspace", "jobs.$jobId.field.ts");

describe("API authentication, tenant and actor authority", () => {
  it("authenticates every handler through the N3 session helper", () => {
    expect(API.match(/requireAuthenticatedN3User/g)?.length).toBeGreaterThanOrEqual(2);
    expect(API).toContain("guardResponse");
  });

  it("resolves tenant and actor server-side and never from the request body", () => {
    expect(API).toContain("tenantCode: user.tenantCode");
    expect(API).toContain("user.diagnostics.matchedN3UserId ?? user.userCode ?? null");
    expect(API).not.toMatch(/body\.(tenant_code|actor_user_id|user_id|tenantCode)/);
  });

  it("fails closed when the actor cannot be resolved", () => {
    expect(API).toContain('{ error: "Your user could not be resolved." }, { status: 401 }');
    expect(SERVER).toContain('if (!actor.userId) throw new AttendanceError');
  });

  it("scopes every read by the resolved tenant", () => {
    expect(SERVER.match(/\.eq\("tenant_code", tenantCode\)/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("rejects unknown actions and blocked lifecycles before mutating", () => {
    expect(API).toContain('if (action !== "clock_in" && action !== "clock_out")');
    expect(API).toContain("attendanceBlockedReason(job)");
  });

  it("requires an exception reason before committing a missing location", () => {
    expect(API).toContain("validateCapture(capture)");
    expect(API).toContain("if (!check.ok) return Response.json({ error: check.error }, { status: 400 })");
  });

  it("is a dedicated endpoint, not an extension of the legacy Field route", () => {
    expect(FIELD_ROUTE).not.toContain("onsite");
    expect(API).toContain("/api/workspace/jobs/$jobId/onsite-attendance");
  });
});

describe("atomicity and server timestamp authority", () => {
  it("performs clock in/out only through the transactional RPC", () => {
    expect(SERVER).toContain("ONSITE_ATTENDANCE_RPC");
    expect(SQL).toContain("CREATE OR REPLACE FUNCTION public.sh_onsite_attendance_mutate");
    expect(SQL).toContain("pg_advisory_xact_lock");
    expect(SQL).toContain("FOR UPDATE");
  });

  it("uses server now() for both events and ignores client timestamps", () => {
    expect(SQL).toContain("v_now          timestamptz := now();");
    expect(SQL).toContain("clock_out_at = v_now");
    expect(API).not.toMatch(/body\.(clock_in_at|clock_out_at|at)\b/);
  });

  it("enforces one open session per tenant + actor across all Jobs", () => {
    expect(SQL).toContain("CREATE UNIQUE INDEX IF NOT EXISTS service_job_onsite_attendance_one_open_idx");
    expect(SQL).toContain("WHERE clock_out_at IS NULL");
    expect(SQL).toContain("Clock out there first.");
  });

  it("returns deterministic conflicts for duplicate/racing clock in and out", () => {
    expect(SQL).toContain("You are already clocked in on this Job.");
    expect(SQL).toContain("WHEN unique_violation THEN");
    expect(SQL).toContain("You have no open on-site attendance session.");
    expect(SQL).toContain("Clock out there instead.");
  });

  it("writes audit inside the same transaction, only on success", () => {
    expect(SQL).toContain("'onsite_clock_in'");
    expect(SQL).toContain("'onsite_clock_out'");
    expect(SQL).toContain("'onsite_gps_exception'");
    const firstAudit = SQL.indexOf("INSERT INTO public.service_job_activity_log");
    expect(firstAudit).toBeGreaterThan(SQL.indexOf("ELSE\n    RETURN jsonb_build_object"));
  });
});

describe("candidate migration is additive and server-only", () => {
  it("lives at the reviewed candidate path and is not applied", () => {
    expect(existsSync(join(process.cwd(), "docs/migrations/WP2C_onsite_gps_attendance.candidate.sql"))).toBe(true);
    expect(existsSync(join(process.cwd(), "supabase/migrations"))).toBe(true);
  });

  it("creates the attendance table with FK and query indexes", () => {
    expect(SQL).toContain("CREATE TABLE IF NOT EXISTS public.service_job_onsite_attendance");
    expect(SQL).toContain("REFERENCES public.service_jobs(id) ON DELETE CASCADE");
    expect(SQL).toContain("service_job_onsite_attendance_job_idx");
    expect(SQL).toContain("service_job_onsite_attendance_actor_idx");
  });

  it("stores the reporting snapshots", () => {
    for (const col of [
      "actor_user_id",
      "actor_name_snapshot",
      "actor_code_snapshot",
      "actor_email_snapshot",
      "support_mode_snapshot",
      "clock_in_gps_result",
      "clock_in_exception_reason",
      "clock_out_gps_result",
      "has_gps_exception",
    ]) {
      expect(SQL).toContain(col);
    }
  });

  it("enables RLS and denies every browser role", () => {
    expect(SQL).toContain("ENABLE ROW LEVEL SECURITY");
    expect(SQL).toContain("USING (false) WITH CHECK (false)");
    expect(SQL).toContain("GRANT ALL ON public.service_job_onsite_attendance TO service_role;");
    expect(SQL).toContain("FROM PUBLIC, anon, authenticated");
  });

  it("never drops, renames or backfills legacy Field data", () => {
    expect(SQL).not.toMatch(/DROP TABLE|ALTER TABLE .*RENAME|TRUNCATE|DELETE FROM/i);
    // Legacy Field tables may only be named in explanatory comments.
    for (const line of SQL.split("\n")) {
      if (/service_job_work_sessions|service_job_waiting_periods/.test(line)) {
        expect(line.trim().startsWith("--")).toBe(true);
      }
    }
    expect(SQL).not.toContain("CREATE OR REPLACE FUNCTION public.sh_field_mutate");
  });
});

describe("legacy Field Operations stays frozen", () => {
  it("keeps FieldOperationsPanel unmounted on the Job detail page", () => {
    expect(ROUTE).not.toContain("FieldOperationsPanel");
  });

  it("leaves the legacy field endpoint and pure rules untouched by WP2C", () => {
    expect(FIELD_ROUTE).toContain("sh_field_mutate");
    expect(CARD).not.toContain("travel_started");
    expect(CARD).not.toContain("work_session");
    expect(CARD).not.toContain("Ready for Completion");
  });
});

describe("card placement and mobile contract", () => {
  it("renders below Appointment and above Job Attachments", () => {
    const schedule = ROUTE.indexOf("<ScheduleCard");
    const attendance = ROUTE.indexOf("<OnSiteAttendanceCard");
    const attachments = ROUTE.indexOf("<JobAttachmentsCard");
    expect(schedule).toBeGreaterThan(-1);
    expect(attendance).toBeGreaterThan(schedule);
    expect(attachments).toBeGreaterThan(attendance);
  });

  it("uses the exact heading and both GPS actions", () => {
    expect(CARD).toContain("On-Site Attendance");
    expect(CARD).toContain("GPS Clock In");
    expect(CARD).toContain("GPS Clock Out");
  });

  it("keeps large touch targets and no horizontal overflow at 390px", () => {
    expect(CARD).toContain("overflow-x-hidden");
    expect(CARD.match(/min-h-12 w-full/g)?.length).toBeGreaterThanOrEqual(2);
    expect(CARD).toContain("flex flex-col gap-2 sm:flex-row");
    expect(CARD).toContain("break-words");
    expect(CARD).not.toMatch(/\bw-\[\d{3,}px\]|min-w-\[\d{3,}px\]|overflow-x-auto/);
  });

  it("shows state, Malaysia timestamps, live elapsed and GPS outcome", () => {
    expect(CARD).toContain('{open ? "Clocked in" : "Not clocked in"}');
    expect(CARD).toContain("formatMYDateTime(open.clock_in_at)");
    expect(CARD).toContain('data-testid="onsite-elapsed"');
    expect(CARD).toContain("gpsSummary(open.clock_in_gps_result, open.clock_in_accuracy_m)");
  });

  it("captures location only at clock in and clock out", () => {
    expect(CARD).toContain("getCurrentPosition");
    expect(CARD).not.toContain("watchPosition");
  });

  it("blocks committing a missing location without a reason", () => {
    expect(CARD).toContain("Reason for missing location *");
    expect(CARD).toContain("disabled={!reason.trim() || !!busy}");
  });
});

describe("no regression to accepted surfaces", () => {
  it("keeps WP2B attachments, cancellation, scheduling and the Timeline drawer", () => {
    expect(ROUTE).toContain("<JobAttachmentsCard jobId={job.id} />");
    expect(ROUTE).toContain("<CancellationPanel");
    expect(ROUTE).toContain("<ScheduleCard");
    expect(ROUTE).toContain('data-testid="timeline-drawer"');
  });

  it("uses the existing N3 bearer/session pattern and stores no tokens", () => {
    expect(CARD).toContain("getStoredToken");
    expect(CARD).toContain("Authorization: `Bearer ${token}`");
    expect(SQL).not.toMatch(/token|secret/i);
  });
});
