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
      google_drive_audit_log: {
        Row: {
          action: string
          actor_name: string | null
          actor_user_id: string | null
          created_at: string
          detail: Json
          id: string
          tenant_code: string
        }
        Insert: {
          action: string
          actor_name?: string | null
          actor_user_id?: string | null
          created_at?: string
          detail?: Json
          id?: string
          tenant_code: string
        }
        Update: {
          action?: string
          actor_name?: string | null
          actor_user_id?: string | null
          created_at?: string
          detail?: Json
          id?: string
          tenant_code?: string
        }
        Relationships: []
      }
      google_drive_connections: {
        Row: {
          access_token_ciphertext: string | null
          access_token_expires_at: string | null
          cipher_version: number
          connected_by_name: string | null
          connected_by_user_id: string | null
          created_at: string
          drive_context: string | null
          drive_id: string | null
          google_account_email: string | null
          google_account_sub: string | null
          id: string
          is_active: boolean
          last_error: string | null
          last_test_result: string | null
          last_tested_at: string | null
          refresh_token_ciphertext: string | null
          root_folder_id: string | null
          root_folder_name: string | null
          scopes: string[]
          sharing_confirmed_at: string | null
          sharing_confirmed_by_name: string | null
          sharing_confirmed_by_user_id: string | null
          sharing_policy: string
          status: string
          tenant_code: string
          updated_at: string
        }
        Insert: {
          access_token_ciphertext?: string | null
          access_token_expires_at?: string | null
          cipher_version?: number
          connected_by_name?: string | null
          connected_by_user_id?: string | null
          created_at?: string
          drive_context?: string | null
          drive_id?: string | null
          google_account_email?: string | null
          google_account_sub?: string | null
          id?: string
          is_active?: boolean
          last_error?: string | null
          last_test_result?: string | null
          last_tested_at?: string | null
          refresh_token_ciphertext?: string | null
          root_folder_id?: string | null
          root_folder_name?: string | null
          scopes?: string[]
          sharing_confirmed_at?: string | null
          sharing_confirmed_by_name?: string | null
          sharing_confirmed_by_user_id?: string | null
          sharing_policy?: string
          status?: string
          tenant_code: string
          updated_at?: string
        }
        Update: {
          access_token_ciphertext?: string | null
          access_token_expires_at?: string | null
          cipher_version?: number
          connected_by_name?: string | null
          connected_by_user_id?: string | null
          created_at?: string
          drive_context?: string | null
          drive_id?: string | null
          google_account_email?: string | null
          google_account_sub?: string | null
          id?: string
          is_active?: boolean
          last_error?: string | null
          last_test_result?: string | null
          last_tested_at?: string | null
          refresh_token_ciphertext?: string | null
          root_folder_id?: string | null
          root_folder_name?: string | null
          scopes?: string[]
          sharing_confirmed_at?: string | null
          sharing_confirmed_by_name?: string | null
          sharing_confirmed_by_user_id?: string | null
          sharing_policy?: string
          status?: string
          tenant_code?: string
          updated_at?: string
        }
        Relationships: []
      }
      google_drive_oauth_states: {
        Row: {
          actor_name: string | null
          actor_user_id: string | null
          code_verifier_ciphertext: string
          created_at: string
          expires_at: string
          id: string
          purpose: string
          redirect_uri: string
          state_hash: string
          tenant_code: string
          updated_at: string
          used_at: string | null
        }
        Insert: {
          actor_name?: string | null
          actor_user_id?: string | null
          code_verifier_ciphertext: string
          created_at?: string
          expires_at: string
          id?: string
          purpose?: string
          redirect_uri: string
          state_hash: string
          tenant_code: string
          updated_at?: string
          used_at?: string | null
        }
        Update: {
          actor_name?: string | null
          actor_user_id?: string | null
          code_verifier_ciphertext?: string
          created_at?: string
          expires_at?: string
          id?: string
          purpose?: string
          redirect_uri?: string
          state_hash?: string
          tenant_code?: string
          updated_at?: string
          used_at?: string | null
        }
        Relationships: []
      }
      job_number_sequences: {
        Row: {
          date_key: string
          last_seq: number
          tenant_code: string
          updated_at: string
        }
        Insert: {
          date_key: string
          last_seq?: number
          tenant_code: string
          updated_at?: string
        }
        Update: {
          date_key?: string
          last_seq?: number
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
          n3_stock_id: string
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
          n3_stock_id: string
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
          n3_stock_id?: string
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
      report_role_permissions: {
        Row: {
          can_export_csv: boolean
          can_export_excel: boolean
          can_print: boolean
          can_view: boolean
          created_at: string
          data_scope: string
          id: string
          report_code: string
          role: string
          tenant_code: string
          updated_at: string
          view_financial: boolean
          view_gps: boolean
          view_private_notes: boolean
        }
        Insert: {
          can_export_csv?: boolean
          can_export_excel?: boolean
          can_print?: boolean
          can_view?: boolean
          created_at?: string
          data_scope?: string
          id?: string
          report_code: string
          role: string
          tenant_code: string
          updated_at?: string
          view_financial?: boolean
          view_gps?: boolean
          view_private_notes?: boolean
        }
        Update: {
          can_export_csv?: boolean
          can_export_excel?: boolean
          can_print?: boolean
          can_view?: boolean
          created_at?: string
          data_scope?: string
          id?: string
          report_code?: string
          role?: string
          tenant_code?: string
          updated_at?: string
          view_financial?: boolean
          view_gps?: boolean
          view_private_notes?: boolean
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
      service_job_activity_log: {
        Row: {
          created_at: string
          event_type: string
          id: string
          metadata_json: Json | null
          new_value: string | null
          note: string | null
          old_value: string | null
          performed_by_name_snapshot: string | null
          performed_by_user_id: string | null
          service_job_id: string
          tenant_code: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          metadata_json?: Json | null
          new_value?: string | null
          note?: string | null
          old_value?: string | null
          performed_by_name_snapshot?: string | null
          performed_by_user_id?: string | null
          service_job_id: string
          tenant_code: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          metadata_json?: Json | null
          new_value?: string | null
          note?: string | null
          old_value?: string | null
          performed_by_name_snapshot?: string | null
          performed_by_user_id?: string | null
          service_job_id?: string
          tenant_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_job_activity_log_service_job_id_fkey"
            columns: ["service_job_id"]
            isOneToOne: false
            referencedRelation: "service_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      service_job_assignment_history: {
        Row: {
          action: string
          assigned_user_code_snapshot: string | null
          assigned_user_email_snapshot: string | null
          assigned_user_id: string | null
          assigned_user_name_snapshot: string | null
          id: string
          performed_at: string
          performed_by_name_snapshot: string | null
          performed_by_user_id: string | null
          previous_assigned_user_id: string | null
          previous_assigned_user_name_snapshot: string | null
          service_job_id: string
          tenant_code: string
        }
        Insert: {
          action: string
          assigned_user_code_snapshot?: string | null
          assigned_user_email_snapshot?: string | null
          assigned_user_id?: string | null
          assigned_user_name_snapshot?: string | null
          id?: string
          performed_at?: string
          performed_by_name_snapshot?: string | null
          performed_by_user_id?: string | null
          previous_assigned_user_id?: string | null
          previous_assigned_user_name_snapshot?: string | null
          service_job_id: string
          tenant_code: string
        }
        Update: {
          action?: string
          assigned_user_code_snapshot?: string | null
          assigned_user_email_snapshot?: string | null
          assigned_user_id?: string | null
          assigned_user_name_snapshot?: string | null
          id?: string
          performed_at?: string
          performed_by_name_snapshot?: string | null
          performed_by_user_id?: string | null
          previous_assigned_user_id?: string | null
          previous_assigned_user_name_snapshot?: string | null
          service_job_id?: string
          tenant_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_job_assignment_history_service_job_id_fkey"
            columns: ["service_job_id"]
            isOneToOne: false
            referencedRelation: "service_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      service_job_attachments: {
        Row: {
          attachment_type: string
          availability_status: string
          checksum: string | null
          created_at: string
          deleted_at: string | null
          deleted_by_name_snapshot: string | null
          deleted_by_user_id: string | null
          external_file_id: string | null
          file_name: string
          file_size: number
          id: string
          is_deleted: boolean
          mime_type: string
          service_job_id: string
          storage_connection_id: string | null
          storage_container: string | null
          storage_path: string
          storage_provider: string
          tenant_code: string
          uploaded_by_name_snapshot: string | null
          uploaded_by_user_id: string | null
          visibility: string
        }
        Insert: {
          attachment_type?: string
          availability_status?: string
          checksum?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by_name_snapshot?: string | null
          deleted_by_user_id?: string | null
          external_file_id?: string | null
          file_name: string
          file_size: number
          id?: string
          is_deleted?: boolean
          mime_type: string
          service_job_id: string
          storage_connection_id?: string | null
          storage_container?: string | null
          storage_path: string
          storage_provider?: string
          tenant_code: string
          uploaded_by_name_snapshot?: string | null
          uploaded_by_user_id?: string | null
          visibility?: string
        }
        Update: {
          attachment_type?: string
          availability_status?: string
          checksum?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by_name_snapshot?: string | null
          deleted_by_user_id?: string | null
          external_file_id?: string | null
          file_name?: string
          file_size?: number
          id?: string
          is_deleted?: boolean
          mime_type?: string
          service_job_id?: string
          storage_connection_id?: string | null
          storage_container?: string | null
          storage_path?: string
          storage_provider?: string
          tenant_code?: string
          uploaded_by_name_snapshot?: string | null
          uploaded_by_user_id?: string | null
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_job_attachments_service_job_id_fkey"
            columns: ["service_job_id"]
            isOneToOne: false
            referencedRelation: "service_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      service_job_cancellation_requests: {
        Row: {
          approval_mode_at_request: string
          created_at: string
          decided_at: string | null
          decided_by_name_snapshot: string | null
          decided_by_user_id: string | null
          decision: string | null
          decision_note: string | null
          id: string
          prior_status: string
          reason: string
          requested_at: string
          requested_by_name_snapshot: string | null
          requested_by_user_id: string | null
          requester_policy_at_request: string
          service_job_id: string
          status: string
          tenant_code: string
          updated_at: string
        }
        Insert: {
          approval_mode_at_request: string
          created_at?: string
          decided_at?: string | null
          decided_by_name_snapshot?: string | null
          decided_by_user_id?: string | null
          decision?: string | null
          decision_note?: string | null
          id?: string
          prior_status: string
          reason: string
          requested_at?: string
          requested_by_name_snapshot?: string | null
          requested_by_user_id?: string | null
          requester_policy_at_request: string
          service_job_id: string
          status?: string
          tenant_code: string
          updated_at?: string
        }
        Update: {
          approval_mode_at_request?: string
          created_at?: string
          decided_at?: string | null
          decided_by_name_snapshot?: string | null
          decided_by_user_id?: string | null
          decision?: string | null
          decision_note?: string | null
          id?: string
          prior_status?: string
          reason?: string
          requested_at?: string
          requested_by_name_snapshot?: string | null
          requested_by_user_id?: string | null
          requester_policy_at_request?: string
          service_job_id?: string
          status?: string
          tenant_code?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_job_cancellation_requests_service_job_id_fkey"
            columns: ["service_job_id"]
            isOneToOne: false
            referencedRelation: "service_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      service_job_comments: {
        Row: {
          author_name_snapshot: string | null
          author_user_id: string | null
          body: string
          created_at: string
          id: string
          service_job_id: string
          tenant_code: string
          visibility: string
        }
        Insert: {
          author_name_snapshot?: string | null
          author_user_id?: string | null
          body: string
          created_at?: string
          id?: string
          service_job_id: string
          tenant_code: string
          visibility?: string
        }
        Update: {
          author_name_snapshot?: string | null
          author_user_id?: string | null
          body?: string
          created_at?: string
          id?: string
          service_job_id?: string
          tenant_code?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_job_comments_service_job_id_fkey"
            columns: ["service_job_id"]
            isOneToOne: false
            referencedRelation: "service_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      service_job_completions: {
        Row: {
          ack_at: string | null
          ack_confirmed: boolean
          ack_customer_name: string | null
          ack_customer_role: string | null
          ack_evidence_reference: string | null
          ack_method: string | null
          ack_remark: string | null
          action_taken: string | null
          checklist: Json
          created_at: string
          diagnosis: string | null
          follow_up_date: string | null
          follow_up_required: boolean
          id: string
          internal_completion_note: string | null
          is_final: boolean
          outstanding_issue: string | null
          resolution_summary: string | null
          service_job_id: string
          signature_attachment_id: string | null
          signature_data_url: string | null
          signature_signed_at: string | null
          signature_waived: boolean
          signature_waived_by_name_snapshot: string | null
          signature_waived_by_user_id: string | null
          signature_waiver_reason: string | null
          software_module: string | null
          tenant_code: string
          test_result: string | null
          updated_at: string
          version_after: string | null
          work_performed: string | null
        }
        Insert: {
          ack_at?: string | null
          ack_confirmed?: boolean
          ack_customer_name?: string | null
          ack_customer_role?: string | null
          ack_evidence_reference?: string | null
          ack_method?: string | null
          ack_remark?: string | null
          action_taken?: string | null
          checklist?: Json
          created_at?: string
          diagnosis?: string | null
          follow_up_date?: string | null
          follow_up_required?: boolean
          id?: string
          internal_completion_note?: string | null
          is_final?: boolean
          outstanding_issue?: string | null
          resolution_summary?: string | null
          service_job_id: string
          signature_attachment_id?: string | null
          signature_data_url?: string | null
          signature_signed_at?: string | null
          signature_waived?: boolean
          signature_waived_by_name_snapshot?: string | null
          signature_waived_by_user_id?: string | null
          signature_waiver_reason?: string | null
          software_module?: string | null
          tenant_code: string
          test_result?: string | null
          updated_at?: string
          version_after?: string | null
          work_performed?: string | null
        }
        Update: {
          ack_at?: string | null
          ack_confirmed?: boolean
          ack_customer_name?: string | null
          ack_customer_role?: string | null
          ack_evidence_reference?: string | null
          ack_method?: string | null
          ack_remark?: string | null
          action_taken?: string | null
          checklist?: Json
          created_at?: string
          diagnosis?: string | null
          follow_up_date?: string | null
          follow_up_required?: boolean
          id?: string
          internal_completion_note?: string | null
          is_final?: boolean
          outstanding_issue?: string | null
          resolution_summary?: string | null
          service_job_id?: string
          signature_attachment_id?: string | null
          signature_data_url?: string | null
          signature_signed_at?: string | null
          signature_waived?: boolean
          signature_waived_by_name_snapshot?: string | null
          signature_waived_by_user_id?: string | null
          signature_waiver_reason?: string | null
          software_module?: string | null
          tenant_code?: string
          test_result?: string | null
          updated_at?: string
          version_after?: string | null
          work_performed?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "service_job_completions_service_job_id_fkey"
            columns: ["service_job_id"]
            isOneToOne: true
            referencedRelation: "service_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_job_completions_signature_attachment_id_fkey"
            columns: ["signature_attachment_id"]
            isOneToOne: false
            referencedRelation: "service_job_attachments"
            referencedColumns: ["id"]
          },
        ]
      }
      service_job_schedule_history: {
        Row: {
          action: string
          changed_at: string
          changed_by_name_snapshot: string | null
          changed_by_user_id: string | null
          id: string
          new_end_at: string | null
          new_start_at: string | null
          new_technician_user_id: string | null
          previous_end_at: string | null
          previous_start_at: string | null
          previous_technician_user_id: string | null
          reason: string | null
          service_job_id: string
          tenant_code: string
        }
        Insert: {
          action: string
          changed_at?: string
          changed_by_name_snapshot?: string | null
          changed_by_user_id?: string | null
          id?: string
          new_end_at?: string | null
          new_start_at?: string | null
          new_technician_user_id?: string | null
          previous_end_at?: string | null
          previous_start_at?: string | null
          previous_technician_user_id?: string | null
          reason?: string | null
          service_job_id: string
          tenant_code: string
        }
        Update: {
          action?: string
          changed_at?: string
          changed_by_name_snapshot?: string | null
          changed_by_user_id?: string | null
          id?: string
          new_end_at?: string | null
          new_start_at?: string | null
          new_technician_user_id?: string | null
          previous_end_at?: string | null
          previous_start_at?: string | null
          previous_technician_user_id?: string | null
          reason?: string | null
          service_job_id?: string
          tenant_code?: string
        }
        Relationships: []
      }
      service_job_waiting_periods: {
        Row: {
          contact_method: string | null
          created_at: string
          expected_response_date: string | null
          follow_up_date: string | null
          id: string
          reason: string
          requested_action: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by_name_snapshot: string | null
          resolved_by_user_id: string | null
          service_job_id: string
          started_at: string
          started_by_name_snapshot: string | null
          started_by_user_id: string | null
          tenant_code: string
          updated_at: string
          vendor_contact: string | null
          vendor_name: string | null
          vendor_reference: string | null
          vendor_response: string | null
          vendor_ticket_number: string | null
          visibility: string
          waiting_type: string
        }
        Insert: {
          contact_method?: string | null
          created_at?: string
          expected_response_date?: string | null
          follow_up_date?: string | null
          id?: string
          reason: string
          requested_action?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by_name_snapshot?: string | null
          resolved_by_user_id?: string | null
          service_job_id: string
          started_at?: string
          started_by_name_snapshot?: string | null
          started_by_user_id?: string | null
          tenant_code: string
          updated_at?: string
          vendor_contact?: string | null
          vendor_name?: string | null
          vendor_reference?: string | null
          vendor_response?: string | null
          vendor_ticket_number?: string | null
          visibility?: string
          waiting_type: string
        }
        Update: {
          contact_method?: string | null
          created_at?: string
          expected_response_date?: string | null
          follow_up_date?: string | null
          id?: string
          reason?: string
          requested_action?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by_name_snapshot?: string | null
          resolved_by_user_id?: string | null
          service_job_id?: string
          started_at?: string
          started_by_name_snapshot?: string | null
          started_by_user_id?: string | null
          tenant_code?: string
          updated_at?: string
          vendor_contact?: string | null
          vendor_name?: string | null
          vendor_reference?: string | null
          vendor_response?: string | null
          vendor_ticket_number?: string | null
          visibility?: string
          waiting_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_job_waiting_periods_service_job_id_fkey"
            columns: ["service_job_id"]
            isOneToOne: false
            referencedRelation: "service_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      service_job_work_notes: {
        Row: {
          author_name_snapshot: string | null
          author_user_id: string | null
          body: string
          created_at: string
          id: string
          note_type: string
          service_job_id: string
          tenant_code: string
          visibility: string
        }
        Insert: {
          author_name_snapshot?: string | null
          author_user_id?: string | null
          body: string
          created_at?: string
          id?: string
          note_type: string
          service_job_id: string
          tenant_code: string
          visibility?: string
        }
        Update: {
          author_name_snapshot?: string | null
          author_user_id?: string | null
          body?: string
          created_at?: string
          id?: string
          note_type?: string
          service_job_id?: string
          tenant_code?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_job_work_notes_service_job_id_fkey"
            columns: ["service_job_id"]
            isOneToOne: false
            referencedRelation: "service_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      service_job_work_sessions: {
        Row: {
          created_at: string
          duration_minutes: number | null
          ended_at: string | null
          id: string
          pause_reason: string | null
          service_job_id: string
          started_at: string
          status: string
          technician_name_snapshot: string | null
          technician_user_id: string
          tenant_code: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          duration_minutes?: number | null
          ended_at?: string | null
          id?: string
          pause_reason?: string | null
          service_job_id: string
          started_at?: string
          status?: string
          technician_name_snapshot?: string | null
          technician_user_id: string
          tenant_code: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          duration_minutes?: number | null
          ended_at?: string | null
          id?: string
          pause_reason?: string | null
          service_job_id?: string
          started_at?: string
          status?: string
          technician_name_snapshot?: string | null
          technician_user_id?: string
          tenant_code?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_job_work_sessions_service_job_id_fkey"
            columns: ["service_job_id"]
            isOneToOne: false
            referencedRelation: "service_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      service_jobs: {
        Row: {
          approval_note: string | null
          approval_reason: string | null
          approval_remark_private: string | null
          approval_remark_public: string | null
          approved_at: string | null
          approved_by_name_snapshot: string | null
          approved_by_user_id: string | null
          arrival_note: string | null
          arrived_on_site_at: string | null
          assigned_at: string | null
          assigned_by_name_snapshot: string | null
          assigned_by_user_id: string | null
          assigned_user_code_snapshot: string | null
          assigned_user_email_snapshot: string | null
          assigned_user_id: string | null
          assigned_user_name_snapshot: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by_name_snapshot: string | null
          cancelled_by_user_id: string | null
          completed_at: string | null
          completion_snapshot: Json | null
          contact_email: string | null
          contact_person: string | null
          contact_phone: string | null
          created_at: string
          created_by_name: string | null
          created_by_user_id: string | null
          customer_code_snapshot: string
          customer_name_snapshot: string | null
          deleted_at: string | null
          deleted_by_name_snapshot: string | null
          deleted_by_user_id: string | null
          deletion_reason: string | null
          entitlement_expiry_snapshot: string | null
          entitlement_status_snapshot: string | null
          id: string
          internal_note: string | null
          is_deleted: boolean
          job_number: string
          leave_note: string | null
          left_site_at: string | null
          n3_customer_id: string | null
          n3_stock_id_snapshot: string | null
          priority: string
          problem_description: string
          ready_for_completion_at: string | null
          rejected_at: string | null
          rejected_by_name_snapshot: string | null
          rejected_by_user_id: string | null
          rejection_reason: string | null
          requires_approval: boolean
          schedule_status: string
          schedule_updated_at: string | null
          scheduled_at: string | null
          scheduled_by_name_snapshot: string | null
          scheduled_by_user_id: string | null
          scheduled_end_at: string | null
          scheduled_start_at: string | null
          scheduled_timezone: string
          service_address: string | null
          source: string
          started_at: string | null
          status: string
          stock_code_snapshot: string | null
          subject: string
          subscription_category_snapshot: string | null
          subscription_snapshot_id: string | null
          support_mode: string | null
          tenant_code: string
          total_work_minutes: number
          travel_note: string | null
          travel_started_at: string | null
          updated_at: string
        }
        Insert: {
          approval_note?: string | null
          approval_reason?: string | null
          approval_remark_private?: string | null
          approval_remark_public?: string | null
          approved_at?: string | null
          approved_by_name_snapshot?: string | null
          approved_by_user_id?: string | null
          arrival_note?: string | null
          arrived_on_site_at?: string | null
          assigned_at?: string | null
          assigned_by_name_snapshot?: string | null
          assigned_by_user_id?: string | null
          assigned_user_code_snapshot?: string | null
          assigned_user_email_snapshot?: string | null
          assigned_user_id?: string | null
          assigned_user_name_snapshot?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by_name_snapshot?: string | null
          cancelled_by_user_id?: string | null
          completed_at?: string | null
          completion_snapshot?: Json | null
          contact_email?: string | null
          contact_person?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by_name?: string | null
          created_by_user_id?: string | null
          customer_code_snapshot: string
          customer_name_snapshot?: string | null
          deleted_at?: string | null
          deleted_by_name_snapshot?: string | null
          deleted_by_user_id?: string | null
          deletion_reason?: string | null
          entitlement_expiry_snapshot?: string | null
          entitlement_status_snapshot?: string | null
          id?: string
          internal_note?: string | null
          is_deleted?: boolean
          job_number: string
          leave_note?: string | null
          left_site_at?: string | null
          n3_customer_id?: string | null
          n3_stock_id_snapshot?: string | null
          priority?: string
          problem_description: string
          ready_for_completion_at?: string | null
          rejected_at?: string | null
          rejected_by_name_snapshot?: string | null
          rejected_by_user_id?: string | null
          rejection_reason?: string | null
          requires_approval?: boolean
          schedule_status?: string
          schedule_updated_at?: string | null
          scheduled_at?: string | null
          scheduled_by_name_snapshot?: string | null
          scheduled_by_user_id?: string | null
          scheduled_end_at?: string | null
          scheduled_start_at?: string | null
          scheduled_timezone?: string
          service_address?: string | null
          source?: string
          started_at?: string | null
          status?: string
          stock_code_snapshot?: string | null
          subject: string
          subscription_category_snapshot?: string | null
          subscription_snapshot_id?: string | null
          support_mode?: string | null
          tenant_code: string
          total_work_minutes?: number
          travel_note?: string | null
          travel_started_at?: string | null
          updated_at?: string
        }
        Update: {
          approval_note?: string | null
          approval_reason?: string | null
          approval_remark_private?: string | null
          approval_remark_public?: string | null
          approved_at?: string | null
          approved_by_name_snapshot?: string | null
          approved_by_user_id?: string | null
          arrival_note?: string | null
          arrived_on_site_at?: string | null
          assigned_at?: string | null
          assigned_by_name_snapshot?: string | null
          assigned_by_user_id?: string | null
          assigned_user_code_snapshot?: string | null
          assigned_user_email_snapshot?: string | null
          assigned_user_id?: string | null
          assigned_user_name_snapshot?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by_name_snapshot?: string | null
          cancelled_by_user_id?: string | null
          completed_at?: string | null
          completion_snapshot?: Json | null
          contact_email?: string | null
          contact_person?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by_name?: string | null
          created_by_user_id?: string | null
          customer_code_snapshot?: string
          customer_name_snapshot?: string | null
          deleted_at?: string | null
          deleted_by_name_snapshot?: string | null
          deleted_by_user_id?: string | null
          deletion_reason?: string | null
          entitlement_expiry_snapshot?: string | null
          entitlement_status_snapshot?: string | null
          id?: string
          internal_note?: string | null
          is_deleted?: boolean
          job_number?: string
          leave_note?: string | null
          left_site_at?: string | null
          n3_customer_id?: string | null
          n3_stock_id_snapshot?: string | null
          priority?: string
          problem_description?: string
          ready_for_completion_at?: string | null
          rejected_at?: string | null
          rejected_by_name_snapshot?: string | null
          rejected_by_user_id?: string | null
          rejection_reason?: string | null
          requires_approval?: boolean
          schedule_status?: string
          schedule_updated_at?: string | null
          scheduled_at?: string | null
          scheduled_by_name_snapshot?: string | null
          scheduled_by_user_id?: string | null
          scheduled_end_at?: string | null
          scheduled_start_at?: string | null
          scheduled_timezone?: string
          service_address?: string | null
          source?: string
          started_at?: string | null
          status?: string
          stock_code_snapshot?: string | null
          subject?: string
          subscription_category_snapshot?: string | null
          subscription_snapshot_id?: string | null
          support_mode?: string | null
          tenant_code?: string
          total_work_minutes?: number
          travel_note?: string | null
          travel_started_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      settings_audit_log: {
        Row: {
          action: string
          area: string
          created_at: string
          id: string
          new_value: Json | null
          old_value: Json | null
          performed_by_name: string | null
          performed_by_user_id: string | null
          tenant_code: string
        }
        Insert: {
          action: string
          area: string
          created_at?: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          performed_by_name?: string | null
          performed_by_user_id?: string | null
          tenant_code: string
        }
        Update: {
          action?: string
          area?: string
          created_at?: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          performed_by_name?: string | null
          performed_by_user_id?: string | null
          tenant_code?: string
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
      storage_change_log: {
        Row: {
          confirmation_text: string
          confirmation_text_version: string
          confirmed_by_name: string | null
          confirmed_by_user_id: string | null
          created_at: string
          id: string
          new_provider: string | null
          old_provider: string | null
          tenant_code: string
        }
        Insert: {
          confirmation_text: string
          confirmation_text_version?: string
          confirmed_by_name?: string | null
          confirmed_by_user_id?: string | null
          created_at?: string
          id?: string
          new_provider?: string | null
          old_provider?: string | null
          tenant_code: string
        }
        Update: {
          confirmation_text?: string
          confirmation_text_version?: string
          confirmed_by_name?: string | null
          confirmed_by_user_id?: string | null
          created_at?: string
          id?: string
          new_provider?: string | null
          old_provider?: string | null
          tenant_code?: string
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
          quantity_used: number
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
          quantity_used?: number
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
          quantity_used?: number
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
      tenant_storage_connections: {
        Row: {
          config: Json
          created_at: string
          created_by: string | null
          display_name: string | null
          id: string
          is_active: boolean
          last_test_result: string | null
          last_tested_at: string | null
          provider: string
          root_folder_id: string | null
          root_folder_name: string | null
          secret_ciphertext: string | null
          status: string
          tenant_code: string
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          created_by?: string | null
          display_name?: string | null
          id?: string
          is_active?: boolean
          last_test_result?: string | null
          last_tested_at?: string | null
          provider: string
          root_folder_id?: string | null
          root_folder_name?: string | null
          secret_ciphertext?: string | null
          status?: string
          tenant_code: string
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          created_by?: string | null
          display_name?: string | null
          id?: string
          is_active?: boolean
          last_test_result?: string | null
          last_tested_at?: string | null
          provider?: string
          root_folder_id?: string | null
          root_folder_name?: string | null
          secret_ciphertext?: string | null
          status?: string
          tenant_code?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      sh_cancellation_cancel_direct: {
        Args: {
          p_actor_name: string
          p_actor_user_id: string
          p_job_id: string
          p_reason: string
          p_tenant_code: string
        }
        Returns: Json
      }
      sh_cancellation_decide: {
        Args: {
          p_actor_name: string
          p_actor_user_id: string
          p_decision: string
          p_note: string
          p_request_id: string
          p_tenant_code: string
        }
        Returns: Json
      }
      sh_cancellation_request_create: {
        Args: {
          p_actor_name: string
          p_actor_user_id: string
          p_approval_mode: string
          p_job_id: string
          p_reason: string
          p_requester_policy: string
          p_tenant_code: string
        }
        Returns: Json
      }
      sh_field_mutate: {
        Args: {
          p_action: string
          p_actor_name: string
          p_actor_user_id: string
          p_is_admin: boolean
          p_job_id: string
          p_payload?: Json
          p_tenant_code: string
        }
        Returns: Json
      }
      sh_next_job_number: {
        Args: { p_date_key: string; p_tenant_code: string }
        Returns: number
      }
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
