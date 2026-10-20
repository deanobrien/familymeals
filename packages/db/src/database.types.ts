export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: { extensions?: Json; operationName?: string; query?: string; variables?: Json };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      ai_usage: {
        Row: {
          cost_millipence: number;
          created_at: string;
          error_code: string | null;
          household_id: string;
          id: string;
          image_count: number;
          input_tokens: number;
          latency_ms: number | null;
          model: string;
          operation: Database['public']['Enums']['ai_operation'];
          output_tokens: number;
          provider: string;
          request_id: string | null;
          status: Database['public']['Enums']['ai_status'];
          user_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          cost_millipence?: number;
          created_at?: string;
          error_code?: string | null;
          household_id: string;
          id?: string;
          image_count?: number;
          input_tokens?: number;
          latency_ms?: number | null;
          model: string;
          operation: Database['public']['Enums']['ai_operation'];
          output_tokens?: number;
          provider: string;
          request_id?: string | null;
          status: Database['public']['Enums']['ai_status'];
          user_id?: string | null;
        };
        Update: {
          cost_millipence?: number;
          created_at?: string;
          error_code?: string | null;
          household_id?: string;
          id?: string;
          image_count?: number;
          input_tokens?: number;
          latency_ms?: number | null;
          model?: string;
          operation?: Database['public']['Enums']['ai_operation'];
          output_tokens?: number;
          provider?: string;
          request_id?: string | null;
          status?: Database['public']['Enums']['ai_status'];
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'ai_usage_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
        ];
      };
      consent_records: {
        Row: {
          consent_type: Database['public']['Enums']['consent_type'];
          granted_at: string;
          household_id: string;
          id: string;
          user_id: string;
          withdrawn_at: string | null;
          wording_version: string;
        };
        ComputedFields: never;
        Insert: {
          consent_type: Database['public']['Enums']['consent_type'];
          granted_at?: string;
          household_id: string;
          id?: string;
          user_id?: string;
          withdrawn_at?: string | null;
          wording_version: string;
        };
        Update: {
          consent_type?: Database['public']['Enums']['consent_type'];
          granted_at?: string;
          household_id?: string;
          id?: string;
          user_id?: string;
          withdrawn_at?: string | null;
          wording_version?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'consent_records_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
        ];
      };
      data_export_requests: {
        Row: {
          bytes: number | null;
          counts: Json | null;
          download_count: number;
          error: string | null;
          expires_at: string;
          household_id: string;
          id: string;
          last_downloaded_at: string | null;
          requested_at: string;
          scope: string;
          status: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          bytes?: number | null;
          counts?: Json | null;
          download_count?: number;
          error?: string | null;
          expires_at: string;
          household_id: string;
          id?: string;
          last_downloaded_at?: string | null;
          requested_at?: string;
          scope: string;
          status?: string;
          user_id?: string;
        };
        Update: {
          bytes?: number | null;
          counts?: Json | null;
          download_count?: number;
          error?: string | null;
          expires_at?: string;
          household_id?: string;
          id?: string;
          last_downloaded_at?: string | null;
          requested_at?: string;
          scope?: string;
          status?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'data_export_requests_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
        ];
      };
      deletion_ledger: {
        Row: {
          cancelled_at: string | null;
          household_id: string | null;
          id: string;
          purged_at: string | null;
          requested_at: string;
          requested_by: string | null;
          scheduled_purge_at: string;
          subject_id: string;
          subject_type: Database['public']['Enums']['deletion_subject'];
        };
        ComputedFields: never;
        Insert: {
          cancelled_at?: string | null;
          household_id?: string | null;
          id?: string;
          purged_at?: string | null;
          requested_at?: string;
          requested_by?: string | null;
          scheduled_purge_at?: string;
          subject_id: string;
          subject_type: Database['public']['Enums']['deletion_subject'];
        };
        Update: {
          cancelled_at?: string | null;
          household_id?: string | null;
          id?: string;
          purged_at?: string | null;
          requested_at?: string;
          requested_by?: string | null;
          scheduled_purge_at?: string;
          subject_id?: string;
          subject_type?: Database['public']['Enums']['deletion_subject'];
        };
        Relationships: [];
      };
      household_ai_settings: {
        Row: {
          config: NonNullable<Json>;
          household_id: string;
          keys: NonNullable<Json>;
          provider: string;
          updated_at: string;
          updated_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          config?: NonNullable<Json>;
          household_id: string;
          keys?: NonNullable<Json>;
          provider: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          config?: NonNullable<Json>;
          household_id?: string;
          keys?: NonNullable<Json>;
          provider?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'household_ai_settings_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: true;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
        ];
      };
      household_exclusions: {
        Row: {
          allergen_group: Database['public']['Enums']['allergen_group'] | null;
          consent_recorded_at: string | null;
          created_at: string;
          created_by: string | null;
          household_id: string;
          id: string;
          ingredient_id: string | null;
          kind: Database['public']['Enums']['exclusion_kind'];
          term: string | null;
        };
        ComputedFields: never;
        Insert: {
          allergen_group?: Database['public']['Enums']['allergen_group'] | null;
          consent_recorded_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          household_id: string;
          id?: string;
          ingredient_id?: string | null;
          kind: Database['public']['Enums']['exclusion_kind'];
          term?: string | null;
        };
        Update: {
          allergen_group?: Database['public']['Enums']['allergen_group'] | null;
          consent_recorded_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          household_id?: string;
          id?: string;
          ingredient_id?: string | null;
          kind?: Database['public']['Enums']['exclusion_kind'];
          term?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'household_exclusions_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'household_exclusions_ingredient_fk';
            columns: ['ingredient_id'];
            isOneToOne: false;
            referencedRelation: 'ingredients';
            referencedColumns: ['id'];
          },
        ];
      };
      household_members: {
        Row: {
          created_at: string;
          display_name: string | null;
          household_id: string;
          id: string;
          invitation_id: string | null;
          joined_at: string;
          revoked_at: string | null;
          role: Database['public']['Enums']['household_role'];
          status: Database['public']['Enums']['membership_status'];
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          display_name?: string | null;
          household_id: string;
          id?: string;
          invitation_id?: string | null;
          joined_at?: string;
          revoked_at?: string | null;
          role?: Database['public']['Enums']['household_role'];
          status?: Database['public']['Enums']['membership_status'];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          display_name?: string | null;
          household_id?: string;
          id?: string;
          invitation_id?: string | null;
          joined_at?: string;
          revoked_at?: string | null;
          role?: Database['public']['Enums']['household_role'];
          status?: Database['public']['Enums']['membership_status'];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'household_members_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'household_members_invitation_fk';
            columns: ['invitation_id'];
            isOneToOne: false;
            referencedRelation: 'invitations';
            referencedColumns: ['id'];
          },
        ];
      };
      household_product_snapshots: {
        Row: {
          barcode: string;
          household_id: string;
          ingredient_id: string | null;
          linked_at: string;
          linked_by: string | null;
          retrieved_at: string;
          snapshot: NonNullable<Json>;
        };
        ComputedFields: never;
        Insert: {
          barcode: string;
          household_id: string;
          ingredient_id?: string | null;
          linked_at?: string;
          linked_by?: string | null;
          retrieved_at: string;
          snapshot: NonNullable<Json>;
        };
        Update: {
          barcode?: string;
          household_id?: string;
          ingredient_id?: string | null;
          linked_at?: string;
          linked_by?: string | null;
          retrieved_at?: string;
          snapshot?: NonNullable<Json>;
        };
        Relationships: [
          {
            foreignKeyName: 'household_product_snapshots_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'household_product_snapshots_ingredient_id_fkey';
            columns: ['ingredient_id'];
            isOneToOne: false;
            referencedRelation: 'ingredients';
            referencedColumns: ['id'];
          },
        ];
      };
      households: {
        Row: {
          created_at: string;
          created_by: string | null;
          currency: string;
          default_servings: number;
          deletion_requested_at: string | null;
          id: string;
          locale: string;
          name: string;
          pantry_deduct_on_purchase: boolean;
          preferred_units: Database['public']['Enums']['preferred_units'];
          purge_after: string | null;
          status: Database['public']['Enums']['household_status'];
          updated_at: string;
          weekly_budget_pence: number | null;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          default_servings?: number;
          deletion_requested_at?: string | null;
          id?: string;
          locale?: string;
          name: string;
          pantry_deduct_on_purchase?: boolean;
          preferred_units?: Database['public']['Enums']['preferred_units'];
          purge_after?: string | null;
          status?: Database['public']['Enums']['household_status'];
          updated_at?: string;
          weekly_budget_pence?: number | null;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          default_servings?: number;
          deletion_requested_at?: string | null;
          id?: string;
          locale?: string;
          name?: string;
          pantry_deduct_on_purchase?: boolean;
          preferred_units?: Database['public']['Enums']['preferred_units'];
          purge_after?: string | null;
          status?: Database['public']['Enums']['household_status'];
          updated_at?: string;
          weekly_budget_pence?: number | null;
        };
        Relationships: [];
      };
      ingredient_aliases: {
        Row: {
          alias: string;
          created_at: string;
          id: string;
          ingredient_id: string;
          locale: string;
        };
        ComputedFields: never;
        Insert: {
          alias: string;
          created_at?: string;
          id?: string;
          ingredient_id: string;
          locale?: string;
        };
        Update: {
          alias?: string;
          created_at?: string;
          id?: string;
          ingredient_id?: string;
          locale?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'ingredient_aliases_ingredient_id_fkey';
            columns: ['ingredient_id'];
            isOneToOne: false;
            referencedRelation: 'ingredients';
            referencedColumns: ['id'];
          },
        ];
      };
      ingredient_allergens: {
        Row: {
          allergen_group: Database['public']['Enums']['allergen_group'];
          created_at: string;
          ingredient_id: string;
          source: string;
        };
        ComputedFields: never;
        Insert: {
          allergen_group: Database['public']['Enums']['allergen_group'];
          created_at?: string;
          ingredient_id: string;
          source: string;
        };
        Update: {
          allergen_group?: Database['public']['Enums']['allergen_group'];
          created_at?: string;
          ingredient_id?: string;
          source?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'ingredient_allergens_ingredient_id_fkey';
            columns: ['ingredient_id'];
            isOneToOne: false;
            referencedRelation: 'ingredients';
            referencedColumns: ['id'];
          },
        ];
      };
      ingredient_densities: {
        Row: {
          created_at: string;
          g_per_ml: number;
          id: string;
          ingredient_id: string;
          source: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          g_per_ml: number;
          id?: string;
          ingredient_id: string;
          source: string;
        };
        Update: {
          created_at?: string;
          g_per_ml?: number;
          id?: string;
          ingredient_id?: string;
          source?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'ingredient_densities_ingredient_id_fkey';
            columns: ['ingredient_id'];
            isOneToOne: true;
            referencedRelation: 'ingredients';
            referencedColumns: ['id'];
          },
        ];
      };
      ingredient_nutrients: {
        Row: {
          created_at: string;
          estimate: boolean;
          id: string;
          ingredient_id: string;
          nutrient: Database['public']['Enums']['nutrient_key'];
          source: string;
          source_ref: string | null;
          source_version: string | null;
          unit: Database['public']['Enums']['nutrient_unit'];
          value_per_100g: number | null;
          value_status: Database['public']['Enums']['value_status'];
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          estimate?: boolean;
          id?: string;
          ingredient_id: string;
          nutrient: Database['public']['Enums']['nutrient_key'];
          source: string;
          source_ref?: string | null;
          source_version?: string | null;
          unit: Database['public']['Enums']['nutrient_unit'];
          value_per_100g?: number | null;
          value_status: Database['public']['Enums']['value_status'];
        };
        Update: {
          created_at?: string;
          estimate?: boolean;
          id?: string;
          ingredient_id?: string;
          nutrient?: Database['public']['Enums']['nutrient_key'];
          source?: string;
          source_ref?: string | null;
          source_version?: string | null;
          unit?: Database['public']['Enums']['nutrient_unit'];
          value_per_100g?: number | null;
          value_status?: Database['public']['Enums']['value_status'];
        };
        Relationships: [
          {
            foreignKeyName: 'ingredient_nutrients_ingredient_id_fkey';
            columns: ['ingredient_id'];
            isOneToOne: false;
            referencedRelation: 'ingredients';
            referencedColumns: ['id'];
          },
        ];
      };
      ingredient_prices: {
        Row: {
          approx_label: string | null;
          created_at: string;
          created_by: string | null;
          currency: string;
          household_id: string | null;
          id: string;
          ingredient_id: string | null;
          kind: Database['public']['Enums']['price_kind'];
          observed_on: string;
          original_text: string;
          price_pence: number;
          product_pack_id: string | null;
          quantity_kind: Database['public']['Enums']['quantity_kind'];
          quantity_max: number | null;
          quantity_min: number | null;
          quantity_value: number;
          receipt_line_id: string | null;
          retailer: string | null;
          source: string;
          unit: Database['public']['Enums']['unit'];
        };
        ComputedFields: never;
        Insert: {
          approx_label?: string | null;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          household_id?: string | null;
          id?: string;
          ingredient_id?: string | null;
          kind: Database['public']['Enums']['price_kind'];
          observed_on: string;
          original_text?: string;
          price_pence: number;
          product_pack_id?: string | null;
          quantity_kind?: Database['public']['Enums']['quantity_kind'];
          quantity_max?: number | null;
          quantity_min?: number | null;
          quantity_value: number;
          receipt_line_id?: string | null;
          retailer?: string | null;
          source: string;
          unit: Database['public']['Enums']['unit'];
        };
        Update: {
          approx_label?: string | null;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          household_id?: string | null;
          id?: string;
          ingredient_id?: string | null;
          kind?: Database['public']['Enums']['price_kind'];
          observed_on?: string;
          original_text?: string;
          price_pence?: number;
          product_pack_id?: string | null;
          quantity_kind?: Database['public']['Enums']['quantity_kind'];
          quantity_max?: number | null;
          quantity_min?: number | null;
          quantity_value?: number;
          receipt_line_id?: string | null;
          retailer?: string | null;
          source?: string;
          unit?: Database['public']['Enums']['unit'];
        };
        Relationships: [
          {
            foreignKeyName: 'ingredient_prices_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'ingredient_prices_ingredient_id_fkey';
            columns: ['ingredient_id'];
            isOneToOne: false;
            referencedRelation: 'ingredients';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'ingredient_prices_product_pack_id_fkey';
            columns: ['product_pack_id'];
            isOneToOne: false;
            referencedRelation: 'product_packs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'ingredient_prices_receipt_line_fk';
            columns: ['receipt_line_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'receipt_lines';
            referencedColumns: ['id', 'household_id'];
          },
        ];
      };
      ingredient_unit_weights: {
        Row: {
          created_at: string;
          estimate: boolean;
          grams: number;
          id: string;
          ingredient_id: string;
          source: string;
          unit: Database['public']['Enums']['unit'];
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          estimate?: boolean;
          grams: number;
          id?: string;
          ingredient_id: string;
          source: string;
          unit?: Database['public']['Enums']['unit'];
        };
        Update: {
          created_at?: string;
          estimate?: boolean;
          grams?: number;
          id?: string;
          ingredient_id?: string;
          source?: string;
          unit?: Database['public']['Enums']['unit'];
        };
        Relationships: [
          {
            foreignKeyName: 'ingredient_unit_weights_ingredient_id_fkey';
            columns: ['ingredient_id'];
            isOneToOne: false;
            referencedRelation: 'ingredients';
            referencedColumns: ['id'];
          },
        ];
      };
      ingredients: {
        Row: {
          category: string;
          created_at: string;
          form: Database['public']['Enums']['ingredient_form'] | null;
          id: string;
          name: string;
          slug: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          category: string;
          created_at?: string;
          form?: Database['public']['Enums']['ingredient_form'] | null;
          id?: string;
          name: string;
          slug: string;
          updated_at?: string;
        };
        Update: {
          category?: string;
          created_at?: string;
          form?: Database['public']['Enums']['ingredient_form'] | null;
          id?: string;
          name?: string;
          slug?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      invitations: {
        Row: {
          accepted_at: string | null;
          accepted_by: string | null;
          created_at: string;
          email: string | null;
          expires_at: string;
          household_id: string;
          id: string;
          invited_by: string;
          revoked_at: string | null;
          role: Database['public']['Enums']['household_role'];
          token_hash: string;
        };
        ComputedFields: never;
        Insert: {
          accepted_at?: string | null;
          accepted_by?: string | null;
          created_at?: string;
          email?: string | null;
          expires_at: string;
          household_id: string;
          id?: string;
          invited_by?: string;
          revoked_at?: string | null;
          role?: Database['public']['Enums']['household_role'];
          token_hash: string;
        };
        Update: {
          accepted_at?: string | null;
          accepted_by?: string | null;
          created_at?: string;
          email?: string | null;
          expires_at?: string;
          household_id?: string;
          id?: string;
          invited_by?: string;
          revoked_at?: string | null;
          role?: Database['public']['Enums']['household_role'];
          token_hash?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'invitations_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
        ];
      };
      member_dislikes: {
        Row: {
          created_at: string;
          created_by: string | null;
          household_id: string;
          id: string;
          member_user_id: string;
          term: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string | null;
          household_id: string;
          id?: string;
          member_user_id: string;
          term: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          household_id?: string;
          id?: string;
          member_user_id?: string;
          term?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'member_dislikes_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'member_dislikes_household_id_member_user_id_fkey';
            columns: ['household_id', 'member_user_id'];
            isOneToOne: false;
            referencedRelation: 'household_members';
            referencedColumns: ['household_id', 'user_id'];
          },
        ];
      };
      meal_plans: {
        Row: {
          approved_at: string | null;
          approved_by: string | null;
          budget_target_pence: number | null;
          constraints: Json | null;
          created_at: string;
          created_by: string | null;
          end_date: string;
          household_id: string;
          id: string;
          planning_prompt: string | null;
          start_date: string;
          status: Database['public']['Enums']['meal_plan_status'];
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          approved_at?: string | null;
          approved_by?: string | null;
          budget_target_pence?: number | null;
          constraints?: Json | null;
          created_at?: string;
          created_by?: string | null;
          end_date: string;
          household_id: string;
          id?: string;
          planning_prompt?: string | null;
          start_date: string;
          status?: Database['public']['Enums']['meal_plan_status'];
          updated_at?: string;
        };
        Update: {
          approved_at?: string | null;
          approved_by?: string | null;
          budget_target_pence?: number | null;
          constraints?: Json | null;
          created_at?: string;
          created_by?: string | null;
          end_date?: string;
          household_id?: string;
          id?: string;
          planning_prompt?: string | null;
          start_date?: string;
          status?: Database['public']['Enums']['meal_plan_status'];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'meal_plans_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
        ];
      };
      nutrition_profile_values: {
        Row: {
          estimate: boolean;
          household_id: string;
          id: string;
          nutrient: Database['public']['Enums']['nutrient_key'];
          nutrition_profile_id: string;
          source: string | null;
          unit: Database['public']['Enums']['nutrient_unit'];
          value: number | null;
          value_status: Database['public']['Enums']['value_status'];
        };
        ComputedFields: never;
        Insert: {
          estimate?: boolean;
          household_id: string;
          id?: string;
          nutrient: Database['public']['Enums']['nutrient_key'];
          nutrition_profile_id: string;
          source?: string | null;
          unit: Database['public']['Enums']['nutrient_unit'];
          value?: number | null;
          value_status: Database['public']['Enums']['value_status'];
        };
        Update: {
          estimate?: boolean;
          household_id?: string;
          id?: string;
          nutrient?: Database['public']['Enums']['nutrient_key'];
          nutrition_profile_id?: string;
          source?: string | null;
          unit?: Database['public']['Enums']['nutrient_unit'];
          value?: number | null;
          value_status?: Database['public']['Enums']['value_status'];
        };
        Relationships: [
          {
            foreignKeyName: 'nutrition_profile_values_nutrition_profile_id_household_id_fkey';
            columns: ['nutrition_profile_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'nutrition_profiles';
            referencedColumns: ['id', 'household_id'];
          },
        ];
      };
      nutrition_profiles: {
        Row: {
          basis: Database['public']['Enums']['nutrition_basis'];
          calculated_at: string;
          calculation_method: string;
          confidence: string | null;
          coverage_ratio: number | null;
          engine_version: string | null;
          household_id: string;
          id: string;
          recipe_id: string;
          servings: number;
        };
        ComputedFields: never;
        Insert: {
          basis: Database['public']['Enums']['nutrition_basis'];
          calculated_at?: string;
          calculation_method: string;
          confidence?: string | null;
          coverage_ratio?: number | null;
          engine_version?: string | null;
          household_id: string;
          id?: string;
          recipe_id: string;
          servings: number;
        };
        Update: {
          basis?: Database['public']['Enums']['nutrition_basis'];
          calculated_at?: string;
          calculation_method?: string;
          confidence?: string | null;
          coverage_ratio?: number | null;
          engine_version?: string | null;
          household_id?: string;
          id?: string;
          recipe_id?: string;
          servings?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'nutrition_profiles_recipe_id_household_id_fkey';
            columns: ['recipe_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'recipes';
            referencedColumns: ['id', 'household_id'];
          },
        ];
      };
      pantry_handled_events: {
        Row: {
          handled_at: string;
          household_id: string;
          purchase_event_id: string;
        };
        ComputedFields: never;
        Insert: {
          handled_at?: string;
          household_id: string;
          purchase_event_id: string;
        };
        Update: {
          handled_at?: string;
          household_id?: string;
          purchase_event_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'pantry_handled_events_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
        ];
      };
      pantry_items: {
        Row: {
          approx_label: string | null;
          created_at: string;
          created_by: string | null;
          display_name: string;
          expires_on: string | null;
          household_id: string;
          id: string;
          ingredient_id: string | null;
          notes: string | null;
          original_text: string;
          product_pack_id: string | null;
          quantity_kind: Database['public']['Enums']['quantity_kind'];
          quantity_max: number | null;
          quantity_min: number | null;
          quantity_value: number | null;
          receipt_line_id: string | null;
          source: Database['public']['Enums']['pantry_source'];
          source_event_ids: string[];
          stock_updated_at: string;
          unit: Database['public']['Enums']['unit'] | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          approx_label?: string | null;
          created_at?: string;
          created_by?: string | null;
          display_name: string;
          expires_on?: string | null;
          household_id: string;
          id?: string;
          ingredient_id?: string | null;
          notes?: string | null;
          original_text?: string;
          product_pack_id?: string | null;
          quantity_kind: Database['public']['Enums']['quantity_kind'];
          quantity_max?: number | null;
          quantity_min?: number | null;
          quantity_value?: number | null;
          receipt_line_id?: string | null;
          source?: Database['public']['Enums']['pantry_source'];
          source_event_ids?: string[];
          stock_updated_at?: string;
          unit?: Database['public']['Enums']['unit'] | null;
          updated_at?: string;
        };
        Update: {
          approx_label?: string | null;
          created_at?: string;
          created_by?: string | null;
          display_name?: string;
          expires_on?: string | null;
          household_id?: string;
          id?: string;
          ingredient_id?: string | null;
          notes?: string | null;
          original_text?: string;
          product_pack_id?: string | null;
          quantity_kind?: Database['public']['Enums']['quantity_kind'];
          quantity_max?: number | null;
          quantity_min?: number | null;
          quantity_value?: number | null;
          receipt_line_id?: string | null;
          source?: Database['public']['Enums']['pantry_source'];
          source_event_ids?: string[];
          stock_updated_at?: string;
          unit?: Database['public']['Enums']['unit'] | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'pantry_items_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'pantry_items_ingredient_id_fkey';
            columns: ['ingredient_id'];
            isOneToOne: false;
            referencedRelation: 'ingredients';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'pantry_items_product_pack_id_fkey';
            columns: ['product_pack_id'];
            isOneToOne: false;
            referencedRelation: 'product_packs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'pantry_items_receipt_line_id_household_id_fkey';
            columns: ['receipt_line_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'receipt_lines';
            referencedColumns: ['id', 'household_id'];
          },
        ];
      };
      pantry_par_levels: {
        Row: {
          created_at: string;
          created_by: string | null;
          display_name: string;
          enabled: boolean;
          household_id: string;
          id: string;
          ingredient_id: string | null;
          min_value: number;
          pack_unit: Database['public']['Enums']['unit'] | null;
          pack_value: number | null;
          restock_to_value: number | null;
          snoozed_until: string | null;
          unit: Database['public']['Enums']['unit'];
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string | null;
          display_name: string;
          enabled?: boolean;
          household_id: string;
          id?: string;
          ingredient_id?: string | null;
          min_value: number;
          pack_unit?: Database['public']['Enums']['unit'] | null;
          pack_value?: number | null;
          restock_to_value?: number | null;
          snoozed_until?: string | null;
          unit: Database['public']['Enums']['unit'];
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          display_name?: string;
          enabled?: boolean;
          household_id?: string;
          id?: string;
          ingredient_id?: string | null;
          min_value?: number;
          pack_unit?: Database['public']['Enums']['unit'] | null;
          pack_value?: number | null;
          restock_to_value?: number | null;
          snoozed_until?: string | null;
          unit?: Database['public']['Enums']['unit'];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'pantry_par_levels_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'pantry_par_levels_ingredient_id_fkey';
            columns: ['ingredient_id'];
            isOneToOne: false;
            referencedRelation: 'ingredients';
            referencedColumns: ['id'];
          },
        ];
      };
      restock_settings: {
        Row: {
          auto_add: boolean;
          household_id: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          auto_add?: boolean;
          household_id: string;
          updated_at?: string;
        };
        Update: {
          auto_add?: boolean;
          household_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'restock_settings_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: true;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
        ];
      };
      pantry_settings: {
        Row: {
          household_id: string;
          purchase_mode: string;
          stale_after_days: number;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          household_id: string;
          purchase_mode?: string;
          stale_after_days?: number;
          updated_at?: string;
        };
        Update: {
          household_id?: string;
          purchase_mode?: string;
          stale_after_days?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'pantry_settings_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: true;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
        ];
      };
      person_profiles: {
        Row: {
          created_at: string;
          dietary_preference: Database['public']['Enums']['diet_category'] | null;
          display_name: string;
          favourite_tag_ids: string[];
          household_id: string;
          id: string;
          preferences: NonNullable<Json>;
          updated_at: string;
          user_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          dietary_preference?: Database['public']['Enums']['diet_category'] | null;
          display_name: string;
          favourite_tag_ids?: string[];
          household_id: string;
          id?: string;
          preferences?: NonNullable<Json>;
          updated_at?: string;
          user_id?: string | null;
        };
        Update: {
          created_at?: string;
          dietary_preference?: Database['public']['Enums']['diet_category'] | null;
          display_name?: string;
          favourite_tag_ids?: string[];
          household_id?: string;
          id?: string;
          preferences?: NonNullable<Json>;
          updated_at?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'person_profiles_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
        ];
      };
      planned_meals: {
        Row: {
          approved: boolean;
          created_at: string;
          household_id: string;
          id: string;
          kind: Database['public']['Enums']['planned_meal_kind'];
          meal_date: string;
          meal_plan_id: string;
          meal_type: Database['public']['Enums']['meal_type'];
          notes: string | null;
          position: number;
          recipe_id: string | null;
          servings: number;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          approved?: boolean;
          created_at?: string;
          household_id: string;
          id?: string;
          kind?: Database['public']['Enums']['planned_meal_kind'];
          meal_date: string;
          meal_plan_id: string;
          meal_type: Database['public']['Enums']['meal_type'];
          notes?: string | null;
          position?: number;
          recipe_id?: string | null;
          servings: number;
          updated_at?: string;
        };
        Update: {
          approved?: boolean;
          created_at?: string;
          household_id?: string;
          id?: string;
          kind?: Database['public']['Enums']['planned_meal_kind'];
          meal_date?: string;
          meal_plan_id?: string;
          meal_type?: Database['public']['Enums']['meal_type'];
          notes?: string | null;
          position?: number;
          recipe_id?: string | null;
          servings?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'planned_meals_meal_plan_id_household_id_fkey';
            columns: ['meal_plan_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'meal_plans';
            referencedColumns: ['id', 'household_id'];
          },
          {
            foreignKeyName: 'planned_meals_recipe_id_household_id_fkey';
            columns: ['recipe_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'recipes';
            referencedColumns: ['id', 'household_id'];
          },
        ];
      };
      product_packs: {
        Row: {
          approx_label: string | null;
          created_at: string;
          created_by: string | null;
          household_id: string | null;
          id: string;
          ingredient_id: string;
          name: string;
          original_text: string;
          quantity_kind: Database['public']['Enums']['quantity_kind'];
          quantity_max: number | null;
          quantity_min: number | null;
          quantity_value: number;
          retailer: string | null;
          unit: Database['public']['Enums']['unit'];
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          approx_label?: string | null;
          created_at?: string;
          created_by?: string | null;
          household_id?: string | null;
          id?: string;
          ingredient_id: string;
          name: string;
          original_text?: string;
          quantity_kind?: Database['public']['Enums']['quantity_kind'];
          quantity_max?: number | null;
          quantity_min?: number | null;
          quantity_value: number;
          retailer?: string | null;
          unit: Database['public']['Enums']['unit'];
          updated_at?: string;
        };
        Update: {
          approx_label?: string | null;
          created_at?: string;
          created_by?: string | null;
          household_id?: string | null;
          id?: string;
          ingredient_id?: string;
          name?: string;
          original_text?: string;
          quantity_kind?: Database['public']['Enums']['quantity_kind'];
          quantity_max?: number | null;
          quantity_min?: number | null;
          quantity_value?: number;
          retailer?: string | null;
          unit?: Database['public']['Enums']['unit'];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'product_packs_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'product_packs_ingredient_id_fkey';
            columns: ['ingredient_id'];
            isOneToOne: false;
            referencedRelation: 'ingredients';
            referencedColumns: ['id'];
          },
        ];
      };
      purchase_events: {
        Row: {
          actual_price_pence: number | null;
          approx_label: string | null;
          created_at: string;
          created_by: string | null;
          created_by_display_name: string | null;
          household_id: string;
          id: string;
          original_text: string;
          quantity_kind: Database['public']['Enums']['quantity_kind'];
          quantity_max: number | null;
          quantity_min: number | null;
          quantity_value: number | null;
          receipt_line_id: string | null;
          shopping_list_item_id: string;
          unit: Database['public']['Enums']['unit'] | null;
          voided_at: string | null;
          voided_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          actual_price_pence?: number | null;
          approx_label?: string | null;
          created_at?: string;
          created_by?: string | null;
          created_by_display_name?: string | null;
          household_id: string;
          id?: string;
          original_text?: string;
          quantity_kind: Database['public']['Enums']['quantity_kind'];
          quantity_max?: number | null;
          quantity_min?: number | null;
          quantity_value?: number | null;
          receipt_line_id?: string | null;
          shopping_list_item_id: string;
          unit?: Database['public']['Enums']['unit'] | null;
          voided_at?: string | null;
          voided_by?: string | null;
        };
        Update: {
          actual_price_pence?: number | null;
          approx_label?: string | null;
          created_at?: string;
          created_by?: string | null;
          created_by_display_name?: string | null;
          household_id?: string;
          id?: string;
          original_text?: string;
          quantity_kind?: Database['public']['Enums']['quantity_kind'];
          quantity_max?: number | null;
          quantity_min?: number | null;
          quantity_value?: number | null;
          receipt_line_id?: string | null;
          shopping_list_item_id?: string;
          unit?: Database['public']['Enums']['unit'] | null;
          voided_at?: string | null;
          voided_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'purchase_events_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'purchase_events_receipt_line_fk';
            columns: ['receipt_line_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'receipt_lines';
            referencedColumns: ['id', 'household_id'];
          },
          {
            foreignKeyName: 'purchase_events_shopping_list_item_id_household_id_fkey';
            columns: ['shopping_list_item_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'shopping_list_item_progress';
            referencedColumns: ['shopping_list_item_id', 'household_id'];
          },
          {
            foreignKeyName: 'purchase_events_shopping_list_item_id_household_id_fkey';
            columns: ['shopping_list_item_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'shopping_list_items';
            referencedColumns: ['id', 'household_id'];
          },
        ];
      };
      receipt_lines: {
        Row: {
          added_to_pantry: boolean;
          approx_label: string | null;
          created_at: string;
          description: string;
          household_id: string;
          id: string;
          line_no: number;
          line_total_pence: number | null;
          match_score: number | null;
          match_status: Database['public']['Enums']['receipt_line_match_status'];
          matched_shopping_list_item_id: string | null;
          original_text: string;
          parsed: Json | null;
          quantity_kind: Database['public']['Enums']['quantity_kind'];
          quantity_max: number | null;
          quantity_min: number | null;
          quantity_value: number | null;
          receipt_id: string;
          unit: Database['public']['Enums']['unit'] | null;
          unit_price_pence: number | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          added_to_pantry?: boolean;
          approx_label?: string | null;
          created_at?: string;
          description: string;
          household_id: string;
          id?: string;
          line_no: number;
          line_total_pence?: number | null;
          match_score?: number | null;
          match_status?: Database['public']['Enums']['receipt_line_match_status'];
          matched_shopping_list_item_id?: string | null;
          original_text?: string;
          parsed?: Json | null;
          quantity_kind?: Database['public']['Enums']['quantity_kind'];
          quantity_max?: number | null;
          quantity_min?: number | null;
          quantity_value?: number | null;
          receipt_id: string;
          unit?: Database['public']['Enums']['unit'] | null;
          unit_price_pence?: number | null;
          updated_at?: string;
        };
        Update: {
          added_to_pantry?: boolean;
          approx_label?: string | null;
          created_at?: string;
          description?: string;
          household_id?: string;
          id?: string;
          line_no?: number;
          line_total_pence?: number | null;
          match_score?: number | null;
          match_status?: Database['public']['Enums']['receipt_line_match_status'];
          matched_shopping_list_item_id?: string | null;
          original_text?: string;
          parsed?: Json | null;
          quantity_kind?: Database['public']['Enums']['quantity_kind'];
          quantity_max?: number | null;
          quantity_min?: number | null;
          quantity_value?: number | null;
          receipt_id?: string;
          unit?: Database['public']['Enums']['unit'] | null;
          unit_price_pence?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'receipt_lines_matched_shopping_list_item_id_household_id_fkey';
            columns: ['matched_shopping_list_item_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'shopping_list_item_progress';
            referencedColumns: ['shopping_list_item_id', 'household_id'];
          },
          {
            foreignKeyName: 'receipt_lines_matched_shopping_list_item_id_household_id_fkey';
            columns: ['matched_shopping_list_item_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'shopping_list_items';
            referencedColumns: ['id', 'household_id'];
          },
          {
            foreignKeyName: 'receipt_lines_receipt_id_household_id_fkey';
            columns: ['receipt_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'receipts';
            referencedColumns: ['id', 'household_id'];
          },
        ];
      };
      receipts: {
        Row: {
          created_at: string;
          created_by: string | null;
          currency: string;
          household_id: string;
          id: string;
          image_paths: string[];
          parsed_raw: Json | null;
          purchased_on: string | null;
          reconciled_at: string | null;
          retailer: string | null;
          review_state: Json | null;
          status: Database['public']['Enums']['receipt_status'];
          total_pence: number | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          household_id: string;
          id?: string;
          image_paths?: string[];
          parsed_raw?: Json | null;
          purchased_on?: string | null;
          reconciled_at?: string | null;
          retailer?: string | null;
          review_state?: Json | null;
          status?: Database['public']['Enums']['receipt_status'];
          total_pence?: number | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          household_id?: string;
          id?: string;
          image_paths?: string[];
          parsed_raw?: Json | null;
          purchased_on?: string | null;
          reconciled_at?: string | null;
          retailer?: string | null;
          review_state?: Json | null;
          status?: Database['public']['Enums']['receipt_status'];
          total_pence?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'receipts_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
        ];
      };
      recipe_favourites: {
        Row: {
          created_at: string;
          household_id: string;
          recipe_id: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          household_id: string;
          recipe_id: string;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          household_id?: string;
          recipe_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'recipe_favourites_recipe_id_household_id_fkey';
            columns: ['recipe_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'recipes';
            referencedColumns: ['id', 'household_id'];
          },
        ];
      };
      recipe_images: {
        Row: {
          bytes: number | null;
          created_at: string;
          height: number | null;
          household_id: string;
          id: string;
          kind: Database['public']['Enums']['recipe_image_kind'];
          mime_type: string;
          page_order: number;
          recipe_id: string;
          storage_path: string;
          width: number | null;
        };
        ComputedFields: never;
        Insert: {
          bytes?: number | null;
          created_at?: string;
          height?: number | null;
          household_id: string;
          id?: string;
          kind?: Database['public']['Enums']['recipe_image_kind'];
          mime_type: string;
          page_order?: number;
          recipe_id: string;
          storage_path: string;
          width?: number | null;
        };
        Update: {
          bytes?: number | null;
          created_at?: string;
          height?: number | null;
          household_id?: string;
          id?: string;
          kind?: Database['public']['Enums']['recipe_image_kind'];
          mime_type?: string;
          page_order?: number;
          recipe_id?: string;
          storage_path?: string;
          width?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'recipe_images_recipe_id_household_id_fkey';
            columns: ['recipe_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'recipes';
            referencedColumns: ['id', 'household_id'];
          },
        ];
      };
      recipe_ingredients: {
        Row: {
          approx_label: string | null;
          created_at: string;
          display_name: string | null;
          group_label: string | null;
          household_id: string;
          id: string;
          ingredient_id: string | null;
          optional: boolean;
          original_text: string;
          position: number;
          preparation: string | null;
          quantity_kind: Database['public']['Enums']['quantity_kind'];
          quantity_max: number | null;
          quantity_min: number | null;
          quantity_value: number | null;
          recipe_id: string;
          unit: Database['public']['Enums']['unit'] | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          approx_label?: string | null;
          created_at?: string;
          display_name?: string | null;
          group_label?: string | null;
          household_id: string;
          id?: string;
          ingredient_id?: string | null;
          optional?: boolean;
          original_text: string;
          position: number;
          preparation?: string | null;
          quantity_kind: Database['public']['Enums']['quantity_kind'];
          quantity_max?: number | null;
          quantity_min?: number | null;
          quantity_value?: number | null;
          recipe_id: string;
          unit?: Database['public']['Enums']['unit'] | null;
          updated_at?: string;
        };
        Update: {
          approx_label?: string | null;
          created_at?: string;
          display_name?: string | null;
          group_label?: string | null;
          household_id?: string;
          id?: string;
          ingredient_id?: string | null;
          optional?: boolean;
          original_text?: string;
          position?: number;
          preparation?: string | null;
          quantity_kind?: Database['public']['Enums']['quantity_kind'];
          quantity_max?: number | null;
          quantity_min?: number | null;
          quantity_value?: number | null;
          recipe_id?: string;
          unit?: Database['public']['Enums']['unit'] | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'recipe_ingredients_ingredient_id_fkey';
            columns: ['ingredient_id'];
            isOneToOne: false;
            referencedRelation: 'ingredients';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'recipe_ingredients_recipe_id_household_id_fkey';
            columns: ['recipe_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'recipes';
            referencedColumns: ['id', 'household_id'];
          },
        ];
      };
      recipe_ratings: {
        Row: {
          created_at: string;
          household_id: string;
          notes: string | null;
          rating: number;
          recipe_id: string;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          household_id: string;
          notes?: string | null;
          rating: number;
          recipe_id: string;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          household_id?: string;
          notes?: string | null;
          rating?: number;
          recipe_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'recipe_ratings_recipe_id_household_id_fkey';
            columns: ['recipe_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'recipes';
            referencedColumns: ['id', 'household_id'];
          },
        ];
      };
      recipe_steps: {
        Row: {
          created_at: string;
          duration_minutes: number | null;
          household_id: string;
          id: string;
          instructions: string;
          recipe_id: string;
          step_number: number;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          duration_minutes?: number | null;
          household_id: string;
          id?: string;
          instructions: string;
          recipe_id: string;
          step_number: number;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          duration_minutes?: number | null;
          household_id?: string;
          id?: string;
          instructions?: string;
          recipe_id?: string;
          step_number?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'recipe_steps_recipe_id_household_id_fkey';
            columns: ['recipe_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'recipes';
            referencedColumns: ['id', 'household_id'];
          },
        ];
      };
      recipe_tag_links: {
        Row: {
          created_at: string;
          household_id: string;
          recipe_id: string;
          tag_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          household_id: string;
          recipe_id: string;
          tag_id: string;
        };
        Update: {
          created_at?: string;
          household_id?: string;
          recipe_id?: string;
          tag_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'recipe_tag_links_recipe_id_household_id_fkey';
            columns: ['recipe_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'recipes';
            referencedColumns: ['id', 'household_id'];
          },
          {
            foreignKeyName: 'recipe_tag_links_tag_id_household_id_fkey';
            columns: ['tag_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'recipe_tags';
            referencedColumns: ['id', 'household_id'];
          },
        ];
      };
      recipe_tags: {
        Row: {
          created_at: string;
          household_id: string;
          id: string;
          name: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          household_id: string;
          id?: string;
          name: string;
        };
        Update: {
          created_at?: string;
          household_id?: string;
          id?: string;
          name?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'recipe_tags_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
        ];
      };
      recipe_versions: {
        Row: {
          corrected: NonNullable<Json>;
          created_at: string;
          created_by: string | null;
          extracted_at: string | null;
          extraction_model: string | null;
          household_id: string;
          id: string;
          original: Json | null;
          recipe_id: string;
          source_image_paths: string[];
          version_no: number;
        };
        ComputedFields: never;
        Insert: {
          corrected: NonNullable<Json>;
          created_at?: string;
          created_by?: string | null;
          extracted_at?: string | null;
          extraction_model?: string | null;
          household_id: string;
          id?: string;
          original?: Json | null;
          recipe_id: string;
          source_image_paths?: string[];
          version_no: number;
        };
        Update: {
          corrected?: NonNullable<Json>;
          created_at?: string;
          created_by?: string | null;
          extracted_at?: string | null;
          extraction_model?: string | null;
          household_id?: string;
          id?: string;
          original?: Json | null;
          recipe_id?: string;
          source_image_paths?: string[];
          version_no?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'recipe_versions_recipe_id_household_id_fkey';
            columns: ['recipe_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'recipes';
            referencedColumns: ['id', 'household_id'];
          },
        ];
      };
      recipes: {
        Row: {
          cook_minutes: number | null;
          cover_image_path: string | null;
          created_at: string;
          created_by: string | null;
          cuisine: string | null;
          default_servings: number;
          description: string | null;
          diet_category: Database['public']['Enums']['diet_category'] | null;
          household_id: string;
          id: string;
          meal_type: Database['public']['Enums']['meal_type'] | null;
          prep_minutes: number | null;
          search_ingredients: string;
          search_tags: string;
          search_tsv: unknown;
          source_attribution: string | null;
          source_url: string | null;
          status: Database['public']['Enums']['recipe_status'];
          title: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          cook_minutes?: number | null;
          cover_image_path?: string | null;
          created_at?: string;
          created_by?: string | null;
          cuisine?: string | null;
          default_servings?: number;
          description?: string | null;
          diet_category?: Database['public']['Enums']['diet_category'] | null;
          household_id: string;
          id?: string;
          meal_type?: Database['public']['Enums']['meal_type'] | null;
          prep_minutes?: number | null;
          search_ingredients?: string;
          search_tags?: string;
          search_tsv?: never;
          source_attribution?: string | null;
          source_url?: string | null;
          status?: Database['public']['Enums']['recipe_status'];
          title: string;
          updated_at?: string;
        };
        Update: {
          cook_minutes?: number | null;
          cover_image_path?: string | null;
          created_at?: string;
          created_by?: string | null;
          cuisine?: string | null;
          default_servings?: number;
          description?: string | null;
          diet_category?: Database['public']['Enums']['diet_category'] | null;
          household_id?: string;
          id?: string;
          meal_type?: Database['public']['Enums']['meal_type'] | null;
          prep_minutes?: number | null;
          search_ingredients?: string;
          search_tags?: string;
          search_tsv?: never;
          source_attribution?: string | null;
          source_url?: string | null;
          status?: Database['public']['Enums']['recipe_status'];
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'recipes_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
        ];
      };
      shopping_command_log: {
        Row: {
          command: NonNullable<Json>;
          command_id: string;
          command_type: string;
          created_at: string;
          created_by: string | null;
          household_id: string;
          list_seq: number;
          reason: string | null;
          result: NonNullable<Json>;
          seq: number;
          shopping_list_id: string;
          status: string;
        };
        ComputedFields: never;
        Insert: {
          command: NonNullable<Json>;
          command_id: string;
          command_type: string;
          created_at?: string;
          created_by?: string | null;
          household_id: string;
          list_seq: number;
          reason?: string | null;
          result?: NonNullable<Json>;
          seq?: never;
          shopping_list_id: string;
          status: string;
        };
        Update: {
          command?: NonNullable<Json>;
          command_id?: string;
          command_type?: string;
          created_at?: string;
          created_by?: string | null;
          household_id?: string;
          list_seq?: number;
          reason?: string | null;
          result?: NonNullable<Json>;
          seq?: never;
          shopping_list_id?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'shopping_command_log_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shopping_command_log_shopping_list_id_household_id_fkey';
            columns: ['shopping_list_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'shopping_lists';
            referencedColumns: ['id', 'household_id'];
          },
        ];
      };
      shopping_list_item_sources: {
        Row: {
          approx_label: string | null;
          created_at: string;
          household_id: string;
          id: string;
          ingredient_text_snapshot: string | null;
          original_text: string;
          planned_meal_id: string | null;
          quantity_kind: Database['public']['Enums']['quantity_kind'];
          quantity_max: number | null;
          quantity_min: number | null;
          quantity_value: number | null;
          recipe_id: string | null;
          recipe_ingredient_id: string | null;
          recipe_title_snapshot: string | null;
          shopping_list_item_id: string;
          unit: Database['public']['Enums']['unit'] | null;
        };
        ComputedFields: never;
        Insert: {
          approx_label?: string | null;
          created_at?: string;
          household_id: string;
          id?: string;
          ingredient_text_snapshot?: string | null;
          original_text?: string;
          planned_meal_id?: string | null;
          quantity_kind: Database['public']['Enums']['quantity_kind'];
          quantity_max?: number | null;
          quantity_min?: number | null;
          quantity_value?: number | null;
          recipe_id?: string | null;
          recipe_ingredient_id?: string | null;
          recipe_title_snapshot?: string | null;
          shopping_list_item_id: string;
          unit?: Database['public']['Enums']['unit'] | null;
        };
        Update: {
          approx_label?: string | null;
          created_at?: string;
          household_id?: string;
          id?: string;
          ingredient_text_snapshot?: string | null;
          original_text?: string;
          planned_meal_id?: string | null;
          quantity_kind?: Database['public']['Enums']['quantity_kind'];
          quantity_max?: number | null;
          quantity_min?: number | null;
          quantity_value?: number | null;
          recipe_id?: string | null;
          recipe_ingredient_id?: string | null;
          recipe_title_snapshot?: string | null;
          shopping_list_item_id?: string;
          unit?: Database['public']['Enums']['unit'] | null;
        };
        Relationships: [
          {
            foreignKeyName: 'shopping_list_item_sources_planned_meal_id_household_id_fkey';
            columns: ['planned_meal_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'planned_meals';
            referencedColumns: ['id', 'household_id'];
          },
          {
            foreignKeyName: 'shopping_list_item_sources_recipe_id_household_id_fkey';
            columns: ['recipe_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'recipes';
            referencedColumns: ['id', 'household_id'];
          },
          {
            foreignKeyName: 'shopping_list_item_sources_recipe_ingredient_id_household__fkey';
            columns: ['recipe_ingredient_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'recipe_ingredients';
            referencedColumns: ['id', 'household_id'];
          },
          {
            foreignKeyName: 'shopping_list_item_sources_shopping_list_item_id_household_fkey';
            columns: ['shopping_list_item_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'shopping_list_item_progress';
            referencedColumns: ['shopping_list_item_id', 'household_id'];
          },
          {
            foreignKeyName: 'shopping_list_item_sources_shopping_list_item_id_household_fkey';
            columns: ['shopping_list_item_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'shopping_list_items';
            referencedColumns: ['id', 'household_id'];
          },
        ];
      };
      shopping_list_items: {
        Row: {
          aisle: string | null;
          approx_label: string | null;
          category: string | null;
          created_at: string;
          created_by: string | null;
          display_name: string;
          estimated_price_kind: Database['public']['Enums']['price_kind'] | null;
          estimated_price_pence: number | null;
          household_id: string;
          id: string;
          ingredient_id: string | null;
          ingredient_ref: string | null;
          is_manual: boolean;
          item_key: string | null;
          manual_quantity: Json | null;
          notes: string | null;
          original_text: string;
          plan_linked: boolean;
          position: number;
          product_pack_id: string | null;
          quantity_kind: Database['public']['Enums']['quantity_kind'];
          quantity_max: number | null;
          quantity_min: number | null;
          quantity_value: number | null;
          removed_at: string | null;
          removed_by: string | null;
          removed_reason: string | null;
          requirement: Json | null;
          shopping_list_id: string;
          status: Database['public']['Enums']['shopping_item_status'];
          unit: Database['public']['Enums']['unit'] | null;
          unresolved: NonNullable<Json>;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          aisle?: string | null;
          approx_label?: string | null;
          category?: string | null;
          created_at?: string;
          created_by?: string | null;
          display_name: string;
          estimated_price_kind?: Database['public']['Enums']['price_kind'] | null;
          estimated_price_pence?: number | null;
          household_id: string;
          id?: string;
          ingredient_id?: string | null;
          ingredient_ref?: string | null;
          is_manual?: boolean;
          item_key?: string | null;
          manual_quantity?: Json | null;
          notes?: string | null;
          original_text?: string;
          plan_linked?: boolean;
          position?: number;
          product_pack_id?: string | null;
          quantity_kind: Database['public']['Enums']['quantity_kind'];
          quantity_max?: number | null;
          quantity_min?: number | null;
          quantity_value?: number | null;
          removed_at?: string | null;
          removed_by?: string | null;
          removed_reason?: string | null;
          requirement?: Json | null;
          shopping_list_id: string;
          status?: Database['public']['Enums']['shopping_item_status'];
          unit?: Database['public']['Enums']['unit'] | null;
          unresolved?: NonNullable<Json>;
          updated_at?: string;
        };
        Update: {
          aisle?: string | null;
          approx_label?: string | null;
          category?: string | null;
          created_at?: string;
          created_by?: string | null;
          display_name?: string;
          estimated_price_kind?: Database['public']['Enums']['price_kind'] | null;
          estimated_price_pence?: number | null;
          household_id?: string;
          id?: string;
          ingredient_id?: string | null;
          ingredient_ref?: string | null;
          is_manual?: boolean;
          item_key?: string | null;
          manual_quantity?: Json | null;
          notes?: string | null;
          original_text?: string;
          plan_linked?: boolean;
          position?: number;
          product_pack_id?: string | null;
          quantity_kind?: Database['public']['Enums']['quantity_kind'];
          quantity_max?: number | null;
          quantity_min?: number | null;
          quantity_value?: number | null;
          removed_at?: string | null;
          removed_by?: string | null;
          removed_reason?: string | null;
          requirement?: Json | null;
          shopping_list_id?: string;
          status?: Database['public']['Enums']['shopping_item_status'];
          unit?: Database['public']['Enums']['unit'] | null;
          unresolved?: NonNullable<Json>;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'shopping_list_items_ingredient_id_fkey';
            columns: ['ingredient_id'];
            isOneToOne: false;
            referencedRelation: 'ingredients';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shopping_list_items_product_pack_id_fkey';
            columns: ['product_pack_id'];
            isOneToOne: false;
            referencedRelation: 'product_packs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shopping_list_items_shopping_list_id_household_id_fkey';
            columns: ['shopping_list_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'shopping_lists';
            referencedColumns: ['id', 'household_id'];
          },
        ];
      };
      shopping_list_log_heads: {
        Row: {
          head: number;
          household_id: string;
          shopping_list_id: string;
        };
        ComputedFields: never;
        Insert: {
          head: number;
          household_id: string;
          shopping_list_id: string;
        };
        Update: {
          head?: number;
          household_id?: string;
          shopping_list_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'shopping_list_log_heads_shopping_list_id_household_id_fkey';
            columns: ['shopping_list_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'shopping_lists';
            referencedColumns: ['id', 'household_id'];
          },
        ];
      };
      shopping_lists: {
        Row: {
          created_at: string;
          created_by: string | null;
          household_id: string;
          id: string;
          meal_plan_id: string | null;
          name: string;
          status: Database['public']['Enums']['shopping_list_status'];
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string | null;
          household_id: string;
          id?: string;
          meal_plan_id?: string | null;
          name: string;
          status?: Database['public']['Enums']['shopping_list_status'];
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          household_id?: string;
          id?: string;
          meal_plan_id?: string | null;
          name?: string;
          status?: Database['public']['Enums']['shopping_list_status'];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'shopping_lists_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shopping_lists_meal_plan_id_household_id_fkey';
            columns: ['meal_plan_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'meal_plans';
            referencedColumns: ['id', 'household_id'];
          },
        ];
      };
      storage_cleanup_queue: {
        Row: {
          attempts: number;
          bucket: string;
          enqueued_at: string;
          household_id: string | null;
          id: string;
          last_error: string | null;
          object_path: string;
          processed_at: string | null;
          reason: string;
        };
        ComputedFields: never;
        Insert: {
          attempts?: number;
          bucket: string;
          enqueued_at?: string;
          household_id?: string | null;
          id?: string;
          last_error?: string | null;
          object_path: string;
          processed_at?: string | null;
          reason?: string;
        };
        Update: {
          attempts?: number;
          bucket?: string;
          enqueued_at?: string;
          household_id?: string | null;
          id?: string;
          last_error?: string | null;
          object_path?: string;
          processed_at?: string | null;
          reason?: string;
        };
        Relationships: [];
      };
      store_aisles: {
        Row: {
          created_at: string;
          household_id: string;
          id: string;
          label: string;
          sort_order: number;
          store_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          household_id: string;
          id?: string;
          label: string;
          sort_order?: number;
          store_id: string;
        };
        Update: {
          created_at?: string;
          household_id?: string;
          id?: string;
          label?: string;
          sort_order?: number;
          store_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'store_aisles_store_id_household_id_fkey';
            columns: ['store_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'stores';
            referencedColumns: ['id', 'household_id'];
          },
        ];
      };
      store_placements: {
        Row: {
          aisle_id: string;
          created_by: string | null;
          household_id: string;
          id: string;
          store_id: string;
          target_key: string;
          target_type: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          aisle_id: string;
          created_by?: string | null;
          household_id: string;
          id?: string;
          store_id: string;
          target_key: string;
          target_type: string;
          updated_at?: string;
        };
        Update: {
          aisle_id?: string;
          created_by?: string | null;
          household_id?: string;
          id?: string;
          store_id?: string;
          target_key?: string;
          target_type?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'store_placements_aisle_id_store_id_fkey';
            columns: ['aisle_id', 'store_id'];
            isOneToOne: false;
            referencedRelation: 'store_aisles';
            referencedColumns: ['id', 'store_id'];
          },
          {
            foreignKeyName: 'store_placements_store_id_household_id_fkey';
            columns: ['store_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'stores';
            referencedColumns: ['id', 'household_id'];
          },
        ];
      };
      stores: {
        Row: {
          chain: string | null;
          created_at: string;
          created_by: string | null;
          household_id: string;
          id: string;
          name: string;
          notes: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          chain?: string | null;
          created_at?: string;
          created_by?: string | null;
          household_id: string;
          id?: string;
          name: string;
          notes?: string | null;
          updated_at?: string;
        };
        Update: {
          chain?: string | null;
          created_at?: string;
          created_by?: string | null;
          household_id?: string;
          id?: string;
          name?: string;
          notes?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'stores_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      shopping_list_item_progress: {
        Row: {
          actual_spend_pence: number | null;
          has_unit_mismatch: boolean | null;
          household_id: string | null;
          last_purchased_at: string | null;
          outstanding_quantity: number | null;
          purchase_event_count: number | null;
          purchase_status: string | null;
          purchased_quantity: number | null;
          quantity_kind: Database['public']['Enums']['quantity_kind'] | null;
          required_quantity: number | null;
          shopping_list_id: string | null;
          shopping_list_item_id: string | null;
          unit: Database['public']['Enums']['unit'] | null;
        };
        ComputedFields: never;
        Relationships: [
          {
            foreignKeyName: 'shopping_list_items_shopping_list_id_household_id_fkey';
            columns: ['shopping_list_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'shopping_lists';
            referencedColumns: ['id', 'household_id'];
          },
        ];
      };
    };
    Functions: {
      accept_invitation: { Args: { p_token: string }; Returns: string };
      apply_shopping_command: {
        Args: {
          p_command: Json;
          p_command_id: string;
          p_command_type: string;
          p_expected_head?: number;
          p_items?: Json;
          p_list_id: string;
          p_result: Json;
        };
        Returns: Json;
      };
      backfill_pantry_purchase_mode: { Args: Record<PropertyKey, never>; Returns: number };
      begin_data_export: {
        Args: { p_household_id: string; p_scope: string };
        Returns: {
          allowed: boolean;
          expires_at: string;
          export_id: string;
          retry_after: string;
        }[];
      };
      cancel_account_deletion: { Args: Record<PropertyKey, never>; Returns: boolean };
      cancel_household_deletion: { Args: { p_household_id: string }; Returns: undefined };
      copy_store_layout: { Args: { p_from_store: string; p_household_id: string; p_to_store: string }; Returns: number };
      create_invitation: {
        Args: {
          p_email?: string;
          p_household_id: string;
          p_role?: Database['public']['Enums']['household_role'];
          p_ttl?: string;
        };
        Returns: {
          expires_at: string;
          invitation_id: string;
          token: string;
        }[];
      };
      delete_product_snapshot: {
        Args: { p_barcode: string; p_household_id: string };
        Returns: undefined;
      };
      enqueue_storage_cleanup: {
        Args: { p_bucket: string; p_household_id: string; p_path: string; p_reason: string };
        Returns: undefined;
      };
      ensure_shopping_list: { Args: { p_household_id: string }; Returns: string };
      find_recipe_duplicates: {
        Args: {
          p_exclude?: string;
          p_household_id: string;
          p_names: string[];
          p_title: string;
          p_user_id: string;
        };
        Returns: Json;
      };
      fr_norm_ingredient: { Args: { p: string }; Returns: string };
      fr_norm_title: { Args: { p: string }; Returns: string };
      get_household_ai_settings: { Args: { p_household_id: string }; Returns: Json };
      get_receipt: { Args: { p_household_id: string; p_receipt_id: string }; Returns: Json };
      get_recipes: {
        Args: { p_household_id: string; p_ids: string[]; p_user_id: string };
        Returns: Json;
      };
      household_is_active: { Args: { hid: string }; Returns: boolean };
      household_price_observations: { Args: { p_household_id: string }; Returns: Json };
      household_product_snapshots: { Args: { p_household_id: string }; Returns: Json };
      household_purchase_records: { Args: { p_household_id: string }; Returns: Json };
      household_store_book: { Args: { p_household_id: string }; Returns: Json };
      is_household_member: { Args: { hid: string }; Returns: boolean };
      is_household_owner: { Args: { hid: string }; Returns: boolean };
      is_household_writable: { Args: { hid: string }; Returns: boolean };
      jobs_complete_account_purge: { Args: { p_user_id: string }; Returns: undefined };
      jobs_due_account_deletions: {
        Args: { p_limit?: number };
        Returns: {
          replay: boolean;
          user_id: string;
        }[];
      };
      jobs_prepare_account_purge: { Args: { p_user_id: string }; Returns: string };
      jobs_purge_due: { Args: { p_limit?: number }; Returns: Json };
      jobs_status: { Args: { p_max_attempts?: number }; Returns: Json };
      list_receipts: { Args: { p_household_id: string }; Returns: Json };
      list_recipes: {
        Args: {
          p_collection?: string;
          p_cuisine?: string;
          p_diet?: Database['public']['Enums']['diet_category'];
          p_household_id: string;
          p_limit?: number;
          p_max_prep?: number;
          p_meal_type?: Database['public']['Enums']['meal_type'];
          p_offset?: number;
          p_query?: string;
          p_sort?: string;
          p_tags?: string[];
          p_user_id: string;
        };
        Returns: Json;
      };
      member_leave: { Args: { p_household_id: string }; Returns: undefined };
      metric_base_factor: { Args: { u: Database['public']['Enums']['unit'] }; Returns: number };
      my_account_deletion: { Args: Record<PropertyKey, never>; Returns: string };
      planner_household_profile: { Args: { p_household_id: string }; Returns: Json };
      purge_household: { Args: { p_household_id: string }; Returns: undefined };
      quantity_is_valid: {
        Args: {
          k: Database['public']['Enums']['quantity_kind'];
          mn: number;
          mx: number;
          u: Database['public']['Enums']['unit'];
          v: number;
        };
        Returns: boolean;
      };
      recipe_facets: { Args: { p_household_id: string }; Returns: Json };
      recipe_view_json: { Args: { p_recipe_id: string; p_user_id: string }; Returns: Json };
      record_data_export_download: {
        Args: {
          p_bytes?: number;
          p_counts?: Json;
          p_error?: string;
          p_export_id: string;
          p_ok: boolean;
        };
        Returns: undefined;
      };
      record_price_observations: {
        Args: { p_household_id: string; p_items: Json };
        Returns: number;
      };
      record_purchase: {
        Args: {
          p_event_id: string;
          p_expected_event_count?: number;
          p_expected_outstanding?: number;
          p_item_id: string;
          p_mode: string;
          p_price_pence?: number;
          p_qty?: Json;
          p_receipt_line_id?: string;
        };
        Returns: Json;
      };
      refresh_recipe_search: { Args: { p_recipe_id: string }; Returns: undefined };
      replace_pantry_items: { Args: { p_household_id: string; p_items: Json }; Returns: undefined };
      request_account_deletion: { Args: Record<PropertyKey, never>; Returns: string };
      request_household_deletion: {
        Args: { p_grace?: string; p_household_id: string };
        Returns: string;
      };
      save_household_ai_settings: {
        Args: { p_config: Json; p_household_id: string; p_keys: Json; p_provider: string };
        Returns: undefined;
      };
      set_member_dislikes: {
        Args: { p_household_id: string; p_member_user_id: string; p_terms: string[] };
        Returns: number;
      };
      save_meal_plan: {
        Args: { p_doc: Json; p_household_id: string; p_user_id: string };
        Returns: undefined;
      };
      save_product_snapshot: {
        Args: {
          p_barcode: string;
          p_household_id: string;
          p_ingredient_id: string;
          p_retrieved_at: string;
          p_snapshot: Json;
        };
        Returns: undefined;
      };
      save_receipt: {
        Args: { p_household_id: string; p_lines: Json; p_receipt: Json };
        Returns: string;
      };
      save_recipe: {
        Args: {
          p_household_id: string;
          p_id: string;
          p_input: Json;
          p_mode: string;
          p_user_id: string;
        };
        Returns: Json;
      };
      search_recipes: {
        Args: { p_household_id: string; p_limit?: number; p_query: string };
        Returns: {
          cook_minutes: number | null;
          cover_image_path: string | null;
          created_at: string;
          created_by: string | null;
          cuisine: string | null;
          default_servings: number;
          description: string | null;
          diet_category: Database['public']['Enums']['diet_category'] | null;
          household_id: string;
          id: string;
          meal_type: Database['public']['Enums']['meal_type'] | null;
          prep_minutes: number | null;
          search_ingredients: string;
          search_tags: string;
          search_tsv: unknown;
          source_attribution: string | null;
          source_url: string | null;
          status: Database['public']['Enums']['recipe_status'];
          title: string;
          updated_at: string;
        }[];
        SetofOptions: {
          from: '*';
          to: 'recipes';
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      select_meal_plans: {
        Args: { p_household_id: string; p_id?: string; p_start_date?: string };
        Returns: Json;
      };
      shopping_item_outstanding: { Args: { p_item_id: string }; Returns: number };
      shopping_list_activate: { Args: { p_household_id: string; p_list_id: string }; Returns: string };
      shopping_list_create: { Args: { p_household_id: string; p_list_id?: string; p_name: string }; Returns: string };
      shopping_list_snapshot: { Args: { p_household_id: string }; Returns: Json };
      transfer_ownership: {
        Args: { p_household_id: string; p_new_owner_member_id: string };
        Returns: undefined;
      };
      try_uuid: { Args: { t: string }; Returns: string };
      unit_dimension: {
        Args: { u: Database['public']['Enums']['unit'] };
        Returns: Database['public']['Enums']['dimension'];
      };
      void_purchase: { Args: { p_event_id: string; p_void_id: string }; Returns: Json };
    };
    Enums: {
      ai_operation:
        | 'recipe_extraction'
        | 'receipt_parse'
        | 'tagging'
        | 'meal_plan'
        | 'ingredient_match'
        | 'substitution';
      ai_status: 'success' | 'error' | 'invalid_output' | 'rate_limited' | 'rejected';
      allergen_group:
        | 'celery'
        | 'cereals_gluten'
        | 'crustaceans'
        | 'eggs'
        | 'fish'
        | 'lupin'
        | 'milk'
        | 'molluscs'
        | 'mustard'
        | 'peanuts'
        | 'sesame'
        | 'soya'
        | 'sulphites'
        | 'tree_nuts';
      consent_type: 'allergy_data' | 'dietary_restrictions';
      deletion_subject: 'household' | 'member' | 'account';
      diet_category: 'meat' | 'fish' | 'vegetarian' | 'vegan';
      dimension: 'mass' | 'volume' | 'count';
      exclusion_kind: 'allergy' | 'intolerance' | 'avoid';
      household_role: 'owner' | 'member';
      household_status: 'active' | 'pending_deletion';
      ingredient_form: 'fresh' | 'dried' | 'ground' | 'frozen' | 'canned' | 'other';
      meal_plan_status: 'draft' | 'approved' | 'archived';
      meal_type: 'breakfast' | 'lunch' | 'dinner' | 'snack';
      membership_status: 'active' | 'revoked' | 'left';
      nutrient_key:
        | 'energy_kcal'
        | 'energy_kj'
        | 'protein'
        | 'carbohydrate'
        | 'sugars'
        | 'fat'
        | 'saturates'
        | 'fibre'
        | 'salt'
        | 'sodium';
      nutrient_unit: 'kcal' | 'kJ' | 'g' | 'mg' | 'ug';
      nutrition_basis: 'total' | 'per_serving';
      pantry_source: 'manual' | 'purchase' | 'receipt' | 'correction' | 'leftover';
      planned_meal_kind: 'recipe' | 'leftovers' | 'eating_out' | 'other';
      preferred_units: 'metric' | 'imperial' | 'us';
      price_kind: 'user_confirmed' | 'receipt' | 'retailer_verified' | 'generic_estimate';
      quantity_kind: 'exact' | 'range' | 'approximate' | 'to_taste' | 'unparsed';
      receipt_line_match_status: 'unmatched' | 'suggested' | 'confirmed' | 'extra' | 'ignored';
      receipt_status: 'uploaded' | 'parsed' | 'reconciling' | 'reconciled' | 'failed';
      recipe_image_kind: 'source' | 'cover';
      recipe_status: 'draft' | 'active' | 'archived';
      shopping_item_status: 'active' | 'removed';
      shopping_list_status: 'active' | 'completed' | 'archived';
      unit:
        | 'mg'
        | 'g'
        | 'kg'
        | 'ml'
        | 'l'
        | 'tsp'
        | 'tbsp'
        | 'cup'
        | 'floz'
        | 'pint'
        | 'item'
        | 'clove'
        | 'slice'
        | 'can'
        | 'pack'
        | 'bunch'
        | 'sprig'
        | 'stick';
      value_status: 'known' | 'zero' | 'unknown' | 'unavailable';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      ai_operation: [
        'recipe_extraction',
        'receipt_parse',
        'tagging',
        'meal_plan',
        'ingredient_match',
        'substitution',
      ],
      ai_status: ['success', 'error', 'invalid_output', 'rate_limited', 'rejected'],
      allergen_group: [
        'celery',
        'cereals_gluten',
        'crustaceans',
        'eggs',
        'fish',
        'lupin',
        'milk',
        'molluscs',
        'mustard',
        'peanuts',
        'sesame',
        'soya',
        'sulphites',
        'tree_nuts',
      ],
      consent_type: ['allergy_data', 'dietary_restrictions'],
      deletion_subject: ['household', 'member', 'account'],
      diet_category: ['meat', 'fish', 'vegetarian', 'vegan'],
      dimension: ['mass', 'volume', 'count'],
      exclusion_kind: ['allergy', 'intolerance', 'avoid'],
      household_role: ['owner', 'member'],
      household_status: ['active', 'pending_deletion'],
      ingredient_form: ['fresh', 'dried', 'ground', 'frozen', 'canned', 'other'],
      meal_plan_status: ['draft', 'approved', 'archived'],
      meal_type: ['breakfast', 'lunch', 'dinner', 'snack'],
      membership_status: ['active', 'revoked', 'left'],
      nutrient_key: [
        'energy_kcal',
        'energy_kj',
        'protein',
        'carbohydrate',
        'sugars',
        'fat',
        'saturates',
        'fibre',
        'salt',
        'sodium',
      ],
      nutrient_unit: ['kcal', 'kJ', 'g', 'mg', 'ug'],
      nutrition_basis: ['total', 'per_serving'],
      pantry_source: ['manual', 'purchase', 'receipt', 'correction', 'leftover'],
      planned_meal_kind: ['recipe', 'leftovers', 'eating_out', 'other'],
      preferred_units: ['metric', 'imperial', 'us'],
      price_kind: ['user_confirmed', 'receipt', 'retailer_verified', 'generic_estimate'],
      quantity_kind: ['exact', 'range', 'approximate', 'to_taste', 'unparsed'],
      receipt_line_match_status: ['unmatched', 'suggested', 'confirmed', 'extra', 'ignored'],
      receipt_status: ['uploaded', 'parsed', 'reconciling', 'reconciled', 'failed'],
      recipe_image_kind: ['source', 'cover'],
      recipe_status: ['draft', 'active', 'archived'],
      shopping_item_status: ['active', 'removed'],
      shopping_list_status: ['active', 'completed', 'archived'],
      unit: [
        'mg',
        'g',
        'kg',
        'ml',
        'l',
        'tsp',
        'tbsp',
        'cup',
        'floz',
        'pint',
        'item',
        'clove',
        'slice',
        'can',
        'pack',
        'bunch',
        'sprig',
        'stick',
      ],
      value_status: ['known', 'zero', 'unknown', 'unavailable'],
    },
  },
} as const;
