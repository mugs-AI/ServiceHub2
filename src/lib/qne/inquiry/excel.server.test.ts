import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildJobDetailsWorkbook, exportJobColumns } from "./excel.server";
import { NORMAL_USER_DEFAULT, OWNER_ADMIN_ACCESS } from "./permissions";
function unzip(bytes: Uint8Array): Record<string, string> {
  const b = Buffer.from(bytes),
    files: Record<string, string> = {};
  let offset = 0;
  while (b.readUInt32LE(offset) === 0x04034b50) {
    const size = b.readUInt32LE(offset + 18),
      len = b.readUInt16LE(offset + 26),
      extra = b.readUInt16LE(offset + 28),
      name = b.subarray(offset + 30, offset + 30 + len).toString(),
      start = offset + 30 + len + extra;
    files[name] = inflateRawSync(b.subarray(start, start + size)).toString();
    offset = start + size;
  }
  expect(b.readUInt32LE(offset)).toBe(0x02014b50);
  return files;
}
describe("Job Details XLSX", () => {
  it("preserves submitted column order", () => {
    expect(
      exportJobColumns(["subject", "job_number"], OWNER_ADMIN_ACCESS).map((c) => c.key),
    ).toEqual(["subject", "job_number"]);
  });
  it("creates an OOXML archive with literal strings, numeric cells, Malaysian dates and filters", () => {
    const cols = exportJobColumns(
        ["job_number", "subject", "created_at", "total_work_minutes"],
        OWNER_ADMIN_ACCESS,
      ),
      files = unzip(
        buildJobDetailsWorkbook(
          [
            {
              id: "1",
              job_number: "0001",
              subject: '=HYPERLINK("bad") <&> \u0000',
              created_at: "2026-09-29T16:30:00Z",
              total_work_minutes: 0,
            },
          ],
          cols,
        ),
      ),
      sheet = files["xl/worksheets/sheet1.xml"];
    expect(files["[Content_Types].xml"]).toContain("spreadsheetml.sheet.main+xml");
    expect(sheet).toContain('t="inlineStr"');
    expect(sheet).toContain("=HYPERLINK(&quot;bad&quot;) &lt;&amp;&gt;");
    expect(sheet).not.toContain("<f>");
    expect(sheet).not.toContain("\u0000");
    expect(sheet).toContain("30/09/2026, 12:30 AM");
    expect(sheet).toContain('<c r="D2" s="2"><v>0</v></c>');
    expect(sheet).toContain('<autoFilter ref="A1:D2"');
  });
  it("rejects unauthorized, unknown, duplicate or empty columns", () => {
    const viewer = { ...NORMAL_USER_DEFAULT, can_view: true };
    for (const keys of [
      ["internal_note"],
      ["clock_in_latitude"],
      ["tenant_code"],
      ["subject", "subject"],
      [],
    ])
      expect(() => exportJobColumns(keys, viewer)).toThrow();
  });
  it("exports a valid header-only workbook for zero Jobs", () => {
    const sheet = unzip(
      buildJobDetailsWorkbook([], exportJobColumns(["job_number"], OWNER_ADMIN_ACCESS)),
    )["xl/worksheets/sheet1.xml"];
    expect(sheet).toContain('dimension ref="A1:A1"');
  });
});
