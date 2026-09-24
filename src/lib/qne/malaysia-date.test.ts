import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  MALAYSIA_DATE_PLACEHOLDER,
  formatMalaysiaDate,
  isValidIsoDate,
  malaysiaCurrentMonthStartIso,
  malaysiaTodayIso,
  parseMalaysiaDate,
} from "./malaysia-date";

const read = (p: string) => readFileSync(p, "utf8");

describe("Malaysian date parsing", () => {
  it("parses dd/mm/yyyy into ISO", () => {
    expect(parseMalaysiaDate("19/07/2026")).toBe("2026-07-19");
    expect(parseMalaysiaDate("1/7/2026")).toBe("2026-07-01");
    expect(parseMalaysiaDate("29/02/2024")).toBe("2024-02-29");
  });

  it("never reads a date as month-first", () => {
    // 03/04/2026 is 3 April, not 4 March.
    expect(parseMalaysiaDate("03/04/2026")).toBe("2026-04-03");
  });

  it("rejects impossible dates", () => {
    for (const bad of ["31/02/2026", "29/02/2026", "13/13/2026", "00/01/2026", "32/01/2026"]) {
      expect(parseMalaysiaDate(bad)).toBeNull();
    }
  });

  it("rejects partial or malformed input but allows a cleared field", () => {
    expect(parseMalaysiaDate("19/07")).toBeNull();
    expect(parseMalaysiaDate("abc")).toBeNull();
    expect(parseMalaysiaDate("")).toBe("");
    expect(parseMalaysiaDate("   ")).toBe("");
    expect(parseMalaysiaDate(null)).toBe("");
  });
});

describe("Malaysian date formatting and round-trip", () => {
  it("formats ISO into dd/mm/yyyy", () => {
    expect(formatMalaysiaDate("2026-07-19")).toBe("19/07/2026");
    expect(formatMalaysiaDate("2026-01-05")).toBe("05/01/2026");
    expect(formatMalaysiaDate("")).toBe("");
    expect(formatMalaysiaDate("2026-02-31")).toBe("");
  });

  it("round-trips ISO -> display -> ISO", () => {
    for (const iso of ["2026-07-19", "2024-02-29", "2026-12-31", "2026-01-01"]) {
      expect(parseMalaysiaDate(formatMalaysiaDate(iso))).toBe(iso);
    }
  });

  it("validates ISO days", () => {
    expect(isValidIsoDate("2026-07-19")).toBe(true);
    expect(isValidIsoDate("2026-02-30")).toBe(false);
    expect(isValidIsoDate("19/07/2026")).toBe(false);
  });
});

describe("Malaysia time anchors", () => {
  it("uses Malaysia time, not UTC, for today", () => {
    // 2026-07-19 17:30 UTC is already 20/07/2026 in Malaysia.
    expect(malaysiaTodayIso(new Date("2026-07-19T17:30:00Z"))).toBe("2026-07-20");
    expect(malaysiaTodayIso(new Date("2026-07-19T10:00:00Z"))).toBe("2026-07-19");
  });

  it("opens a fresh calendar on the current Malaysia month", () => {
    expect(malaysiaCurrentMonthStartIso(new Date("2026-07-19T17:30:00Z"))).toBe("2026-07-01");
    expect(malaysiaCurrentMonthStartIso(new Date("2026-12-31T20:00:00Z"))).toBe("2027-01-01");
  });
});

describe("route contracts — no raw month-first date inputs on UAT surfaces", () => {
  const surfaces = [
    "src/routes/dashboard.tsx",
    "src/routes/calendar.tsx",
    "src/components/qne/EntitlementCustomerScreen.tsx",
  ];

  it("uses the shared Malaysian date field", () => {
    for (const f of surfaces) {
      const src = read(f);
      // WP3C-2: the calendar uses the shared in-app day picker popover.
      expect(src.includes("MalaysiaDateInput") || src.includes("MalaysiaDatePopover")).toBe(true);
      expect(src).not.toContain('type="date"');
    }
  });

  it("keeps ISO on the wire", () => {
    const component = read("src/components/qne/MalaysiaDateInput.tsx");
    expect(component).toContain("parseMalaysiaDate");
    expect(component).toContain("formatMalaysiaDate");
    expect(MALAYSIA_DATE_PLACEHOLDER).toBe("dd/mm/yyyy");
  });
});
