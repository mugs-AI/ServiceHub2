import { describe, expect, it } from "vitest";
import {
  inquiryPreferenceKey,
  loadInquiryPreferences,
  normalizeInquiryPreferences,
  orderedJobColumns,
  saveInquiryPreferences,
} from "./preferences";
import { NORMAL_USER_DEFAULT, OWNER_ADMIN_ACCESS } from "./permissions";
const viewer = { ...NORMAL_USER_DEFAULT, can_view: true };
const now = new Date("2026-10-01T01:00:00Z");
describe("Scoped Inquiry preferences", () => {
  it("separates tenants and users even with delimiters", () => {
    expect(
      new Set(
        [
          { tenantCode: "A", userId: "1" },
          { tenantCode: "B", userId: "1" },
          { tenantCode: "A", userId: "2" },
          { tenantCode: "A:1", userId: "2" },
        ].map(inquiryPreferenceKey),
      ).size,
    ).toBe(4);
  });
  it("strips denied or unsupported controls while preserving separate draft and applied values", () => {
    const value = normalizeInquiryPreferences(
      {
        version: 1,
        draft: {
          q: "draft",
          sort: "internal_note",
          filters: {
            internal_note: "secret",
            clock_in_latitude: "3",
            subject: "repair",
            status: "Fake",
          },
        },
        applied: { q: "applied", page: 2, pageSize: 50 },
        selectedColumns: ["subject", "internal_note", "subject", "missing"],
        columnOrder: ["subject", "job_number", "subject"],
      },
      viewer,
      now,
    );
    expect(value.draft.q).toBe("draft");
    expect(value.applied).toMatchObject({ q: "applied", page: 2, pageSize: 50 });
    expect(value.draft.filters).toEqual({ subject: "repair" });
    expect(value.draft.sort).toBe("created_at");
    expect(value.selectedColumns).toEqual(["subject"]);
    expect(value.columnOrder.slice(0, 2)).toEqual(["subject", "job_number"]);
  });
  it("restores a valid date range after the default range", () => {
    expect(
      normalizeInquiryPreferences(
        { version: 1, draft: { from: "2027-01-01", to: "2027-12-31" } },
        viewer,
        now,
      ).draft,
    ).toMatchObject({ from: "2027-01-01", to: "2027-12-31" });
  });
  it("retains zero selection and honours ordered columns", () => {
    expect(
      normalizeInquiryPreferences({ version: 1, selectedColumns: [] }, viewer, now).selectedColumns,
    ).toEqual([]);
    expect(
      orderedJobColumns(
        viewer,
        ["job_number", "subject", "internal_note"],
        ["subject", "job_number"],
      ).map((c) => c.key),
    ).toEqual(["subject", "job_number"]);
  });
  it("uses safe defaults for corrupt or unavailable storage", () => {
    const identity = { tenantCode: "A", userId: "1" };
    for (const storage of [
      { getItem: () => "{bad" },
      {
        getItem: () => {
          throw new Error("denied");
        },
      },
    ]) {
      expect(loadInquiryPreferences(storage, identity, viewer, now).draft).toMatchObject({
        from: "2026-08-01",
        to: "2026-10-01",
        page: 1,
        pageSize: 20,
      });
    }
    expect(() =>
      saveInquiryPreferences(
        {
          setItem: () => {
            throw new Error("denied");
          },
        },
        identity,
        normalizeInquiryPreferences(null, viewer, now),
      ),
    ).not.toThrow();
  });
  it("writes only versioned controls, never rows, credentials or grants", () => {
    let stored = "";
    saveInquiryPreferences(
      {
        setItem: (_key, value) => {
          stored = value;
        },
      },
      { tenantCode: "A", userId: "1" },
      {
        ...normalizeInquiryPreferences(null, OWNER_ADMIN_ACCESS, now),
        token: "secret",
        data: [{ id: "job" }],
        access: OWNER_ADMIN_ACCESS,
      } as never,
    );
    expect(Object.keys(JSON.parse(stored)).sort()).toEqual([
      "applied",
      "columnOrder",
      "draft",
      "selectedColumns",
      "version",
    ]);
  });
});
