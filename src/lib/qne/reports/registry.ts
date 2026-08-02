// Central report registry + role permission model (Run 7 Phase S).
// New reports default to Administrator/Owner only.

export const REPORT_ROLES = [
  "administrator",
  "coordinator",
  "support_pic",
  "reports_viewer",
] as const;
export type ReportRole = (typeof REPORT_ROLES)[number];

export const REPORT_ROLE_LABEL: Record<ReportRole, string> = {
  administrator: "Administrator / Owner",
  coordinator: "Service Coordinator",
  support_pic: "Support PIC",
  reports_viewer: "Reports Viewer",
};

export const DATA_SCOPES = ["own", "team", "all"] as const;
export type DataScope = (typeof DATA_SCOPES)[number];

export const DATA_SCOPE_LABEL: Record<DataScope, string> = {
  own: "Own Jobs Only",
  team: "Team Jobs",
  all: "All Jobs",
};

export type ReportGroup = "renewal" | "service" | "management";

export interface ReportDefinition {
  code: string;
  name: string;
  group: ReportGroup;
  /** Route this registry entry governs, when it has a screen today. */
  route?: string;
}

export const REPORT_REGISTRY: readonly ReportDefinition[] = [
  // Renewal
  { code: "active_entitlements", name: "Active Entitlements", group: "renewal", route: "/support" },
  { code: "due_soon_customers", name: "Due Soon Customers", group: "renewal", route: "/customers/due-soon" },
  { code: "overdue_customers", name: "Overdue Customers", group: "renewal", route: "/customers/overdue" },
  { code: "renewal_history", name: "Renewal History", group: "renewal" },
  { code: "entitlement_by_category", name: "Entitlement by Category", group: "renewal" },
  { code: "entitlement_by_stock", name: "Entitlement by Stock Code", group: "renewal" },
  { code: "invoice_do_source", name: "Invoice / DO Source Report", group: "renewal" },
  // Service
  { code: "service_job_listing", name: "Service Job Listing", group: "service", route: "/jobs/pending" },
  { code: "job_status_summary", name: "Job Status Summary", group: "service" },
  { code: "priority_summary", name: "Priority Summary", group: "service" },
  { code: "customer_service_history", name: "Customer Service History", group: "service" },
  { code: "support_pic_workload", name: "Support PIC Workload", group: "service", route: "/admin/dashboard" },
  { code: "waiting_customer", name: "Waiting Customer", group: "service" },
  { code: "waiting_vendor", name: "Waiting Vendor", group: "service" },
  { code: "vendor_ticket", name: "Vendor Ticket Report", group: "service" },
  { code: "approval_report", name: "Approval Report", group: "service" },
  { code: "appointment_report", name: "Appointment Report", group: "service", route: "/calendar" },
  { code: "travel_arrival_report", name: "Travel & Arrival Report", group: "service" },
  { code: "work_duration_report", name: "Work Duration Report", group: "service" },
  { code: "completed_jobs", name: "Completed Jobs", group: "service" },
  { code: "software_service_report", name: "Software Service Report", group: "service", route: "/jobs/:jobId/completion-report" },
  // Management / System
  { code: "repeat_problems", name: "Repeat Problems", group: "management" },
  { code: "jobs_by_module", name: "Jobs by Product / Module", group: "management" },
  { code: "jobs_by_source", name: "Jobs by Source", group: "management" },
  { code: "expired_receiving_support", name: "Expired Customers Receiving Support", group: "management" },
  { code: "ad_hoc_support", name: "Ad Hoc Support", group: "management" },
  { code: "renewal_conversion", name: "Renewal Conversion", group: "management" },
  { code: "storage_usage", name: "Storage Usage", group: "management" },
  { code: "audit_trail", name: "Audit Trail", group: "management" },
  { code: "sync_diagnostics", name: "Sync Diagnostics", group: "management", route: "/admin/snapshots" },
];

export const REPORT_GROUP_LABEL: Record<ReportGroup, string> = {
  renewal: "Renewal Reports",
  service: "Service Reports",
  management: "Management / System",
};

export interface ReportPermission {
  report_code: string;
  role: ReportRole;
  can_view: boolean;
  can_print: boolean;
  can_export_excel: boolean;
  can_export_csv: boolean;
  data_scope: DataScope;
  view_private_notes: boolean;
  view_financial: boolean;
  view_gps: boolean;
}

/** Administrators always hold every capability; everyone else starts closed. */
export function defaultPermission(code: string, role: ReportRole): ReportPermission {
  const admin = role === "administrator";
  return {
    report_code: code,
    role,
    can_view: admin,
    can_print: admin,
    can_export_excel: admin,
    can_export_csv: admin,
    data_scope: admin ? "all" : "own",
    view_private_notes: admin,
    view_financial: admin,
    view_gps: admin,
  };
}

export function findReport(code: string): ReportDefinition | undefined {
  return REPORT_REGISTRY.find((r) => r.code === code);
}

export type ReportCapability =
  | "can_view"
  | "can_print"
  | "can_export_excel"
  | "can_export_csv"
  | "view_private_notes"
  | "view_financial"
  | "view_gps";

/** Resolve one capability from stored rows, falling back to safe defaults. */
export function hasCapability(
  rows: readonly ReportPermission[],
  code: string,
  role: ReportRole,
  capability: ReportCapability,
): boolean {
  if (role === "administrator") return true;
  const row = rows.find((r) => r.report_code === code && r.role === role);
  if (!row) return defaultPermission(code, role)[capability];
  return Boolean(row[capability]);
}

export function scopeFor(
  rows: readonly ReportPermission[],
  code: string,
  role: ReportRole,
): DataScope {
  if (role === "administrator") return "all";
  const row = rows.find((r) => r.report_code === code && r.role === role);
  return row?.data_scope ?? "own";
}
