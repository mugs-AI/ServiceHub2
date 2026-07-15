export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      customer_contract_snapshots: {
        Row: {
          calculation_error: string | null
          contract_days: number | null
          contract_start_date: string | null
          contract_status: string
          created_at: string
          customer_code: string
          expiry_date: string | null
          id: string
          is_stale: boolean
          last_calculated_at: string | null
          latest_document_date: string | null
          latest_document_no: string | null
          latest_document_type: string | null
          n3_customer_id: string | null
          n3_document_id: string | null
          n3_stock_id: string | null
          remaining_days: number | null
          renewal_stock_code: string | null
          tenant_code: string
          updated_at: string
        }
        Insert: {
          calculation_error?: string | null
          contract_days?: number | null
          contract_start_date?: string | null
          contract_status?: string
          created_at?: string
          customer_code: string
          expiry_date?: string | null
          id?: string
          is_stale?: boolean
          last_calculated_at?: string | null
          latest_document_date?: string | null
          latest_document_no?: string | null
          latest_document_type?: string | null
          n3_customer_id?: string | null
          n3_document_id?: string | null
          n3_stock_id?: string | null
          remaining_days?: number | null
          renewal_stock_code?: string | null
          tenant_code: string
          updated_at?: string
        }
        Update: {
          calculation_error?: string | null
          contract_days?: number | null
          contract_start_date?: string | null
          contract_status?: string
          created_at?: string
          customer_code?: string
          expiry_date?: string | null
          id?: string
          is_stale?: boolean
          last_calculated_at?: string | null
          latest_document_date?: string | null
          latest_document_no?: string | null
          latest_document_type?: string | null
          n3_customer_id?: string | null
          n3_document_id?: string | null
          n3_stock_id?: string | null
          remaining_days?: number | null
          renewal_stock_code?: string | null
          tenant_code?: string
          updated_at?: string
        }
        Relationships: []
      }
      customer_snapshots: {
        Row: {
          address: string | null
          contact_person: string | null
          created_at: string
          customer_code: string
          customer_name: string | null
          email: string | null
          id: string
          last_synced_at: string | null
          n3_customer_id: string | null
          n3_status: string | null
          phone: string | null
          sync_status: string
          tenant_code: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          contact_person?: string | null
          created_at?: string
          customer_code: string
          customer_name?: string | null
          email?: string | null
          id?: string
          last_synced_at?: string | null
          n3_customer_id?: string | null
          n3_status?: string | null
          phone?: string | null
          sync_status?: string
          tenant_code: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          contact_person?: string | null
          created_at?: string
          customer_code?: string
          customer_name?: string | null
          email?: string | null
          id?: string
          last_synced_at?: string | null
          n3_customer_id?: string | null
          n3_status?: string | null
          phone?: string | null
          sync_status?: string
          tenant_code?: string
          updated_at?: string
        }
        Relationships: []
      }
      customer_subscription_snapshots: {
        Row: {
          calculation_error: string | null
          contract_start_date: string | null
          created_at: string
          customer_code: string
          customer_name: string | null
          expiry_date: string | null
          id: string
          is_stale: boolean
          last_calculated_at: string | null
          latest_document_date: string | null
          latest_document_no: string | null
          latest_source_document_id: string | null
          latest_source_line_id: string | null
          latest_source_type: string | null
          n3_customer_id: string | null
          n3_stock_id: string | null
          raw_payload: Json | null
          remaining_days: number | null
          renewal_cycle_unit: string | null
          renewal_cycle_value: number | null
          stock_code: string | null
          stock_name: string | null
          subscription_category: string
          subscription_status: string
          tenant_code: string
          updated_at: string
        }
        Insert: {
          calculation_error?: string | null
          contract_start_date?: string | null
          created_at?: string
          customer_code: string
          customer_name?: string | null
          expiry_date?: string | null
          id?: string
          is_stale?: boolean
          last_calculated_at?: string | null
          latest_document_date?: string | null
          latest_document_no?: string | null
          latest_source_document_id?: string | null
          latest_source_line_id?: string | null
          latest_source_type?: string | null
          n3_customer_id?: string | null
          n3_stock_id?: string | null
          raw_payload?: Json | null
          remaining_days?: number | null
          renewal_cycle_unit?: string | null
          renewal_cycle_value?: number | null
          stock_code?: string | null
          stock_name?: string | null
          subscription_category: string
          subscription_status?: string
          tenant_code: string
          updated_at?: string
        }
        Update: {
          calculation_error?: string | null
          contract_start_date?: string | null
          created_at?: string
          customer_code?: string
          customer_name?: string | null
          expiry_date?: string | null
          id?: string
          is_stale?: boolean
          last_calculated_at?: string | null
          latest_document_date?: string | null
          latest_document_no?: string | null
          latest_source_document_id?: string | null
          latest_source_line_id?: string | null
          latest_source_type?: string | null
          n3_customer_id?: string | null
          n3_stock_id?: string | null
          raw_payload?: Json | null
          remaining_days?: number | null
          renewal_cycle_unit?: string | null
          renewal_cycle_value?: number | null
          stock_code?: string | null
          stock_name?: string | null
          subscription_category?: string
          subscription_status?: string
          tenant_code?: string
          updated_at?: string
        }
        Relationships: []
      }
      delivery_order_line_snapshots: {
        Row: {
          created_at: string
          customer_code: string | null
          customer_code_at_transaction: string | null
          customer_name: string | null
          customer_name_at_transaction: string | null
          description: string | null
          document_date: string | null
          document_no: string | null
          document_status: string | null
          has_stock_code: boolean
          id: string
          is_deleted_in_source: boolean
          is_void: boolean
          is_void_source: boolean
          last_seen_at: string
          last_synced_at: string
          line_no: number | null
          line_type: string
          n3_customer_id: string | null
          n3_document_id: string
          n3_line_id: string
          n3_stock_id: string | null
          parent_line_id: string | null
          quantity: number | null
          source_line_order: number | null
          stock_code: string | null
          stock_code_at_transaction: string | null
          stock_name: string | null
          stock_name_at_transaction: string | null
          tenant_code: string
          uom: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_code?: string | null
          customer_code_at_transaction?: string | null
          customer_name?: string | null
          customer_name_at_transaction?: string | null
          description?: string | null
          document_date?: string | null
          document_no?: string | null
          document_status?: string | null
          has_stock_code?: boolean
          id?: string
          is_deleted_in_source?: boolean
          is_void?: boolean
          is_void_source?: boolean
          last_seen_at?: string
          last_synced_at?: string
          line_no?: number | null
          line_type?: string
          n3_customer_id?: string | null
          n3_document_id: string
          n3_line_id: string
          n3_stock_id?: string | null
          parent_line_id?: string | null
          quantity?: number | null
          source_line_order?: number | null
          stock_code?: string | null
          stock_code_at_transaction?: string | null
          stock_name?: string | null
          stock_name_at_transaction?: string | null
          tenant_code: string
          uom?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_code?: string | null
          customer_code_at_transaction?: string | null
          customer_name?: string | null
          customer_name_at_transaction?: string | null
          description?: string | null
          document_date?: string | null
          document_no?: string | null
          document_status?: string | null
          has_stock_code?: boolean
          id?: string
          is_deleted_in_source?: boolean
          is_void?: boolean
          is_void_source?: boolean
          last_seen_at?: string
          last_synced_at?: string
          line_no?: number | null
          line_type?: string
          n3_customer_id?: string | null
          n3_document_id?: string
          n3_line_id?: string
          n3_stock_id?: string | null
          parent_line_id?: string | null
          quantity?: number | null
          source_line_order?: number | null
          stock_code?: string | null
          stock_code_at_transaction?: string | null
          stock_name?: string | null
          stock_name_at_transaction?: string | null
          tenant_code?: string
          uom?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      general_settings: {
        Row: {
          assigned_user_label: string
          created_at: string
          default_assignment_mode: string
          due_soon_days: number
          extra: Json
          tenant_code: string
          updated_at: string
        }
        Insert: {
          assigned_user_label?: string
          created_at?: string
          default_assignment_mode?: string
          due_soon_days?: number
          extra?: Json
          tenant_code: string
          updated_at?: string
        }
        Update: {
          assigned_user_label?: string
          created_at?: string
          default_assignment_mode?: string
          due_soon_days?: number
          extra?: Json
          tenant_code?: string
          updated_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          is_read: boolean
          message: string | null
          notification_type: string
          related_id: string | null
          related_module: string | null
          tenant_code: string
          title: string
          user_email: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string | null
          notification_type: string
          related_id?: string | null
          related_module?: string | null
          tenant_code: string
          title: string
          user_email: string
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string | null
          notification_type?: string
          related_id?: string | null
          related_module?: string | null
          tenant_code?: string
          title?: string
          user_email?: string
        }
        Relationships: []
      }
      renewal_stock_mappings: {
        Row: {
          contract_days: number | null
          created_at: string
          id: string
          is_active: boolean
          n3_stock_id: string | null
          renewal_cycle_unit: string | null
          renewal_cycle_value: number | null
          service_type: string
          stock_code: string
          stock_name: string | null
          subscription_category: string | null
          tenant_code: string
          updated_at: string
        }
        Insert: {
          contract_days?: number | null
          created_at?: string
          id?: string
          is_active?: boolean
          n3_stock_id?: string | null
          renewal_cycle_unit?: string | null
          renewal_cycle_value?: number | null
          service_type: string
          stock_code: string
          stock_name?: string | null
          subscription_category?: string | null
          tenant_code: string
          updated_at?: string
        }
        Update: {
          contract_days?: number | null
          created_at?: string
          id?: string
          is_active?: boolean
          n3_stock_id?: string | null
          renewal_cycle_unit?: string | null
          renewal_cycle_value?: number | null
          service_type?: string
          stock_code?: string
          stock_name?: string | null
          subscription_category?: string | null
          tenant_code?: string
          updated_at?: string
        }
        Relationships: []
      }
      report_access_rules: {
        Row: {
          allow_excel: boolean
          allow_print: boolean
          created_at: string
          display_order: number
          id: string
          is_active: boolean
          report_code: string
          report_name: string
          tenant_code: string
          updated_at: string
          visible_to_normal_users: boolean
        }
        Insert: {
          allow_excel?: boolean
          allow_print?: boolean
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          report_code: string
          report_name: string
          tenant_code: string
          updated_at?: string
          visible_to_normal_users?: boolean
        }
        Update: {
          allow_excel?: boolean
          allow_print?: boolean
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          report_code?: string
          report_name?: string
          tenant_code?: string
          updated_at?: string
          visible_to_normal_users?: boolean
        }
        Relationships: []
      }
      sales_invoice_line_snapshots: {
        Row: {
          created_at: string
          customer_code: string | null
          customer_code_at_transaction: string | null
          customer_name: string | null
          customer_name_at_transaction: string | null
          description: string | null
          document_date: string | null
          document_no: string | null
          document_status: string | null
          has_stock_code: boolean
          id: string
          is_deleted_in_source: boolean
          is_void: boolean
          is_void_source: boolean
          last_seen_at: string
          last_synced_at: string
          line_no: number | null
          line_type: string
          n3_customer_id: string | null
          n3_document_id: string
          n3_line_id: string
          n3_stock_id: string | null
          parent_line_id: string | null
          quantity: number | null
          source_line_order: number | null
          stock_code: string | null
          stock_code_at_transaction: string | null
          stock_name: string | null
          stock_name_at_transaction: string | null
          tenant_code: string
          uom: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_code?: string | null
          customer_code_at_transaction?: string | null
          customer_name?: string | null
          customer_name_at_transaction?: string | null
          description?: string | null
          document_date?: string | null
          document_no?: string | null
          document_status?: string | null
          has_stock_code?: boolean
          id?: string
          is_deleted_in_source?: boolean
          is_void?: boolean
          is_void_source?: boolean
          last_seen_at?: string
          last_synced_at?: string
          line_no?: number | null
          line_type?: string
          n3_customer_id?: string | null
          n3_document_id: string
          n3_line_id: string
          n3_stock_id?: string | null
          parent_line_id?: string | null
          quantity?: number | null
          source_line_order?: number | null
          stock_code?: string | null
          stock_code_at_transaction?: string | null
          stock_name?: string | null
          stock_name_at_transaction?: string | null
          tenant_code: string
          uom?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_code?: string | null
          customer_code_at_transaction?: string | null
          customer_name?: string | null
          customer_name_at_transaction?: string | null
          description?: string | null
          document_date?: string | null
          document_no?: string | null
          document_status?: string | null
          has_stock_code?: boolean
          id?: string
          is_deleted_in_source?: boolean
          is_void?: boolean
          is_void_source?: boolean
          last_seen_at?: string
          last_synced_at?: string
          line_no?: number | null
          line_type?: string
          n3_customer_id?: string | null
          n3_document_id?: string
          n3_line_id?: string
          n3_stock_id?: string | null
          parent_line_id?: string | null
          quantity?: number | null
          source_line_order?: number | null
          stock_code?: string | null
          stock_code_at_transaction?: string | null
          stock_name?: string | null
          stock_name_at_transaction?: string | null
          tenant_code?: string
          uom?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      service_hub_admins: {
        Row: {
          created_at: string
          email: string
          granted_by: string | null
          id: string
          is_bootstrap: boolean
          tenant_code: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          granted_by?: string | null
          id?: string
          is_bootstrap?: boolean
          tenant_code: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          granted_by?: string | null
          id?: string
          is_bootstrap?: boolean
          tenant_code?: string
          updated_at?: string
        }
        Relationships: []
      }
      snapshot_health: {
        Row: {
          calculation_errors: number
          created_at: string
          error_message: string | null
          health_status: string
          id: string
          last_attempt: string | null
          last_successful_sync: string | null
          records_failed: number
          records_inserted: number
          records_total: number
          records_updated: number
          snapshot_type: string
          stale_records: number
          tenant_code: string
          updated_at: string
          warning_message: string | null
        }
        Insert: {
          calculation_errors?: number
          created_at?: string
          error_message?: string | null
          health_status?: string
          id?: string
          last_attempt?: string | null
          last_successful_sync?: string | null
          records_failed?: number
          records_inserted?: number
          records_total?: number
          records_updated?: number
          snapshot_type: string
          stale_records?: number
          tenant_code: string
          updated_at?: string
          warning_message?: string | null
        }
        Update: {
          calculation_errors?: number
          created_at?: string
          error_message?: string | null
          health_status?: string
          id?: string
          last_attempt?: string | null
          last_successful_sync?: string | null
          records_failed?: number
          records_inserted?: number
          records_total?: number
          records_updated?: number
          snapshot_type?: string
          stale_records?: number
          tenant_code?: string
          updated_at?: string
          warning_message?: string | null
        }
        Relationships: []
      }
      snapshot_identity_backfill: {
        Row: {
          confidence: string
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          match_method: string
          migration_status: string
          n3_id: string | null
          natural_key: string | null
          notes: string | null
          tenant_code: string
        }
        Insert: {
          confidence: string
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          match_method: string
          migration_status: string
          n3_id?: string | null
          natural_key?: string | null
          notes?: string | null
          tenant_code: string
        }
        Update: {
          confidence?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          match_method?: string
          migration_status?: string
          n3_id?: string | null
          natural_key?: string | null
          notes?: string | null
          tenant_code?: string
        }
        Relationships: []
      }
      snapshot_sync_logs: {
        Row: {
          completed_at: string | null
          created_at: string
          details: Json | null
          duration_ms: number | null
          error_message: string | null
          failed_count: number
          heartbeat_at: string | null
          id: string
          inserted_count: number
          progress: Json | null
          skipped_count: number
          snapshot_type: string
          stage: string | null
          started_at: string
          status: string
          tenant_code: string
          updated_count: number
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          details?: Json | null
          duration_ms?: number | null
          error_message?: string | null
          failed_count?: number
          heartbeat_at?: string | null
          id?: string
          inserted_count?: number
          progress?: Json | null
          skipped_count?: number
          snapshot_type: string
          stage?: string | null
          started_at?: string
          status?: string
          tenant_code: string
          updated_count?: number
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          details?: Json | null
          duration_ms?: number | null
          error_message?: string | null
          failed_count?: number
          heartbeat_at?: string | null
          id?: string
          inserted_count?: number
          progress?: Json | null
          skipped_count?: number
          snapshot_type?: string
          stage?: string | null
          started_at?: string
          status?: string
          tenant_code?: string
          updated_count?: number
        }
        Relationships: []
      }
      stock_snapshots: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          last_synced_at: string | null
          n3_stock_id: string | null
          stock_code: string
          stock_name: string | null
          tenant_code: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          last_synced_at?: string | null
          n3_stock_id?: string | null
          stock_code: string
          stock_name?: string | null
          tenant_code: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          last_synced_at?: string | null
          n3_stock_id?: string | null
          stock_code?: string
          stock_name?: string | null
          tenant_code?: string
          updated_at?: string
        }
        Relationships: []
      }
      subscription_categories: {
        Row: {
          created_at: string
          display_order: number
          id: string
          is_active: boolean
          is_system: boolean
          name: string
          tenant_code: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          is_system?: boolean
          name: string
          tenant_code: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          is_system?: boolean
          name?: string
          tenant_code?: string
          updated_at?: string
        }
        Relationships: []
      }
      subscription_renewal_events: {
        Row: {
          created_at: string
          customer_code: string
          customer_code_at_event: string | null
          customer_name: string | null
          customer_name_at_event: string | null
          document_no_at_event: string | null
          expiry_date: string
          id: string
          is_source_void: boolean
          n3_customer_id: string | null
          n3_document_id: string | null
          n3_line_id: string | null
          n3_stock_id: string | null
          renewal_cycle_unit: string
          renewal_cycle_value: number
          source_document_date: string
          source_document_id: string
          source_document_no: string | null
          source_line_id: string
          source_type: string
          start_date: string
          stock_code: string
          stock_code_at_event: string | null
          stock_name: string | null
          stock_name_at_event: string | null
          subscription_category_id: string | null
          subscription_category_name: string
          tenant_code: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_code: string
          customer_code_at_event?: string | null
          customer_name?: string | null
          customer_name_at_event?: string | null
          document_no_at_event?: string | null
          expiry_date: string
          id?: string
          is_source_void?: boolean
          n3_customer_id?: string | null
          n3_document_id?: string | null
          n3_line_id?: string | null
          n3_stock_id?: string | null
          renewal_cycle_unit: string
          renewal_cycle_value: number
          source_document_date: string
          source_document_id: string
          source_document_no?: string | null
          source_line_id: string
          source_type: string
          start_date: string
          stock_code: string
          stock_code_at_event?: string | null
          stock_name?: string | null
          stock_name_at_event?: string | null
          subscription_category_id?: string | null
          subscription_category_name: string
          tenant_code: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_code?: string
          customer_code_at_event?: string | null
          customer_name?: string | null
          customer_name_at_event?: string | null
          document_no_at_event?: string | null
          expiry_date?: string
          id?: string
          is_source_void?: boolean
          n3_customer_id?: string | null
          n3_document_id?: string | null
          n3_line_id?: string | null
          n3_stock_id?: string | null
          renewal_cycle_unit?: string
          renewal_cycle_value?: number
          source_document_date?: string
          source_document_id?: string
          source_document_no?: string | null
          source_line_id?: string
          source_type?: string
          start_date?: string
          stock_code?: string
          stock_code_at_event?: string | null
          stock_name?: string | null
          stock_name_at_event?: string | null
          subscription_category_id?: string | null
          subscription_category_name?: string
          tenant_code?: string
          updated_at?: string
        }
        Relationships: []
      }
      sync_locks: {
        Row: {
          acquired_at: string
          acquired_by: string | null
          expires_at: string | null
          heartbeat_at: string | null
          run_id: string | null
          snapshot_type: string
          stage: string | null
          status: string
          sync_log_id: string | null
          tenant_code: string
        }
        Insert: {
          acquired_at?: string
          acquired_by?: string | null
          expires_at?: string | null
          heartbeat_at?: string | null
          run_id?: string | null
          snapshot_type: string
          stage?: string | null
          status?: string
          sync_log_id?: string | null
          tenant_code: string
        }
        Update: {
          acquired_at?: string
          acquired_by?: string | null
          expires_at?: string | null
          heartbeat_at?: string | null
          run_id?: string | null
          snapshot_type?: string
          stage?: string | null
          status?: string
          sync_log_id?: string | null
          tenant_code?: string
        }
        Relationships: []
      }
      sync_orchestrations: {
        Row: {
          completed_at: string | null
          created_at: string
          current_stage: string | null
          current_stage_index: number
          current_stage_progress: Json
          customer_result: Json | null
          customer_run_id: string | null
          id: string
          last_heartbeat_at: string
          orchestration_type: string
          overall_status: string
          safe_error_summary: string | null
          started_at: string
          stock_result: Json | null
          stock_run_id: string | null
          subscription_result: Json | null
          subscription_run_id: string | null
          tenant_code: string
          total_duration_ms: number | null
          total_stages: number
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          current_stage?: string | null
          current_stage_index?: number
          current_stage_progress?: Json
          customer_result?: Json | null
          customer_run_id?: string | null
          id?: string
          last_heartbeat_at?: string
          orchestration_type?: string
          overall_status?: string
          safe_error_summary?: string | null
          started_at?: string
          stock_result?: Json | null
          stock_run_id?: string | null
          subscription_result?: Json | null
          subscription_run_id?: string | null
          tenant_code: string
          total_duration_ms?: number | null
          total_stages?: number
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          current_stage?: string | null
          current_stage_index?: number
          current_stage_progress?: Json
          customer_result?: Json | null
          customer_run_id?: string | null
          id?: string
          last_heartbeat_at?: string
          orchestration_type?: string
          overall_status?: string
          safe_error_summary?: string | null
          started_at?: string
          stock_result?: Json | null
          stock_run_id?: string | null
          subscription_result?: Json | null
          subscription_run_id?: string | null
          tenant_code?: string
          total_duration_ms?: number | null
          total_stages?: number
          updated_at?: string
        }
        Relationships: []
      }
      sync_runs: {
        Row: {
          completed_at: string | null
          current_stage: string | null
          current_stage_index: number
          duration_ms: number | null
          error_message: string | null
          heartbeat_at: string
          id: string
          kind: string
          progress: Json
          started_at: string
          status: string
          summary: Json | null
          tenant_code: string
          total_stages: number
        }
        Insert: {
          completed_at?: string | null
          current_stage?: string | null
          current_stage_index?: number
          duration_ms?: number | null
          error_message?: string | null
          heartbeat_at?: string
          id?: string
          kind: string
          progress?: Json
          started_at?: string
          status: string
          summary?: Json | null
          tenant_code: string
          total_stages?: number
        }
        Update: {
          completed_at?: string | null
          current_stage?: string | null
          current_stage_index?: number
          duration_ms?: number | null
          error_message?: string | null
          heartbeat_at?: string
          id?: string
          kind?: string
          progress?: Json
          started_at?: string
          status?: string
          summary?: Json | null
          tenant_code?: string
          total_stages?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
