export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      draft_duel_deadline_commitments: {
        Row: {
          cursor: string
          participant_id: string
          payload: Json
          pick_ordinal: number
          room_id: string
          updated_at: string
        }
        Insert: {
          cursor: string
          participant_id: string
          payload: Json
          pick_ordinal: number
          room_id: string
          updated_at?: string
        }
        Update: {
          cursor?: string
          participant_id?: string
          payload?: Json
          pick_ordinal?: number
          room_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "draft_duel_deadline_commitments_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "draft_duel_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_duel_join_attempts: {
        Row: {
          code: string | null
          created_at: string
          id: string
          uid: string | null
        }
        Insert: {
          code?: string | null
          created_at?: string
          id?: string
          uid?: string | null
        }
        Update: {
          code?: string | null
          created_at?: string
          id?: string
          uid?: string | null
        }
        Relationships: []
      }
      draft_duel_room_commands: {
        Row: {
          actor_participant_id: string
          command_id: string
          created_at: string
          ordinal: number
          payload: Json
          room_id: string
        }
        Insert: {
          actor_participant_id: string
          command_id: string
          created_at?: string
          ordinal: number
          payload: Json
          room_id: string
        }
        Update: {
          actor_participant_id?: string
          command_id?: string
          created_at?: string
          ordinal?: number
          payload?: Json
          room_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "draft_duel_room_commands_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "draft_duel_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_duel_room_members: {
        Row: {
          created_at: string
          last_seen_at: string
          locked: boolean
          next_game_ready: number
          online: boolean
          participant_id: string
          ready: boolean
          room_id: string
          uid: string
        }
        Insert: {
          created_at?: string
          last_seen_at?: string
          locked?: boolean
          next_game_ready?: number
          online?: boolean
          participant_id: string
          ready?: boolean
          room_id: string
          uid: string
        }
        Update: {
          created_at?: string
          last_seen_at?: string
          locked?: boolean
          next_game_ready?: number
          online?: boolean
          participant_id?: string
          ready?: boolean
          room_id?: string
          uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "draft_duel_room_members_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "draft_duel_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_duel_rooms: {
        Row: {
          broadcast: Json | null
          code: string | null
          code_active: boolean
          code_expires_at: string | null
          command_count: number
          confirmed_digest: string | null
          created_at: string
          deadline_at: string | null
          deadline_cursor: string | null
          deadline_fallback: Json | null
          deadline_participant: string | null
          deadline_pick_ordinal: number | null
          digest: string | null
          draft_state: Json
          expires_at: string
          fairness: string
          game_state: Json
          id: string
          phase: string
          presentation: string
          result_digest: string | null
          revision: number
          room_protocol_version: number
          room_schema_version: number
          root_seed: string
          series: Json | null
          successor_room_id: string | null
          updated_at: string
          versions: Json
        }
        Insert: {
          broadcast?: Json | null
          code?: string | null
          code_active?: boolean
          code_expires_at?: string | null
          command_count?: number
          confirmed_digest?: string | null
          created_at?: string
          deadline_at?: string | null
          deadline_cursor?: string | null
          deadline_fallback?: Json | null
          deadline_participant?: string | null
          deadline_pick_ordinal?: number | null
          digest?: string | null
          draft_state?: Json
          expires_at?: string
          fairness: string
          game_state?: Json
          id?: string
          phase?: string
          presentation: string
          result_digest?: string | null
          revision?: number
          room_protocol_version?: number
          room_schema_version?: number
          root_seed: string
          series?: Json | null
          successor_room_id?: string | null
          updated_at?: string
          versions: Json
        }
        Update: {
          broadcast?: Json | null
          code?: string | null
          code_active?: boolean
          code_expires_at?: string | null
          command_count?: number
          confirmed_digest?: string | null
          created_at?: string
          deadline_at?: string | null
          deadline_cursor?: string | null
          deadline_fallback?: Json | null
          deadline_participant?: string | null
          deadline_pick_ordinal?: number | null
          digest?: string | null
          draft_state?: Json
          expires_at?: string
          fairness?: string
          game_state?: Json
          id?: string
          phase?: string
          presentation?: string
          result_digest?: string | null
          revision?: number
          room_protocol_version?: number
          room_schema_version?: number
          root_seed?: string
          series?: Json | null
          successor_room_id?: string | null
          updated_at?: string
          versions?: Json
        }
        Relationships: [
          {
            foreignKeyName: "draft_duel_rooms_successor_room_id_fkey"
            columns: ["successor_room_id"]
            isOneToOne: false
            referencedRelation: "draft_duel_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_duel_server_versions: {
        Row: {
          key: string
          value: string
        }
        Insert: {
          key: string
          value: string
        }
        Update: {
          key?: string
          value?: string
        }
        Relationships: []
      }
      draft_duel_verification_receipts: {
        Row: {
          created_at: string
          participant_id: string
          receipt: Json
          receipt_id: string
          room_id: string
        }
        Insert: {
          created_at?: string
          participant_id: string
          receipt: Json
          receipt_id: string
          room_id: string
        }
        Update: {
          created_at?: string
          participant_id?: string
          receipt?: Json
          receipt_id?: string
          room_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "draft_duel_verification_receipts_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "draft_duel_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      fixed_five_deadline_commitments: {
        Row: {
          cursor: string
          participant_id: string
          payload: Json
          pick_ordinal: number
          room_id: string
          updated_at: string
        }
        Insert: {
          cursor: string
          participant_id: string
          payload: Json
          pick_ordinal: number
          room_id: string
          updated_at?: string
        }
        Update: {
          cursor?: string
          participant_id?: string
          payload?: Json
          pick_ordinal?: number
          room_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fixed_five_deadline_commitments_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "fixed_five_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      fixed_five_join_attempts: {
        Row: {
          code: string | null
          created_at: string
          id: string
          uid: string | null
        }
        Insert: {
          code?: string | null
          created_at?: string
          id?: string
          uid?: string | null
        }
        Update: {
          code?: string | null
          created_at?: string
          id?: string
          uid?: string | null
        }
        Relationships: []
      }
      fixed_five_room_commands: {
        Row: {
          actor_participant_id: string
          command_id: string
          created_at: string
          ordinal: number
          payload: Json
          room_id: string
        }
        Insert: {
          actor_participant_id: string
          command_id: string
          created_at?: string
          ordinal: number
          payload: Json
          room_id: string
        }
        Update: {
          actor_participant_id?: string
          command_id?: string
          created_at?: string
          ordinal?: number
          payload?: Json
          room_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fixed_five_room_commands_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "fixed_five_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      fixed_five_room_members: {
        Row: {
          created_at: string
          last_seen_at: string
          locked: boolean
          next_game_ready: number | null
          online: boolean
          participant_id: string
          picks_committed: number
          ready: boolean
          room_id: string
          uid: string
        }
        Insert: {
          created_at?: string
          last_seen_at?: string
          locked?: boolean
          next_game_ready?: number | null
          online?: boolean
          participant_id: string
          picks_committed?: number
          ready?: boolean
          room_id: string
          uid: string
        }
        Update: {
          created_at?: string
          last_seen_at?: string
          locked?: boolean
          next_game_ready?: number | null
          online?: boolean
          participant_id?: string
          picks_committed?: number
          ready?: boolean
          room_id?: string
          uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "fixed_five_room_members_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "fixed_five_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      fixed_five_rooms: {
        Row: {
          broadcast: Json | null
          code: string | null
          code_active: boolean
          code_expires_at: string | null
          command_count: number
          confirmed_digest: string | null
          created_at: string
          deadline_at: string | null
          deadline_cursor: string | null
          deadline_fallback: Json | null
          deadline_participant: string | null
          deadline_pick_ordinal: number | null
          digest: string | null
          expires_at: string
          game_state: Json | null
          id: string
          mode: string
          multiplayer_version: string
          phase: string
          result_digest: string | null
          revision: number
          room_protocol_version: number
          room_schema_version: number
          root_seed: string
          series: Json | null
          source_mode: string
          successor_room_id: string | null
          timer_policy_version: string
          updated_at: string
          variant: string
          versions: Json
        }
        Insert: {
          broadcast?: Json | null
          code?: string | null
          code_active?: boolean
          code_expires_at?: string | null
          command_count?: number
          confirmed_digest?: string | null
          created_at?: string
          deadline_at?: string | null
          deadline_cursor?: string | null
          deadline_fallback?: Json | null
          deadline_participant?: string | null
          deadline_pick_ordinal?: number | null
          digest?: string | null
          expires_at?: string
          game_state?: Json | null
          id?: string
          mode: string
          multiplayer_version?: string
          phase?: string
          result_digest?: string | null
          revision?: number
          room_protocol_version?: number
          room_schema_version?: number
          root_seed: string
          series?: Json | null
          source_mode: string
          successor_room_id?: string | null
          timer_policy_version?: string
          updated_at?: string
          variant: string
          versions: Json
        }
        Update: {
          broadcast?: Json | null
          code?: string | null
          code_active?: boolean
          code_expires_at?: string | null
          command_count?: number
          confirmed_digest?: string | null
          created_at?: string
          deadline_at?: string | null
          deadline_cursor?: string | null
          deadline_fallback?: Json | null
          deadline_participant?: string | null
          deadline_pick_ordinal?: number | null
          digest?: string | null
          expires_at?: string
          game_state?: Json | null
          id?: string
          mode?: string
          multiplayer_version?: string
          phase?: string
          result_digest?: string | null
          revision?: number
          room_protocol_version?: number
          room_schema_version?: number
          root_seed?: string
          series?: Json | null
          source_mode?: string
          successor_room_id?: string | null
          timer_policy_version?: string
          updated_at?: string
          variant?: string
          versions?: Json
        }
        Relationships: [
          {
            foreignKeyName: "fixed_five_rooms_successor_room_id_fkey"
            columns: ["successor_room_id"]
            isOneToOne: false
            referencedRelation: "fixed_five_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      fixed_five_server_versions: {
        Row: {
          key: string
          value: string
        }
        Insert: {
          key: string
          value: string
        }
        Update: {
          key?: string
          value?: string
        }
        Relationships: []
      }
      fixed_five_verification_receipts: {
        Row: {
          created_at: string
          participant_id: string
          receipt: Json
          receipt_id: string
          room_id: string
        }
        Insert: {
          created_at?: string
          participant_id: string
          receipt: Json
          receipt_id: string
          room_id: string
        }
        Update: {
          created_at?: string
          participant_id?: string
          receipt?: Json
          receipt_id?: string
          room_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fixed_five_verification_receipts_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "fixed_five_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      havoc_multiplayer_deadline_commitments: {
        Row: {
          cursor: string
          participant_id: string
          payload: Json
          pick_ordinal: number
          room_id: string
          updated_at: string
        }
        Insert: {
          cursor: string
          participant_id: string
          payload: Json
          pick_ordinal: number
          room_id: string
          updated_at?: string
        }
        Update: {
          cursor?: string
          participant_id?: string
          payload?: Json
          pick_ordinal?: number
          room_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "havoc_multiplayer_deadline_commitments_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "havoc_multiplayer_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      havoc_multiplayer_join_attempts: {
        Row: {
          code: string | null
          created_at: string
          id: string
          uid: string | null
        }
        Insert: {
          code?: string | null
          created_at?: string
          id?: string
          uid?: string | null
        }
        Update: {
          code?: string | null
          created_at?: string
          id?: string
          uid?: string | null
        }
        Relationships: []
      }
      havoc_multiplayer_room_commands: {
        Row: {
          actor_participant_id: string
          command_id: string
          created_at: string
          ordinal: number
          payload: Json
          room_id: string
        }
        Insert: {
          actor_participant_id: string
          command_id: string
          created_at?: string
          ordinal: number
          payload: Json
          room_id: string
        }
        Update: {
          actor_participant_id?: string
          command_id?: string
          created_at?: string
          ordinal?: number
          payload?: Json
          room_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "havoc_multiplayer_room_commands_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "havoc_multiplayer_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      havoc_multiplayer_room_members: {
        Row: {
          created_at: string
          last_seen_at: string
          locked: boolean
          next_game_ready: number
          online: boolean
          participant_id: string
          ready: boolean
          room_id: string
          uid: string
        }
        Insert: {
          created_at?: string
          last_seen_at?: string
          locked?: boolean
          next_game_ready?: number
          online?: boolean
          participant_id: string
          ready?: boolean
          room_id: string
          uid: string
        }
        Update: {
          created_at?: string
          last_seen_at?: string
          locked?: boolean
          next_game_ready?: number
          online?: boolean
          participant_id?: string
          ready?: boolean
          room_id?: string
          uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "havoc_multiplayer_room_members_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "havoc_multiplayer_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      havoc_multiplayer_rooms: {
        Row: {
          broadcast: Json | null
          code: string | null
          code_active: boolean
          code_expires_at: string | null
          command_count: number
          confirmed_digest: string | null
          created_at: string
          deadline_at: string | null
          deadline_cursor: string | null
          deadline_fallback: Json | null
          deadline_participant: string | null
          deadline_pick_ordinal: number | null
          digest: string | null
          draft_state: Json
          expires_at: string
          game_state: Json
          id: string
          phase: string
          result_digest: string | null
          revision: number
          root_seed: string
          series: Json | null
          successor_room_id: string | null
          updated_at: string
          variant: string
          versions: Json
        }
        Insert: {
          broadcast?: Json | null
          code?: string | null
          code_active?: boolean
          code_expires_at?: string | null
          command_count?: number
          confirmed_digest?: string | null
          created_at?: string
          deadline_at?: string | null
          deadline_cursor?: string | null
          deadline_fallback?: Json | null
          deadline_participant?: string | null
          deadline_pick_ordinal?: number | null
          digest?: string | null
          draft_state?: Json
          expires_at?: string
          game_state?: Json
          id?: string
          phase?: string
          result_digest?: string | null
          revision?: number
          root_seed: string
          series?: Json | null
          successor_room_id?: string | null
          updated_at?: string
          variant?: string
          versions: Json
        }
        Update: {
          broadcast?: Json | null
          code?: string | null
          code_active?: boolean
          code_expires_at?: string | null
          command_count?: number
          confirmed_digest?: string | null
          created_at?: string
          deadline_at?: string | null
          deadline_cursor?: string | null
          deadline_fallback?: Json | null
          deadline_participant?: string | null
          deadline_pick_ordinal?: number | null
          digest?: string | null
          draft_state?: Json
          expires_at?: string
          game_state?: Json
          id?: string
          phase?: string
          result_digest?: string | null
          revision?: number
          root_seed?: string
          series?: Json | null
          successor_room_id?: string | null
          updated_at?: string
          variant?: string
          versions?: Json
        }
        Relationships: [
          {
            foreignKeyName: "havoc_multiplayer_rooms_successor_room_id_fkey"
            columns: ["successor_room_id"]
            isOneToOne: false
            referencedRelation: "havoc_multiplayer_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      havoc_multiplayer_server_versions: {
        Row: {
          key: string
          value: string
        }
        Insert: {
          key: string
          value: string
        }
        Update: {
          key?: string
          value?: string
        }
        Relationships: []
      }
      havoc_multiplayer_verification_receipts: {
        Row: {
          created_at: string
          participant_id: string
          receipt: Json
          receipt_id: string
          room_id: string
        }
        Insert: {
          created_at?: string
          participant_id: string
          receipt: Json
          receipt_id: string
          room_id: string
        }
        Update: {
          created_at?: string
          participant_id?: string
          receipt?: Json
          receipt_id?: string
          room_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "havoc_multiplayer_verification_receipts_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "havoc_multiplayer_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      multiplayer_lobbies: {
        Row: {
          code: string
          expires_at: string
          game_kind: string | null
          game_room_id: string | null
          guest_uid: string | null
          host_uid: string
          id: string
          revision: number
        }
        Insert: {
          code: string
          expires_at?: string
          game_kind?: string | null
          game_room_id?: string | null
          guest_uid?: string | null
          host_uid: string
          id?: string
          revision?: number
        }
        Update: {
          code?: string
          expires_at?: string
          game_kind?: string | null
          game_room_id?: string | null
          guest_uid?: string | null
          host_uid?: string
          id?: string
          revision?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      draft_duel_command_submit: {
        Args: {
          p_command_id: string
          p_expected_revision: number
          p_payload: Json
          p_room_id: string
        }
        Returns: Json
      }
      draft_duel_commit_fallback: {
        Args: {
          p_cursor: string
          p_expected_revision: number
          p_payload: Json
          p_room_id: string
        }
        Returns: Json
      }
      draft_duel_complete: {
        Args: { p_receipt_id: string; p_room_id: string }
        Returns: Json
      }
      draft_duel_cron_tick: { Args: never; Returns: undefined }
      draft_duel_fail: { Args: { p_room_id: string }; Returns: Json }
      draft_duel_first_picker: {
        Args: { p_root_seed: string }
        Returns: string
      }
      draft_duel_home_winner: { Args: { p_root_seed: string }; Returns: string }
      draft_duel_is_member: { Args: { p_room_id: string }; Returns: boolean }
      draft_duel_leave: { Args: { p_room_id: string }; Returns: undefined }
      draft_duel_random_code: { Args: never; Returns: string }
      draft_duel_rematch: { Args: { p_room_id: string }; Returns: Json }
      draft_duel_room_create: {
        Args: { p_fairness: string; p_presentation: string; p_versions: Json }
        Returns: Json
      }
      draft_duel_room_join: { Args: { p_code: string }; Returns: Json }
      draft_duel_room_preview: { Args: { p_code: string }; Returns: Json }
      draft_duel_timeout_apply: { Args: { p_room_id: string }; Returns: Json }
      draft_duel_timeout_resolve: { Args: { p_room_id: string }; Returns: Json }
      draft_duel_verification_challenge: {
        Args: { p_room_id: string }
        Returns: string
      }
      draft_duel_verification_submit: {
        Args: {
          p_expected_revision: number
          p_receipt: Json
          p_receipt_id: string
          p_room_id: string
        }
        Returns: Json
      }
      draft_duel_versions_valid: {
        Args: { p_versions: Json }
        Returns: boolean
      }
      fixed_five_command_submit: {
        Args: {
          p_actor: string
          p_command_id: string
          p_expected_revision: number
          p_payload: Json
          p_room_id: string
        }
        Returns: Json
      }
      fixed_five_commit_fallback: {
        Args: {
          p_cursor: string
          p_expected_revision: number
          p_payload: Json
          p_room_id: string
        }
        Returns: Json
      }
      fixed_five_complete: {
        Args: { p_receipt_id: string; p_room_id: string }
        Returns: Json
      }
      fixed_five_cron_tick: { Args: never; Returns: undefined }
      fixed_five_fail: { Args: { p_room_id: string }; Returns: Json }
      fixed_five_guest_remove: {
        Args: { p_room_id: string; p_target: string }
        Returns: Json
      }
      fixed_five_is_member: { Args: { p_room_id: string }; Returns: boolean }
      fixed_five_leave: { Args: { p_room_id: string }; Returns: undefined }
      fixed_five_random_code: { Args: never; Returns: string }
      fixed_five_rematch: { Args: { p_room_id: string }; Returns: Json }
      fixed_five_room_create: {
        Args: {
          p_mode: string
          p_source_mode: string
          p_variant: string
          p_versions: Json
        }
        Returns: Json
      }
      fixed_five_room_join: { Args: { p_code: string }; Returns: Json }
      fixed_five_room_preview: { Args: { p_code: string }; Returns: Json }
      fixed_five_sandbox_picker: {
        Args: { p_pick_ordinal: number; p_root_seed: string }
        Returns: string
      }
      fixed_five_timeout_apply: { Args: { p_room_id: string }; Returns: Json }
      fixed_five_timeout_resolve: { Args: { p_room_id: string }; Returns: Json }
      fixed_five_verification_challenge: {
        Args: { p_room_id: string }
        Returns: string
      }
      fixed_five_verification_submit: {
        Args: {
          p_expected_revision: number
          p_receipt: Json
          p_receipt_id: string
          p_room_id: string
        }
        Returns: Json
      }
      fixed_five_versions_valid: {
        Args: { p_versions: Json }
        Returns: boolean
      }
      havoc_multiplayer_command_submit: {
        Args: {
          p_command_id: string
          p_expected_revision: number
          p_payload: Json
          p_room_id: string
        }
        Returns: Json
      }
      havoc_multiplayer_commit_fallback: {
        Args: {
          p_cursor: string
          p_expected_revision: number
          p_payload: Json
          p_room_id: string
        }
        Returns: Json
      }
      havoc_multiplayer_complete: {
        Args: { p_receipt_id: string; p_room_id: string }
        Returns: Json
      }
      havoc_multiplayer_cron_tick: { Args: never; Returns: undefined }
      havoc_multiplayer_fail: { Args: { p_room_id: string }; Returns: Json }
      havoc_multiplayer_first_picker: {
        Args: { p_root_seed: string }
        Returns: string
      }
      havoc_multiplayer_home_court: {
        Args: { p_root_seed: string }
        Returns: string
      }
      havoc_multiplayer_is_member: {
        Args: { p_room_id: string }
        Returns: boolean
      }
      havoc_multiplayer_leave: {
        Args: { p_room_id: string }
        Returns: undefined
      }
      havoc_multiplayer_random_code: { Args: never; Returns: string }
      havoc_multiplayer_rematch: { Args: { p_room_id: string }; Returns: Json }
      havoc_multiplayer_room_create: {
        Args: { p_variant?: string; p_versions: Json }
        Returns: Json
      }
      havoc_multiplayer_room_join: { Args: { p_code: string }; Returns: Json }
      havoc_multiplayer_room_preview: {
        Args: { p_code: string }
        Returns: Json
      }
      havoc_multiplayer_timeout_apply: {
        Args: { p_room_id: string }
        Returns: Json
      }
      havoc_multiplayer_timeout_resolve: {
        Args: { p_room_id: string }
        Returns: Json
      }
      havoc_multiplayer_verification_challenge: {
        Args: { p_room_id: string }
        Returns: string
      }
      havoc_multiplayer_verification_submit: {
        Args: {
          p_expected_revision: number
          p_receipt: Json
          p_receipt_id: string
          p_room_id: string
        }
        Returns: Json
      }
      havoc_multiplayer_versions_valid: {
        Args: { p_versions: Json }
        Returns: boolean
      }
      multiplayer_room_sync: {
        Args: { p_after_ordinal?: number; p_mode: string; p_room_id: string }
        Returns: Json
      }
      multiplayer_lobby_command: { Args: { p_command: Json }; Returns: Json }
      multiplayer_lobby_snapshot: {
        Args: { p_lobby_id: string }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  storage: {
    Tables: {
      buckets: {
        Row: {
          allowed_mime_types: string[] | null
          avif_autodetection: boolean | null
          created_at: string | null
          file_size_limit: number | null
          id: string
          name: string
          owner: string | null
          owner_id: string | null
          public: boolean | null
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string | null
          versioning_status: string
        }
        Insert: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id: string
          name: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string | null
          versioning_status?: string
        }
        Update: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id?: string
          name?: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string | null
          versioning_status?: string
        }
        Relationships: []
      }
      buckets_analytics: {
        Row: {
          created_at: string
          deleted_at: string | null
          format: string
          id: string
          name: string
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name?: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Relationships: []
      }
      buckets_vectors: {
        Row: {
          created_at: string
          id: string
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Relationships: []
      }
      iceberg_namespaces: {
        Row: {
          bucket_name: string
          catalog_id: string
          created_at: string
          id: string
          metadata: Json
          name: string
          updated_at: string
        }
        Insert: {
          bucket_name: string
          catalog_id: string
          created_at?: string
          id?: string
          metadata?: Json
          name: string
          updated_at?: string
        }
        Update: {
          bucket_name?: string
          catalog_id?: string
          created_at?: string
          id?: string
          metadata?: Json
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "iceberg_namespaces_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "buckets_analytics"
            referencedColumns: ["id"]
          },
        ]
      }
      iceberg_tables: {
        Row: {
          bucket_name: string
          catalog_id: string
          created_at: string
          id: string
          location: string
          name: string
          namespace_id: string
          remote_table_id: string | null
          shard_id: string | null
          shard_key: string | null
          updated_at: string
        }
        Insert: {
          bucket_name: string
          catalog_id: string
          created_at?: string
          id?: string
          location: string
          name: string
          namespace_id: string
          remote_table_id?: string | null
          shard_id?: string | null
          shard_key?: string | null
          updated_at?: string
        }
        Update: {
          bucket_name?: string
          catalog_id?: string
          created_at?: string
          id?: string
          location?: string
          name?: string
          namespace_id?: string
          remote_table_id?: string | null
          shard_id?: string | null
          shard_key?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "iceberg_tables_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "buckets_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "iceberg_tables_namespace_id_fkey"
            columns: ["namespace_id"]
            isOneToOne: false
            referencedRelation: "iceberg_namespaces"
            referencedColumns: ["id"]
          },
        ]
      }
      migrations: {
        Row: {
          executed_at: string | null
          hash: string
          id: number
          name: string
        }
        Insert: {
          executed_at?: string | null
          hash: string
          id: number
          name: string
        }
        Update: {
          executed_at?: string | null
          hash?: string
          id?: number
          name?: string
        }
        Relationships: []
      }
      objects: {
        Row: {
          archived_at: string | null
          bucket_id: string | null
          created_at: string | null
          id: string
          is_delete_marker: boolean
          is_versioned: boolean
          last_accessed_at: string | null
          metadata: Json | null
          name: string | null
          owner: string | null
          owner_id: string | null
          path_tokens: string[] | null
          updated_at: string | null
          user_metadata: Json | null
          version: string | null
        }
        Insert: {
          archived_at?: string | null
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          is_delete_marker?: boolean
          is_versioned?: boolean
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Update: {
          archived_at?: string | null
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          is_delete_marker?: boolean
          is_versioned?: boolean
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "objects_bucketId_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads: {
        Row: {
          bucket_id: string
          created_at: string
          id: string
          in_progress_size: number
          key: string
          metadata: Json | null
          owner_id: string | null
          upload_signature: string
          user_metadata: Json | null
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          id: string
          in_progress_size?: number
          key: string
          metadata?: Json | null
          owner_id?: string | null
          upload_signature: string
          user_metadata?: Json | null
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          id?: string
          in_progress_size?: number
          key?: string
          metadata?: Json | null
          owner_id?: string | null
          upload_signature?: string
          user_metadata?: Json | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads_parts: {
        Row: {
          bucket_id: string
          created_at: string
          etag: string
          id: string
          key: string
          owner_id: string | null
          part_number: number
          size: number
          upload_id: string
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          etag: string
          id?: string
          key: string
          owner_id?: string | null
          part_number: number
          size?: number
          upload_id: string
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          etag?: string
          id?: string
          key?: string
          owner_id?: string | null
          part_number?: number
          size?: number
          upload_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_parts_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "s3_multipart_uploads_parts_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "s3_multipart_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      vector_indexes: {
        Row: {
          bucket_id: string
          created_at: string
          data_type: string
          dimension: number
          distance_metric: string
          id: string
          metadata_configuration: Json | null
          name: string
          updated_at: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          data_type: string
          dimension: number
          distance_metric: string
          id?: string
          metadata_configuration?: Json | null
          name: string
          updated_at?: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          data_type?: string
          dimension?: number
          distance_metric?: string
          id?: string
          metadata_configuration?: Json | null
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vector_indexes_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets_vectors"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      allow_any_operation: {
        Args: { expected_operations: string[] }
        Returns: boolean
      }
      allow_only_operation: {
        Args: { expected_operation: string }
        Returns: boolean
      }
      can_insert_object: {
        Args: { bucketid: string; metadata: Json; name: string; owner: string }
        Returns: undefined
      }
      extension: { Args: { name: string }; Returns: string }
      filename: { Args: { name: string }; Returns: string }
      foldername: { Args: { name: string }; Returns: string[] }
      get_common_prefix: {
        Args: { p_delimiter: string; p_key: string; p_prefix: string }
        Returns: string
      }
      get_size_by_bucket: {
        Args: never
        Returns: {
          bucket_id: string
          size: number
        }[]
      }
      list_multipart_uploads_with_delimiter: {
        Args: {
          bucket_id: string
          delimiter_param: string
          max_keys?: number
          next_key_token?: string
          next_upload_token?: string
          prefix_param: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
        }[]
      }
      list_objects_with_delimiter: {
        Args: {
          _bucket_id: string
          delimiter_param: string
          max_keys?: number
          next_token?: string
          prefix_param: string
          sort_order?: string
          start_after?: string
        }
        Returns: {
          created_at: string
          id: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      operation: { Args: never; Returns: string }
      search: {
        Args: {
          bucketname: string
          levels?: number
          limits?: number
          offsets?: number
          prefix: string
          search?: string
          sortcolumn?: string
          sortorder?: string
        }
        Returns: {
          created_at: string
          id: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      search_by_timestamp: {
        Args: {
          p_bucket_id: string
          p_level: number
          p_limit: number
          p_prefix: string
          p_sort_column: string
          p_sort_column_after: string
          p_sort_order: string
          p_start_after: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      search_v2: {
        Args: {
          bucket_name: string
          levels?: number
          limits?: number
          prefix: string
          sort_column?: string
          sort_column_after?: string
          sort_order?: string
          start_after?: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
    }
    Enums: {
      buckettype: "STANDARD" | "ANALYTICS" | "VECTOR"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
  storage: {
    Enums: {
      buckettype: ["STANDARD", "ANALYTICS", "VECTOR"],
    },
  },
} as const

