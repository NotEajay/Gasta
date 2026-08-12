/**
 * Supabase Database types — keep in sync with supabase/migrations/.
 * Regenerate via `supabase gen types typescript` when schema changes.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      regions: {
        Row: {
          id: string;
          code: string;
          name: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          code: string;
          name: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          code?: string;
          name?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      fuel_types: {
        Row: {
          id: string;
          code: string;
          name: string;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          code: string;
          name: string;
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          code?: string;
          name?: string;
          sort_order?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      oil_companies: {
        Row: {
          id: string;
          name: string;
          slug: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      fuel_price_bulletins: {
        Row: {
          id: string;
          bulletin_date: string;
          source_pdf_url: string | null;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          bulletin_date: string;
          source_pdf_url?: string | null;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          bulletin_date?: string;
          source_pdf_url?: string | null;
          notes?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      fuel_prices: {
        Row: {
          id: string;
          bulletin_id: string;
          region_id: string;
          oil_company_id: string;
          fuel_type_id: string;
          price_per_liter: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          bulletin_id: string;
          region_id: string;
          oil_company_id: string;
          fuel_type_id: string;
          price_per_liter: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          bulletin_id?: string;
          region_id?: string;
          oil_company_id?: string;
          fuel_type_id?: string;
          price_per_liter?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      vehicle_catalog: {
        Row: {
          id: string;
          brand: string;
          model: string;
          year: number;
          fuel_type_id: string;
          fuel_efficiency_km_per_liter: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          brand: string;
          model: string;
          year: number;
          fuel_type_id: string;
          fuel_efficiency_km_per_liter: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          brand?: string;
          model?: string;
          year?: number;
          fuel_type_id?: string;
          fuel_efficiency_km_per_liter?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      vehicles: {
        Row: {
          id: string;
          user_id: string;
          catalog_id: string | null;
          brand: string;
          model: string;
          year: number;
          fuel_type_id: string;
          fuel_efficiency_km_per_liter: number;
          nickname: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          catalog_id?: string | null;
          brand: string;
          model: string;
          year: number;
          fuel_type_id: string;
          fuel_efficiency_km_per_liter: number;
          nickname?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          catalog_id?: string | null;
          brand?: string;
          model?: string;
          year?: number;
          fuel_type_id?: string;
          fuel_efficiency_km_per_liter?: number;
          nickname?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      transport_modes: {
        Row: {
          id: string;
          code: string;
          name: string;
          description: string | null;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          code: string;
          name: string;
          description?: string | null;
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          code?: string;
          name?: string;
          description?: string | null;
          sort_order?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      trip_records: {
        Row: {
          id: string;
          user_id: string;
          vehicle_id: string | null;
          distance_km: number;
          origin_label: string | null;
          destination_label: string | null;
          mcda_weights: Json;
          mode_evaluations: Json;
          recommended_mode_code: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          vehicle_id?: string | null;
          distance_km: number;
          origin_label?: string | null;
          destination_label?: string | null;
          mcda_weights: Json;
          mode_evaluations: Json;
          recommended_mode_code: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          vehicle_id?: string | null;
          distance_km?: number;
          origin_label?: string | null;
          destination_label?: string | null;
          mcda_weights?: Json;
          mode_evaluations?: Json;
          recommended_mode_code?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      fuel_budgets: {
        Row: {
          id: string;
          user_id: string;
          year: number;
          month: number;
          limit_amount: number;
          alert_threshold_percent: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          year: number;
          month: number;
          limit_amount: number;
          alert_threshold_percent?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          year?: number;
          month?: number;
          limit_amount?: number;
          alert_threshold_percent?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
