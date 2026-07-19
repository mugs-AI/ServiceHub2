// Pure helper: group tenant-scoped line snapshot rows into Document Verifier
// candidates keyed by (source_type, n3_document_id). A single mutable
// document_no may map to multiple immutable N3 document IDs when N3 allows
// reusing a document number after deletion — every such record must surface.

export type SourceType = "invoice" | "delivery_order";

export interface LineRow {
  n3_document_id: string | null;
  document_no: string | null;
  document_date: string | null;
  document_status: string | null;
  customer_code: string | null;
  customer_name: string | null;
  line_type: string | null;
  stock_code: string | null;
  is_void: boolean | null;
}

export interface DocumentCandidate {
  document_no: string;
  n3_document_id: string;
  source_type: SourceType;
  document_date: string | null;
  document_status: string | null;
  customer_code: string | null;
  customer_name: string | null;
  total_lines: number;
  eligible_lines: number;
}

export function statusPriority(status: string | null | undefined): number {
  const s = (status ?? "").trim().toLowerCase();
  if (s === "deleted") return 2;
  if (s === "cancelled" || s === "canceled") return 1;
  return 0; // Active / normal / null
}

export function buildDocumentCandidates(
  rowsBySource: { rows: LineRow[]; source: SourceType }[],
  renewalStockKeys: Set<string>,
): DocumentCandidate[] {
  const grouped = new Map<string, DocumentCandidate>();
  for (const { rows, source } of rowsBySource) {
    for (const r of rows) {
      const docNo = r.document_no ?? "";
      const docId = r.n3_document_id ?? "";
      if (!docNo || !docId) continue;
      const key = `${source}::${docId}`;
      let c = grouped.get(key);
      if (!c) {
        c = {
          document_no: docNo,
          n3_document_id: docId,
          source_type: source,
          document_date: r.document_date ?? null,
          document_status: r.document_status ?? null,
          customer_code: r.customer_code ?? null,
          customer_name: r.customer_name ?? null,
          total_lines: 0,
          eligible_lines: 0,
        };
        grouped.set(key, c);
      }
      c.total_lines += 1;
      if (
        !r.is_void &&
        r.line_type === "stock" &&
        r.stock_code &&
        renewalStockKeys.has(r.stock_code.trim().toLowerCase())
      ) {
        c.eligible_lines += 1;
      }
    }
  }
  return Array.from(grouped.values()).sort((a, b) => {
    const sp = statusPriority(a.document_status) - statusPriority(b.document_status);
    if (sp !== 0) return sp;
    const ad = a.document_date ? Date.parse(a.document_date) : 0;
    const bd = b.document_date ? Date.parse(b.document_date) : 0;
    if (ad !== bd) return bd - ad;
    return a.n3_document_id.localeCompare(b.n3_document_id);
  });
}
