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
          n3_status?: string | null
          phone?: string | null
          sync_status?: string
          tenant_code?: string
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
          service_type: string
          stock_code: string
          tenant_code: string
          updated_at: string
        }
        Insert: {
          contract_days?: number | null
          created_at?: string
          id?: string
          is_active?: boolean
          service_type: string
          stock_code: string
          tenant_code: string
          updated_at?: string
        }
        Update: {
          contract_days?: number | null
          created_at?: string
          id?: string
          is_active?: boolean
          service_type?: string
          stock_code?: string
          tenant_code?: string
          updated_at?: string
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
          stock_code?: string
          stock_name?: string | null
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
