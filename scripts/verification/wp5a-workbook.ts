import { writeFileSync } from "node:fs";
import {
  buildJobDetailsWorkbook,
  exportJobColumns,
} from "../../src/lib/qne/inquiry/excel.server.ts";
import { OWNER_ADMIN_ACCESS } from "../../src/lib/qne/inquiry/permissions.ts";
writeFileSync(
  "/tmp/wp5a-example.xlsx",
  buildJobDetailsWorkbook(
    [
      {
        id: "1",
        job_number: "0001",
        subject: '=HYPERLINK("fixture")',
        created_at: "2026-09-29T16:30:00Z",
        total_work_minutes: 0,
      },
    ],
    exportJobColumns(
      ["job_number", "subject", "created_at", "total_work_minutes"],
      OWNER_ADMIN_ACCESS,
    ),
  ),
);
