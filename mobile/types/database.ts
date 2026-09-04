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
          source_urls: Record<string, string>;
          notes: string | null;
          data_freshness_days: number | null;
          last_loaded_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          bulletin_date: string;
          source_pdf_url?: string | null;
          source_urls?: Record<string, string>;
          notes?: string | null;
          data_freshness_days?: number | null;
          last_loaded_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          bulletin_date?: string;
          source_pdf_url?: string | null;
          source_urls?: Record<string, string>;
          notes?: string | null;
          data_freshness_days?: number | null;
          last_loaded_at?: string | null;
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
          last_refill_price: number | null;
          last_refill_at: string | null;
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
          last_refill_price?: number | null;
          last_refill_at?: string | null;
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
          last_refill_price?: number | null;
          last_refill_at?: string | null;
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
      saved_trips: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          origin_label: string | null;
          destination_label: string | null;
          vehicle_id: string | null;
          distance_km: number;
          mcda_weights: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          origin_label?: string | null;
          destination_label?: string | null;
          vehicle_id?: string | null;
          distance_km: number;
          mcda_weights: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          origin_label?: string | null;
          destination_label?: string | null;
          vehicle_id?: string | null;
          distance_km?: number;
          mcda_weights?: Json;
          created_at?: string;
          updated_at?: string;
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
      fuel_stations: {
        Row: {
          id: string;
          name: string;
          address: string | null;
          region_id: string;
          oil_company_id: string;
          latitude: number | null;
          longitude: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          address?: string | null;
          region_id: string;
          oil_company_id: string;
          latitude?: number | null;
          longitude?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          address?: string | null;
          region_id?: string;
          oil_company_id?: string;
          latitude?: number | null;
          longitude?: number | null;
          created_at?: string;
        };
        Relationships: [];
      };
      community_fuel_reports: {
        Row: {
          id: string;
          station_id: string;
          fuel_type_id: string;
          reported_price: number;
          reported_by: string;
          status: string;
          confirmation_count: number;
          notes: string | null;
          verified_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          station_id: string;
          fuel_type_id: string;
          reported_price: number;
          reported_by: string;
          status?: string;
          confirmation_count?: number;
          notes?: string | null;
          verified_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          station_id?: string;
          fuel_type_id?: string;
          reported_price?: number;
          reported_by?: string;
          status?: string;
          confirmation_count?: number;
          notes?: string | null;
          verified_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      fresh_verified_community_prices: {
        Row: {
          report_id: string;
          station_id: string;
          fuel_type_id: string;
          reported_price: number;
          verified_at: string;
          station_name: string;
          oil_company_id: string;
          region_id: string;
          address: string | null;
        };
        Relationships: [];
      };
      region_bulletin_weeks: {
        Row: {
          region_id: string;
          region_code: string;
          bulletin_id: string;
          bulletin_date: string;
          data_freshness_days: number | null;
          last_loaded_at: string | null;
          price_count: number;
        };
        Relationships: [];
      };
    };
    Functions: {
      submit_community_fuel_report: {
        Args: {
          p_station_id: string;
          p_fuel_type_id: string;
          p_reported_price: number;
          p_notes?: string | null;
        };
        Returns: string;
      };
      confirm_community_fuel_report: {
        Args: {
          p_report_id: string;
          p_observed_price?: number | null;
        };
        Returns: undefined;
      };
      create_fuel_station: {
        Args: {
          p_name: string;
          p_oil_company_id: string;
          p_region_id: string;
          p_latitude: number;
          p_longitude: number;
          p_address?: string | null;
          p_brand_label?: string | null;
        };
        Returns: string;
      };
      ensure_oil_company: {
        Args: {
          p_name: string;
        };
        Returns: string;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
