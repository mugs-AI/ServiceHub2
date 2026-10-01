import { describe, expect, it } from "vitest";
import { matchesPendingReference, pendingReferenceOr } from "./pending-reference-search";

describe("Pending reference search", () => {
  it("adds references to a bounded quoted literal OR predicate", () => {
    expect(pendingReferenceOr("  VEND_42,(A)  ")).toBe(
      [
        "job_number",
        "subject",
        "customer_name_snapshot",
        "latest_customer_ref_no",
        "latest_vendor_ref_no",
      ]
        .map((column) => `${column}.ilike.${JSON.stringify("%VEND\\_42,(A)%")}`)
        .join(","),
    );
    expect(pendingReferenceOr(" \n\t ")).toBeNull();
    expect(pendingReferenceOr("a".repeat(150))).not.toContain("a".repeat(101));
  });
  it("escapes SQL wildcards and PostgREST quotes/backslashes without deleting reference text", () => {
    const pattern = '%A\\%\\_\\\\"(42),B%';
    expect(pendingReferenceOr('A%_\\"(42),B')).toContain(
      `latest_vendor_ref_no.ilike.${JSON.stringify(pattern)}`,
    );
  });
  it("matches each literal field case-insensitively, including null references", () => {
    const row = {
      job_number: "JB001",
      subject: "Repair",
      customer_name: "Example",
      customer_code: "AC01",
      latest_customer_ref_no: null,
      latest_vendor_ref_no: "VEND_42",
    };
    for (const needle of ["jb001", "repair", "example", "ac01", " vend_42 "]) {
      expect(matchesPendingReference(row, needle)).toBe(true);
    }
    expect(matchesPendingReference(row, "CUST-42")).toBe(false);
    expect(matchesPendingReference(row, "%")).toBe(false);
  });
});
