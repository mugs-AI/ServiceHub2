// Client-safe entitlement read-model types.
export type EntitlementStatusKey = "due_soon" | "overdue" | "active";

export interface EntitlementRecord {
  id: string;
  customer_code: string;
  customer_name: string | null;
  subscription_category: string | null;
  stock_code: string | null;
  stock_name: string | null;
  latest_document_no: string | null;
  latest_document_date: string | null;
  contract_start_date: string | null;
  expiry_date: string | null;
  remaining_days: number | null;
  subscription_status: string | null;
}
