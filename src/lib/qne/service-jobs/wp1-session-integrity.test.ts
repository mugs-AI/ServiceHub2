// WP1 Session Integrity Correction — persisted work-session invariant,
// Start/Pause/Resume/Stop lifecycle, waiting interaction, work minutes,
// concurrency conflict handling and the support-mode evidence lock.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { canSetSupportMode, computeWorkMinutes, workSessionState } from "./field-ops";
import type { WorkSessionRow } from "./field-ops";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");
const HISTORICAL = "20260801003537_bcb53731-c1d2-41bd-8ee5-359fe7ec9e62.sql";

function allMigrationSql(): { name: string; sql: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS_DIR, name), "utf8") }));
}

/* ---------------- schema contract ---------------- */

describe("work-session schema contract", () => {
  const files = allMigrationSql();
  const forward = files.filter((f) => f.name > HISTORICAL);

  it("keeps the historical migration intact with its original open-session index", () => {
    const historical = files.find((f) => f.name === HISTORICAL);
    expect(historical, "historical migration must still exist").toBeTruthy();
    expect(historical!.sql).toContain("service_job_work_sessions_one_open");
    expect(historical!.sql).toContain("(service_job_id, technician_user_id)");
    expect(historical!.sql).toContain("WHERE status IN ('active','paused')");
  });

  it("replaces the incompatible index in a forward migration", () => {
    const dropping = forward.filter((f) =>
      /DROP\s+INDEX[^;]*service_job_work_sessions_one_open/i.test(f.sql),
    );
    expect(dropping.length).toBeGreaterThan(0);
  });

  it("enforces a Job-level invariant for open active work only", () => {
    const creating = forward.find((f) =>
      /CREATE\s+UNIQUE\s+INDEX[\s\S]*service_job_work_sessions/i.test(f.sql),
    );
    expect(creating, "a forward unique index must exist").toBeTruthy();
    const sql = creating!.sql;
    // Job-level uniqueness: keyed on service_job_id only, never technician.
    expect(sql).toMatch(/\(service_job_id\)/);
    expect(sql).not.toMatch(/\(service_job_id,\s*technician_user_id\)/);
    // Only genuinely open active segments participate.
    expect(sql).toMatch(/WHERE\s+status\s*=\s*'active'/i);
    expect(sql).toMatch(/ended_at\s+IS\s+NULL/i);
    expect(sql).not.toMatch(/WHERE[^;]*'paused'/i);
  });

  it("does not delete or rewrite historical session evidence", () => {
    // Runtime routine bodies legitimately write single rows at request time;
    // this guard is about migration-level data rewrites, so function bodies
    // are excluded before checking.
    for (const f of forward) {
      const schemaOnly = f.sql.replace(/\$function\$[\s\S]*?\$function\$/g, "");
      expect(schemaOnly).not.toMatch(/DELETE\s+FROM[^;]*service_job_work_sessions/i);
      expect(schemaOnly).not.toMatch(/UPDATE\s+[^;]*service_job_work_sessions/i);
    }
  });
});

/* ---------------- lifecycle ---------------- */

const T = (min: number) => new Date(Date.UTC(2026, 7, 22, 8, min)).toISOString();

function seg(p: Partial<WorkSessionRow> & { id: string; started_at: string }): WorkSessionRow {
  return { status: "completed", ended_at: null, duration_minutes: null, ...p };
}

describe("Start / Pause / Resume / Stop persisted lifecycle", () => {
  it("Start -> Pause -> Resume -> Stop resolves to a closed job with no open state", () => {
    const started = [seg({ id: "s1", started_at: T(0), status: "active", ended_at: null })];
    expect(workSessionState(started).status).toBe("active");
    expect(workSessionState(started).activeSegment?.id).toBe("s1");

    const paused = [
      seg({ id: "s1", started_at: T(0), status: "paused", ended_at: T(30), duration_minutes: 30 }),
    ];
    expect(workSessionState(paused).status).toBe("paused");
    expect(workSessionState(paused).pausedSegment?.id).toBe("s1");
    expect(workSessionState(paused).activeSegment).toBeNull();

    const resumed = [
      ...paused,
      seg({ id: "s2", started_at: T(50), status: "active", ended_at: null }),
    ];
    expect(workSessionState(resumed).status).toBe("active");
    expect(workSessionState(resumed).activeSegment?.id).toBe("s2");

    const stopped = [
      paused[0],
      seg({
        id: "s2",
        started_at: T(50),
        status: "completed",
        ended_at: T(70),
        duration_minutes: 20,
      }),
    ];
    expect(workSessionState(stopped).status).toBeNull();
    expect(computeWorkMinutes(stopped)).toBe(50);
  });

  it("survives repeated Pause / Resume cycles and sums only recorded segments", () => {
    const rows = [
      seg({ id: "a", started_at: T(0), status: "paused", ended_at: T(10), duration_minutes: 10 }),
      seg({ id: "b", started_at: T(40), status: "paused", ended_at: T(55), duration_minutes: 15 }),
      seg({
        id: "c",
        started_at: T(80),
        status: "completed",
        ended_at: T(85),
        duration_minutes: 5,
      }),
    ];
    expect(workSessionState(rows).status).toBeNull();
    // 30 min + 25 min of paused wall clock contribute nothing.
    expect(computeWorkMinutes(rows)).toBe(30);
  });

  it("identifies only the current/latest paused segment as the state marker", () => {
    const rows = [
      seg({ id: "old", started_at: T(0), status: "paused", ended_at: T(10), duration_minutes: 10 }),
      seg({
        id: "current",
        started_at: T(40),
        status: "paused",
        ended_at: T(50),
        duration_minutes: 10,
      }),
    ];
    const state = workSessionState(rows);
    expect(state.pausedSegment?.id).toBe("current");
    // Historical paused rows are never selected for a state transition.
    expect(state.pausedSegment?.id).not.toBe("old");
  });

  it("treats a cancelled segment as excluded from state and minutes", () => {
    const rows = [
      seg({
        id: "x",
        started_at: T(0),
        status: "cancelled",
        ended_at: T(60),
        duration_minutes: 60,
      }),
    ];
    expect(workSessionState(rows).status).toBeNull();
    expect(computeWorkMinutes(rows)).toBe(0);
  });

  it("never counts an open active segment towards persisted totals", () => {
    const rows = [
      seg({
        id: "closed",
        started_at: T(0),
        status: "completed",
        ended_at: T(20),
        duration_minutes: 20,
      }),
      seg({ id: "open", started_at: T(30), status: "active", ended_at: null }),
    ];
    expect(computeWorkMinutes(rows)).toBe(20);
  });
});

/* ---------------- waiting interaction ---------------- */

describe("waiting interaction leaves no current work state", () => {
  it("active -> waiting closes the exact active segment", () => {
    const before = [seg({ id: "s1", started_at: T(0), status: "active", ended_at: null })];
    expect(workSessionState(before).activeSegment?.id).toBe("s1");
    const after = [
      seg({
        id: "s1",
        started_at: T(0),
        status: "completed",
        ended_at: T(25),
        duration_minutes: 25,
      }),
    ];
    expect(workSessionState(after).status).toBeNull();
    expect(computeWorkMinutes(after)).toBe(25);
  });

  it("paused -> waiting closes only the current paused marker and keeps history", () => {
    const before = [
      seg({ id: "old", started_at: T(0), status: "paused", ended_at: T(10), duration_minutes: 10 }),
      seg({
        id: "current",
        started_at: T(30),
        status: "paused",
        ended_at: T(45),
        duration_minutes: 15,
      }),
    ];
    expect(workSessionState(before).pausedSegment?.id).toBe("current");

    const after = [
      before[0],
      seg({
        id: "current",
        started_at: T(30),
        status: "completed",
        ended_at: T(45),
        duration_minutes: 15,
      }),
    ];
    expect(workSessionState(after).status).toBeNull();
    // Historical paused evidence and its minutes are untouched.
    expect(after[0].status).toBe("paused");
    expect(after[0].duration_minutes).toBe(10);
    expect(computeWorkMinutes(after)).toBe(25);
  });

  it("waiting wall-clock time adds zero work minutes", () => {
    const rows = [
      seg({
        id: "s1",
        started_at: T(0),
        status: "completed",
        ended_at: T(20),
        duration_minutes: 20,
      }),
      // ...waiting spanned T(20) -> T(120) with no session row...
      seg({
        id: "s2",
        started_at: T(120),
        status: "completed",
        ended_at: T(130),
        duration_minutes: 10,
      }),
    ];
    expect(computeWorkMinutes(rows)).toBe(30);
  });
});

/* ---------------- concurrency / stale writes ---------------- */

/**
 * Mirrors the persisted invariant enforced by the forward migration's partial
 * unique index: at most one open active row per Job, regardless of actor.
 */
class JobSessionStore {
  rows: (WorkSessionRow & { technician_user_id: string; service_job_id: string })[] = [];

  insertActive(jobId: string, actorId: string, at: string) {
    const conflict = this.rows.some(
      (r) => r.service_job_id === jobId && r.status === "active" && !r.ended_at,
    );
    if (conflict) {
      const err = new Error("duplicate key value violates unique constraint") as Error & {
        code: string;
      };
      err.code = "23505";
      throw err;
    }
    this.rows.push({
      id: `${actorId}-${at}`,
      service_job_id: jobId,
      technician_user_id: actorId,
      started_at: at,
      status: "active",
      ended_at: null,
      duration_minutes: null,
    });
  }

  /** Conditional close: returns the number of rows actually changed. */
  closeActive(jobId: string, rowId: string, at: string, to: "paused" | "completed"): number {
    const row = this.rows.find(
      (r) => r.service_job_id === jobId && r.id === rowId && r.status === "active" && !r.ended_at,
    );
    if (!row) return 0;
    row.status = to;
    row.ended_at = at;
    row.duration_minutes = Math.round((Date.parse(at) - Date.parse(row.started_at)) / 60000);
    return 1;
  }

  activeCount(jobId: string) {
    return this.rows.filter(
      (r) => r.service_job_id === jobId && r.status === "active" && !r.ended_at,
    ).length;
  }
}

/** Same translation the field endpoint applies to a 23505 conflict. */
function asConflictStatus(err: unknown): number {
  return (err as { code?: string }).code === "23505" ? 409 : 500;
}

describe("concurrency and stale-request protection", () => {
  it("two simultaneous Start Work requests produce one winner and one 409", () => {
    const store = new JobSessionStore();
    const results: number[] = [];
    for (const actor of ["pic", "pic"]) {
      try {
        store.insertActive("job-1", actor, T(0));
        results.push(200);
      } catch (err) {
        results.push(asConflictStatus(err));
      }
    }
    expect(results).toEqual([200, 409]);
    expect(store.activeCount("job-1")).toBe(1);
  });

  it("a PIC and an Admin racing Start Work cannot both hold an active segment", () => {
    const store = new JobSessionStore();
    store.insertActive("job-1", "pic-user", T(0));
    let status = 200;
    try {
      store.insertActive("job-1", "admin-user", T(0));
    } catch (err) {
      status = asConflictStatus(err);
    }
    expect(status).toBe(409);
    expect(store.activeCount("job-1")).toBe(1);
  });

  it("two simultaneous Resume requests leave exactly one active row", () => {
    const store = new JobSessionStore();
    store.insertActive("job-1", "pic", T(0));
    store.closeActive("job-1", store.rows[0].id, T(20), "paused");
    const results: number[] = [];
    for (const attempt of [T(30), T(30)]) {
      try {
        store.insertActive("job-1", "pic", attempt);
        results.push(200);
      } catch (err) {
        results.push(asConflictStatus(err));
      }
    }
    expect(results.filter((r) => r === 200)).toHaveLength(1);
    expect(store.activeCount("job-1")).toBe(1);
  });

  it("a stale Pause/Stop matching no active row changes nothing and must not audit success", () => {
    const store = new JobSessionStore();
    store.insertActive("job-1", "pic", T(0));
    const rowId = store.rows[0].id;
    const first = store.closeActive("job-1", rowId, T(20), "paused");
    const duplicate = store.closeActive("job-1", rowId, T(25), "paused");
    expect(first).toBe(1);
    expect(duplicate).toBe(0); // zero rows changed => 409, no second audit event
    expect(store.rows[0].ended_at).toBe(T(20));
    expect(store.rows[0].duration_minutes).toBe(20);
  });

  it("cross-job rows never satisfy a conditional close", () => {
    const store = new JobSessionStore();
    store.insertActive("job-1", "pic", T(0));
    expect(store.closeActive("job-2", store.rows[0].id, T(10), "completed")).toBe(0);
    expect(store.activeCount("job-1")).toBe(1);
  });
});

/* ---------------- support-mode lock ---------------- */

const PIC = { assigned_user_id: "u1" };
const NO_EVIDENCE = {
  sessionCount: 0,
  waitingCount: 0,
  workNoteCount: 0,
  travelStartedAt: null,
  arrivedAt: null,
};

describe("support-mode evidence lock", () => {
  it("allows PIC to set a null support mode when no field evidence exists", () => {
    const gate = canSetSupportMode(
      { ...PIC, support_mode: null },
      { isAdmin: false, actorUserId: "u1" },
      NO_EVIDENCE,
    );
    expect(gate.ok).toBe(true);
  });

  it("allows an Owner/Admin to set a null support mode when no evidence exists", () => {
    const gate = canSetSupportMode(
      { ...PIC, support_mode: null },
      { isAdmin: true, actorUserId: "admin" },
      NO_EVIDENCE,
    );
    expect(gate.ok).toBe(true);
  });

  it("locks a NULL support mode once any material field evidence exists", () => {
    const evidences = [
      { ...NO_EVIDENCE, sessionCount: 1 },
      { ...NO_EVIDENCE, waitingCount: 1 },
      { ...NO_EVIDENCE, workNoteCount: 1 },
      { ...NO_EVIDENCE, travelStartedAt: T(0) },
      { ...NO_EVIDENCE, arrivedAt: T(0) },
    ];
    for (const evidence of evidences) {
      const gate = canSetSupportMode(
        { ...PIC, support_mode: null },
        { isAdmin: true, actorUserId: "admin" },
        evidence,
      );
      expect(gate.ok).toBe(false);
      expect(gate.reason).toMatch(/locked/i);
    }
  });

  it("keeps a non-null support mode locked once evidence exists", () => {
    const gate = canSetSupportMode(
      { ...PIC, support_mode: "remote_support" },
      { isAdmin: true, actorUserId: "admin" },
      { ...NO_EVIDENCE, sessionCount: 2 },
    );
    expect(gate.ok).toBe(false);
  });

  it("refuses a non-PIC Normal User regardless of evidence", () => {
    const gate = canSetSupportMode(
      { ...PIC, support_mode: null },
      { isAdmin: false, actorUserId: "other-user" },
      NO_EVIDENCE,
    );
    expect(gate.ok).toBe(false);
    expect(gate.reason).toMatch(/Primary PIC or an Administrator/i);
  });
});

/* ---------------- UI truth ---------------- */

describe("Field Operations UI truth", () => {
  const panel = readFileSync(
    join(process.cwd(), "src", "components", "qne", "FieldOperationsPanel.tsx"),
    "utf8",
  );
  const jobDetail = readFileSync(join(process.cwd(), "src", "routes", "jobs.$jobId.tsx"), "utf8");

  it("is not mounted on Job Detail during the UI freeze", () => {
    expect(jobDetail).not.toContain("<FieldOperationsPanel");
  });

  it("renders no fabricated attachment count", () => {
    expect(jobDetail).not.toContain("attachmentCount");
    expect(panel).not.toContain("attachmentCount");
    expect(panel).not.toMatch(/<Stat\s+label="Attachments"/);
  });

  it("keeps mutation authority server-derived, not browser-derived", () => {
    expect(panel).toMatch(/data\.permissions\??\.canMutate/);
  });
});
