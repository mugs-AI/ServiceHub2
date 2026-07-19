import { describe, it, expect } from "vitest";
import {
  buildDocumentCandidates,
  statusPriority,
  type LineRow,
} from "./document-candidates";

function line(overrides: Partial<LineRow>): LineRow {
  return {
    n3_document_id: null,
    document_no: null,
    document_date: null,
    document_status: null,
    customer_code: null,
    customer_name: null,
    line_type: "stock",
    stock_code: null,
    is_void: false,
    ...overrides,
  };
}

describe("statusPriority", () => {
  it("orders Active < Cancelled < Deleted (case/synonym tolerant)", () => {
    expect(statusPriority(null)).toBe(0);
    expect(statusPriority("Active")).toBe(0);
    expect(statusPriority("cancelled")).toBe(1);
    expect(statusPriority("Canceled")).toBe(1);
    expect(statusPriority("DELETED")).toBe(2);
  });
});

describe("buildDocumentCandidates", () => {
  it("returns one candidate per (source_type, n3_document_id) — duplicate doc numbers surface", () => {
    // Same document_no, two different immutable N3 IDs => two candidates.
    const rows: LineRow[] = [
      line({
        n3_document_id: "id-A-deleted",
        document_no: "M1S2605009",
        document_date: "2025-05-01",
        document_status: "Deleted",
        customer_code: "700-K051",
        customer_name: "K.C. Kwang",
      }),
      line({
        n3_document_id: "id-A-deleted",
        document_no: "M1S2605009",
        document_date: "2025-05-01",
        document_status: "Deleted",
        customer_code: "700-K051",
        customer_name: "K.C. Kwang",
      }),
      line({
        n3_document_id: "id-B-active",
        document_no: "M1S2605009",
        document_date: "2025-06-15",
        document_status: "Active",
        customer_code: "700-T900",
        customer_name: "PERCETAKAN TEINFUNG SDN BHD",
      }),
    ];

    const candidates = buildDocumentCandidates(
      [{ rows, source: "invoice" }],
      new Set(),
    );

    expect(candidates).toHaveLength(2);
    // Active first, Deleted second.
    expect(candidates[0].n3_document_id).toBe("id-B-active");
    expect(candidates[0].document_status).toBe("Active");
    expect(candidates[0].customer_name).toBe("PERCETAKAN TEINFUNG SDN BHD");
    expect(candidates[1].n3_document_id).toBe("id-A-deleted");
    expect(candidates[1].document_status).toBe("Deleted");
    expect(candidates[1].total_lines).toBe(2);
  });

  it("counts eligible lines against the renewal stock keys", () => {
    const rows: LineRow[] = [
      line({
        n3_document_id: "id-1",
        document_no: "DOC1",
        stock_code: "RENEW-A",
        line_type: "stock",
      }),
      line({
        n3_document_id: "id-1",
        document_no: "DOC1",
        stock_code: "OTHER",
        line_type: "stock",
      }),
      line({
        n3_document_id: "id-1",
        document_no: "DOC1",
        stock_code: "RENEW-A",
        line_type: "stock",
        is_void: true,
      }),
    ];
    const candidates = buildDocumentCandidates(
      [{ rows, source: "invoice" }],
      new Set(["renew-a"]),
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].total_lines).toBe(3);
    expect(candidates[0].eligible_lines).toBe(1);
  });

  it("keeps invoice and delivery_order records with the same immutable id apart", () => {
    const shared = "shared-id";
    const candidates = buildDocumentCandidates(
      [
        { rows: [line({ n3_document_id: shared, document_no: "X" })], source: "invoice" },
        {
          rows: [line({ n3_document_id: shared, document_no: "X" })],
          source: "delivery_order",
        },
      ],
      new Set(),
    );
    expect(candidates).toHaveLength(2);
  });
});
