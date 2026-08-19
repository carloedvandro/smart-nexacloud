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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      ai_sessions: {
        Row: {
          company_id: string
          conversation_id: string
          created_at: string
          ended_at: string | null
          handoff_reason: string | null
          id: string
          lead_id: string | null
          metadata: Json
          model: string | null
          started_at: string
          status: string
        }
        Insert: {
          company_id: string
          conversation_id: string
          created_at?: string
          ended_at?: string | null
          handoff_reason?: string | null
          id?: string
          lead_id?: string | null
          metadata?: Json
          model?: string | null
          started_at?: string
          status?: string
        }
        Update: {
          company_id?: string
          conversation_id?: string
          created_at?: string
          ended_at?: string | null
          handoff_reason?: string | null
          id?: string
          lead_id?: string | null
          metadata?: Json
          model?: string | null
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_sessions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_sessions_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_sessions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_summaries: {
        Row: {
          company_id: string
          conversation_id: string
          created_at: string
          id: string
          lead_id: string | null
          model: string | null
          summary: string
        }
        Insert: {
          company_id: string
          conversation_id: string
          created_at?: string
          id?: string
          lead_id?: string | null
          model?: string | null
          summary: string
        }
        Update: {
          company_id?: string
          conversation_id?: string
          created_at?: string
          id?: string
          lead_id?: string | null
          model?: string | null
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_summaries_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_summaries_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_summaries_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      assignment_attempts: {
        Row: {
          assigned_at: string
          company_id: string
          consultant_id: string | null
          conversation_id: string
          created_at: string
          deadline_at: string
          id: string
          resolved_at: string | null
          responded_at: string | null
          status: Database["public"]["Enums"]["assignment_attempt_status"]
        }
        Insert: {
          assigned_at?: string
          company_id: string
          consultant_id?: string | null
          conversation_id: string
          created_at?: string
          deadline_at: string
          id?: string
          resolved_at?: string | null
          responded_at?: string | null
          status?: Database["public"]["Enums"]["assignment_attempt_status"]
        }
        Update: {
          assigned_at?: string
          company_id?: string
          consultant_id?: string | null
          conversation_id?: string
          created_at?: string
          deadline_at?: string
          id?: string
          resolved_at?: string | null
          responded_at?: string | null
          status?: Database["public"]["Enums"]["assignment_attempt_status"]
        }
        Relationships: [
          {
            foreignKeyName: "assignment_attempts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_attempts_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_attempts_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          company_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          metadata: Json
          user_id: string | null
        }
        Insert: {
          action: string
          company_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json
          user_id?: string | null
        }
        Update: {
          action?: string
          company_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      business_hours: {
        Row: {
          company_id: string
          created_at: string
          end_time: string
          id: string
          is_active: boolean
          start_time: string
          timezone: string
          updated_at: string
          weekday: number
        }
        Insert: {
          company_id: string
          created_at?: string
          end_time?: string
          id?: string
          is_active?: boolean
          start_time?: string
          timezone?: string
          updated_at?: string
          weekday: number
        }
        Update: {
          company_id?: string
          created_at?: string
          end_time?: string
          id?: string
          is_active?: boolean
          start_time?: string
          timezone?: string
          updated_at?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "business_hours_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          address: string | null
          city: string | null
          created_at: string
          document: string | null
          email: string | null
          id: string
          legal_name: string | null
          max_consultants: number
          max_internal_users: number
          name: string
          phone: string | null
          settings: Json
          state: string | null
          status: Database["public"]["Enums"]["company_status"]
          updated_at: string
        }
        Insert: {
          address?: string | null
          city?: string | null
          created_at?: string
          document?: string | null
          email?: string | null
          id?: string
          legal_name?: string | null
          max_consultants?: number
          max_internal_users?: number
          name: string
          phone?: string | null
          settings?: Json
          state?: string | null
          status?: Database["public"]["Enums"]["company_status"]
          updated_at?: string
        }
        Update: {
          address?: string | null
          city?: string | null
          created_at?: string
          document?: string | null
          email?: string | null
          id?: string
          legal_name?: string | null
          max_consultants?: number
          max_internal_users?: number
          name?: string
          phone?: string | null
          settings?: Json
          state?: string | null
          status?: Database["public"]["Enums"]["company_status"]
          updated_at?: string
        }
        Relationships: []
      }
      company_invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          company_id: string
          created_at: string
          email: string | null
          expires_at: string
          id: string
          invited_by: string | null
          max_uses: number
          role: Database["public"]["Enums"]["app_role"]
          status: string
          token: string
          updated_at: string
          used_count: number
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          company_id: string
          created_at?: string
          email?: string | null
          expires_at?: string
          id?: string
          invited_by?: string | null
          max_uses?: number
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          token?: string
          updated_at?: string
          used_count?: number
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          company_id?: string
          created_at?: string
          email?: string | null
          expires_at?: string
          id?: string
          invited_by?: string | null
          max_uses?: number
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          token?: string
          updated_at?: string
          used_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "company_invites_accepted_by_fkey"
            columns: ["accepted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_invites_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_invites_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          company_id: string
          consultant_id: string | null
          conversation_id: string
          created_at: string
          ended_at: string | null
          id: string
          reason: string | null
          status: Database["public"]["Enums"]["assignment_status"]
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          company_id: string
          consultant_id?: string | null
          conversation_id: string
          created_at?: string
          ended_at?: string | null
          id?: string
          reason?: string | null
          status?: Database["public"]["Enums"]["assignment_status"]
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          company_id?: string
          consultant_id?: string | null
          conversation_id?: string
          created_at?: string
          ended_at?: string | null
          id?: string
          reason?: string | null
          status?: Database["public"]["Enums"]["assignment_status"]
        }
        Relationships: [
          {
            foreignKeyName: "conversation_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_assignments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_assignments_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_assignments_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_events: {
        Row: {
          actor_id: string | null
          company_id: string
          conversation_id: string
          created_at: string
          event_type: string
          id: string
          metadata: Json
        }
        Insert: {
          actor_id?: string | null
          company_id: string
          conversation_id: string
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json
        }
        Update: {
          actor_id?: string | null
          company_id?: string
          conversation_id?: string
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json
        }
        Relationships: [
          {
            foreignKeyName: "conversation_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_events_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          assigned_user_id: string | null
          channel: string
          channel_id: string | null
          closed_at: string | null
          company_id: string
          created_at: string
          id: string
          last_message_at: string | null
          lead_id: string
          metadata: Json
          started_at: string
          status: Database["public"]["Enums"]["conversation_status"]
          summary: string | null
          unread_count: number
          updated_at: string
        }
        Insert: {
          assigned_user_id?: string | null
          channel?: string
          channel_id?: string | null
          closed_at?: string | null
          company_id: string
          created_at?: string
          id?: string
          last_message_at?: string | null
          lead_id: string
          metadata?: Json
          started_at?: string
          status?: Database["public"]["Enums"]["conversation_status"]
          summary?: string | null
          unread_count?: number
          updated_at?: string
        }
        Update: {
          assigned_user_id?: string | null
          channel?: string
          channel_id?: string | null
          closed_at?: string | null
          company_id?: string
          created_at?: string
          id?: string
          last_message_at?: string | null
          lead_id?: string
          metadata?: Json
          started_at?: string
          status?: Database["public"]["Enums"]["conversation_status"]
          summary?: string | null
          unread_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_assigned_user_id_fkey"
            columns: ["assigned_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_base: {
        Row: {
          category: Database["public"]["Enums"]["knowledge_category"]
          company_id: string
          content: string
          created_at: string
          created_by: string | null
          id: string
          metadata: Json
          status: Database["public"]["Enums"]["content_status"]
          title: string
          updated_at: string
        }
        Insert: {
          category?: Database["public"]["Enums"]["knowledge_category"]
          company_id: string
          content: string
          created_at?: string
          created_by?: string | null
          id?: string
          metadata?: Json
          status?: Database["public"]["Enums"]["content_status"]
          title: string
          updated_at?: string
        }
        Update: {
          category?: Database["public"]["Enums"]["knowledge_category"]
          company_id?: string
          content?: string
          created_at?: string
          created_by?: string | null
          id?: string
          metadata?: Json
          status?: Database["public"]["Enums"]["content_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_base_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_base_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_memory: {
        Row: {
          company_id: string
          confidence: number | null
          created_at: string
          id: string
          key: string
          lead_id: string
          source: Database["public"]["Enums"]["sender_type"]
          updated_at: string
          value: string | null
        }
        Insert: {
          company_id: string
          confidence?: number | null
          created_at?: string
          id?: string
          key: string
          lead_id: string
          source?: Database["public"]["Enums"]["sender_type"]
          updated_at?: string
          value?: string | null
        }
        Update: {
          company_id?: string
          confidence?: number | null
          created_at?: string
          id?: string
          key?: string
          lead_id?: string
          source?: Database["public"]["Enums"]["sender_type"]
          updated_at?: string
          value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_memory_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_memory_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_notes: {
        Row: {
          author_id: string | null
          company_id: string
          content: string
          created_at: string
          id: string
          lead_id: string
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          company_id: string
          content: string
          created_at?: string
          id?: string
          lead_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          company_id?: string
          content?: string
          created_at?: string
          id?: string
          lead_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_notes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_notes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_notes_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          ad_id: string | null
          assigned_user_id: string | null
          campaign_id: string | null
          city: string | null
          closed_at: string | null
          company_id: string
          created_at: string
          email: string | null
          first_contact_at: string | null
          id: string
          last_interaction_at: string | null
          metadata: Json
          name: string | null
          phone: string | null
          qualified_at: string | null
          source: Database["public"]["Enums"]["lead_source"]
          state: string | null
          status: Database["public"]["Enums"]["lead_status"]
          updated_at: string
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          whatsapp: string | null
        }
        Insert: {
          ad_id?: string | null
          assigned_user_id?: string | null
          campaign_id?: string | null
          city?: string | null
          closed_at?: string | null
          company_id: string
          created_at?: string
          email?: string | null
          first_contact_at?: string | null
          id?: string
          last_interaction_at?: string | null
          metadata?: Json
          name?: string | null
          phone?: string | null
          qualified_at?: string | null
          source?: Database["public"]["Enums"]["lead_source"]
          state?: string | null
          status?: Database["public"]["Enums"]["lead_status"]
          updated_at?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          whatsapp?: string | null
        }
        Update: {
          ad_id?: string | null
          assigned_user_id?: string | null
          campaign_id?: string | null
          city?: string | null
          closed_at?: string | null
          company_id?: string
          created_at?: string
          email?: string | null
          first_contact_at?: string | null
          id?: string
          last_interaction_at?: string | null
          metadata?: Json
          name?: string | null
          phone?: string | null
          qualified_at?: string | null
          source?: Database["public"]["Enums"]["lead_source"]
          state?: string | null
          status?: Database["public"]["Enums"]["lead_status"]
          updated_at?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_assigned_user_id_fkey"
            columns: ["assigned_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      message_provider_payloads: {
        Row: {
          company_id: string
          created_at: string
          is_animated: boolean
          message_id: string
          provider_key: Json
          provider_message: Json
        }
        Insert: {
          company_id: string
          created_at?: string
          is_animated?: boolean
          message_id: string
          provider_key: Json
          provider_message: Json
        }
        Update: {
          company_id?: string
          created_at?: string
          is_animated?: boolean
          message_id?: string
          provider_key?: Json
          provider_message?: Json
        }
        Relationships: [
          {
            foreignKeyName: "message_provider_payloads_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_provider_payloads_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: true
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          company_id: string
          connection_id: string | null
          content: string | null
          conversation_id: string
          created_at: string
          delivered_at: string | null
          delivery_status: Database["public"]["Enums"]["message_delivery_status"]
          external_message_id: string | null
          failed_at: string | null
          failed_reason: string | null
          id: string
          max_send_attempts: number
          media_url: string | null
          message_type: Database["public"]["Enums"]["message_type"]
          metadata: Json
          mime_type: string | null
          next_retry_at: string | null
          read_at: string | null
          send_attempts: number
          sender_id: string | null
          sender_name: string | null
          sender_type: Database["public"]["Enums"]["sender_type"]
          transcription: string | null
          transcription_status: Database["public"]["Enums"]["transcription_status"]
        }
        Insert: {
          company_id: string
          connection_id?: string | null
          content?: string | null
          conversation_id: string
          created_at?: string
          delivered_at?: string | null
          delivery_status?: Database["public"]["Enums"]["message_delivery_status"]
          external_message_id?: string | null
          failed_at?: string | null
          failed_reason?: string | null
          id?: string
          max_send_attempts?: number
          media_url?: string | null
          message_type?: Database["public"]["Enums"]["message_type"]
          metadata?: Json
          mime_type?: string | null
          next_retry_at?: string | null
          read_at?: string | null
          send_attempts?: number
          sender_id?: string | null
          sender_name?: string | null
          sender_type: Database["public"]["Enums"]["sender_type"]
          transcription?: string | null
          transcription_status?: Database["public"]["Enums"]["transcription_status"]
        }
        Update: {
          company_id?: string
          connection_id?: string | null
          content?: string | null
          conversation_id?: string
          created_at?: string
          delivered_at?: string | null
          delivery_status?: Database["public"]["Enums"]["message_delivery_status"]
          external_message_id?: string | null
          failed_at?: string | null
          failed_reason?: string | null
          id?: string
          max_send_attempts?: number
          media_url?: string | null
          message_type?: Database["public"]["Enums"]["message_type"]
          metadata?: Json
          mime_type?: string | null
          next_retry_at?: string | null
          read_at?: string | null
          send_attempts?: number
          sender_id?: string | null
          sender_name?: string | null
          sender_type?: Database["public"]["Enums"]["sender_type"]
          transcription?: string | null
          transcription_status?: Database["public"]["Enums"]["transcription_status"]
        }
        Relationships: [
          {
            foreignKeyName: "messages_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      privacy_consents: {
        Row: {
          accepted: boolean
          accepted_at: string | null
          company_id: string
          consent_type: string
          created_at: string
          id: string
          lead_id: string | null
          metadata: Json
          version: string
        }
        Insert: {
          accepted?: boolean
          accepted_at?: string | null
          company_id: string
          consent_type: string
          created_at?: string
          id?: string
          lead_id?: string | null
          metadata?: Json
          version: string
        }
        Update: {
          accepted?: boolean
          accepted_at?: string | null
          company_id?: string
          consent_type?: string
          created_at?: string
          id?: string
          lead_id?: string | null
          metadata?: Json
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "privacy_consents_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "privacy_consents_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          availability: Database["public"]["Enums"]["availability_status"]
          avatar_url: string | null
          company_id: string | null
          created_at: string
          document: string | null
          email: string | null
          full_name: string | null
          id: string
          is_active: boolean
          last_seen_at: string | null
          metadata: Json
          person_type: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          availability?: Database["public"]["Enums"]["availability_status"]
          avatar_url?: string | null
          company_id?: string | null
          created_at?: string
          document?: string | null
          email?: string | null
          full_name?: string | null
          id: string
          is_active?: boolean
          last_seen_at?: string | null
          metadata?: Json
          person_type?: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          availability?: Database["public"]["Enums"]["availability_status"]
          avatar_url?: string | null
          company_id?: string | null
          created_at?: string
          document?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          is_active?: boolean
          last_seen_at?: string | null
          metadata?: Json
          person_type?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      queue_settings: {
        Row: {
          business_hours_enabled: boolean
          company_id: string
          created_at: string
          distribution_mode: Database["public"]["Enums"]["distribution_mode"]
          id: string
          max_concurrent_per_consultant: number
          metadata: Json
          only_online: boolean
          round_robin_position: number
          sla_seconds: number
          updated_at: string
        }
        Insert: {
          business_hours_enabled?: boolean
          company_id: string
          created_at?: string
          distribution_mode?: Database["public"]["Enums"]["distribution_mode"]
          id?: string
          max_concurrent_per_consultant?: number
          metadata?: Json
          only_online?: boolean
          round_robin_position?: number
          sla_seconds?: number
          updated_at?: string
        }
        Update: {
          business_hours_enabled?: boolean
          company_id?: string
          created_at?: string
          distribution_mode?: Database["public"]["Enums"]["distribution_mode"]
          id?: string
          max_concurrent_per_consultant?: number
          metadata?: Json
          only_online?: boolean
          round_robin_position?: number
          sla_seconds?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "queue_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      service_ratings: {
        Row: {
          asked_at: string
          comment: string | null
          company_id: string
          conversation_id: string
          created_at: string
          id: string
          lead_id: string | null
          rated_at: string | null
          rating: number | null
          reason: string
        }
        Insert: {
          asked_at?: string
          comment?: string | null
          company_id: string
          conversation_id: string
          created_at?: string
          id?: string
          lead_id?: string | null
          rated_at?: string | null
          rating?: number | null
          reason?: string
        }
        Update: {
          asked_at?: string
          comment?: string | null
          company_id?: string
          conversation_id?: string
          created_at?: string
          id?: string
          lead_id?: string | null
          rated_at?: string | null
          rating?: number | null
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_ratings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_ratings_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: true
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_ratings_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      system_settings: {
        Row: {
          company_id: string
          created_at: string
          id: string
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "system_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          company_id: string | null
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_connections: {
        Row: {
          assigned_at: string | null
          assigned_by: string | null
          company_id: string
          created_at: string
          id: string
          instance_id: string | null
          instance_number: number | null
          is_trunk: boolean
          last_connected_at: string | null
          last_disconnected_at: string | null
          last_event_at: string | null
          metadata: Json
          name: string | null
          phone_number: string | null
          provider: string
          provisioned_at: string
          provisioned_by: string | null
          qr_code: string | null
          qr_code_status: string | null
          status: Database["public"]["Enums"]["whatsapp_connection_status"]
          updated_at: string
          user_id: string | null
          webhook_token: string
        }
        Insert: {
          assigned_at?: string | null
          assigned_by?: string | null
          company_id: string
          created_at?: string
          id?: string
          instance_id?: string | null
          instance_number?: number | null
          is_trunk?: boolean
          last_connected_at?: string | null
          last_disconnected_at?: string | null
          last_event_at?: string | null
          metadata?: Json
          name?: string | null
          phone_number?: string | null
          provider?: string
          provisioned_at?: string
          provisioned_by?: string | null
          qr_code?: string | null
          qr_code_status?: string | null
          status?: Database["public"]["Enums"]["whatsapp_connection_status"]
          updated_at?: string
          user_id?: string | null
          webhook_token?: string
        }
        Update: {
          assigned_at?: string | null
          assigned_by?: string | null
          company_id?: string
          created_at?: string
          id?: string
          instance_id?: string | null
          instance_number?: number | null
          is_trunk?: boolean
          last_connected_at?: string | null
          last_disconnected_at?: string | null
          last_event_at?: string | null
          metadata?: Json
          name?: string | null
          phone_number?: string | null
          provider?: string
          provisioned_at?: string
          provisioned_by?: string | null
          qr_code?: string | null
          qr_code_status?: string | null
          status?: Database["public"]["Enums"]["whatsapp_connection_status"]
          updated_at?: string
          user_id?: string | null
          webhook_token?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_connections_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_connections_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_connections_provisioned_by_fkey"
            columns: ["provisioned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_connections_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_credentials: {
        Row: {
          api_host: string | null
          api_key: string | null
          company_id: string
          connection_id: string
          created_at: string
          instance_key: string
          updated_at: string
        }
        Insert: {
          api_host?: string | null
          api_key?: string | null
          company_id: string
          connection_id: string
          created_at?: string
          instance_key: string
          updated_at?: string
        }
        Update: {
          api_host?: string | null
          api_key?: string | null
          company_id?: string
          connection_id?: string
          created_at?: string
          instance_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_credentials_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_credentials_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: true
            referencedRelation: "whatsapp_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_events: {
        Row: {
          company_id: string | null
          connection_id: string | null
          created_at: string
          error: string | null
          event_type: string | null
          external_event_id: string | null
          id: string
          payload: Json
          processed_at: string | null
          provider: string
        }
        Insert: {
          company_id?: string | null
          connection_id?: string | null
          created_at?: string
          error?: string | null
          event_type?: string | null
          external_event_id?: string | null
          id?: string
          payload?: Json
          processed_at?: string | null
          provider?: string
        }
        Update: {
          company_id?: string | null
          connection_id?: string | null
          created_at?: string
          error?: string | null
          event_type?: string | null
          external_event_id?: string | null
          id?: string
          payload?: Json
          processed_at?: string | null
          provider?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_events_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_instance_assignments: {
        Row: {
          assigned_by: string | null
          company_id: string
          connection_id: string
          created_at: string
          ended_at: string | null
          id: string
          phone_number: string | null
          release_reason: string | null
          released_by: string | null
          started_at: string
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          assigned_by?: string | null
          company_id: string
          connection_id: string
          created_at?: string
          ended_at?: string | null
          id?: string
          phone_number?: string | null
          release_reason?: string | null
          released_by?: string | null
          started_at?: string
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          assigned_by?: string | null
          company_id?: string
          connection_id?: string
          created_at?: string
          ended_at?: string | null
          id?: string
          phone_number?: string | null
          release_reason?: string | null
          released_by?: string | null
          started_at?: string
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_instance_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_instance_assignments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_instance_assignments_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_instance_assignments_released_by_fkey"
            columns: ["released_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_instance_assignments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_company_invites: {
        Args: { _email: string; _user_id: string }
        Returns: string
      }
      assert_company_license: {
        Args: {
          _company: string
          _new_user?: boolean
          _role: Database["public"]["Enums"]["app_role"]
        }
        Returns: undefined
      }
      assert_company_member: {
        Args: { _company_id: string }
        Returns: undefined
      }
      assign_conversation: {
        Args: { _consultant_id: string; _conversation_id: string }
        Returns: undefined
      }
      assign_lead: {
        Args: { _consultant_id: string; _lead_id: string }
        Returns: undefined
      }
      assign_whatsapp_instance: {
        Args: { _connection_id: string; _user_id: string }
        Returns: undefined
      }
      bootstrap_company: {
        Args: { _document?: string; _legal_name?: string; _name: string }
        Returns: string
      }
      can_view_conversation: {
        Args: { _conversation_id: string }
        Returns: boolean
      }
      can_view_lead: { Args: { _lead_id: string }; Returns: boolean }
      claim_company_invite: { Args: never; Returns: string }
      company_cancel_invite: {
        Args: { _invite_id: string }
        Returns: undefined
      }
      company_invite_member: {
        Args: {
          _email: string
          _role?: Database["public"]["Enums"]["app_role"]
        }
        Returns: Json
      }
      company_license_usage: { Args: { _company?: string }; Returns: Json }
      company_remove_member: { Args: { _user_id: string }; Returns: undefined }
      company_set_member_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: undefined
      }
      create_invite_link: {
        Args: {
          _company_id?: string
          _email?: string
          _expires_hours?: number
          _role?: Database["public"]["Enums"]["app_role"]
        }
        Returns: Json
      }
      create_outbound_message: {
        Args: {
          _company_id: string
          _connection_id?: string
          _content: string
          _conversation_id: string
          _media_url?: string
          _message_type?: Database["public"]["Enums"]["message_type"]
          _sender_id: string
          _sender_name: string
          _sender_type: Database["public"]["Enums"]["sender_type"]
        }
        Returns: string
      }
      current_company_id: { Args: never; Returns: string }
      enqueue_conversation: {
        Args: { _conversation_id: string; _reason?: string }
        Returns: string
      }
      finalize_outbound_message: {
        Args: {
          _external_message_id: string
          _message_id: string
          _reason?: string
          _status: Database["public"]["Enums"]["message_delivery_status"]
        }
        Returns: undefined
      }
      get_or_create_conversation: {
        Args: { _channel?: string; _lead_id: string }
        Returns: string
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      ingest_inbound_message: {
        Args: {
          _connection_id: string
          _content?: string
          _external_message_id: string
          _media_url?: string
          _message_type?: Database["public"]["Enums"]["message_type"]
          _metadata?: Json
          _mime_type?: string
          _push_name?: string
          _remote_jid: string
        }
        Returns: Json
      }
      ingest_outbound_echo: {
        Args: {
          _connection_id: string
          _content?: string
          _external_message_id: string
          _media_url?: string
          _message_type?: Database["public"]["Enums"]["message_type"]
          _metadata?: Json
          _mime_type?: string
          _remote_jid: string
        }
        Returns: Json
      }
      invite_link_info: { Args: { _token: string }; Returns: Json }
      is_abandoned_conversation: {
        Args: { _conversation_id: string }
        Returns: boolean
      }
      is_company_admin: { Args: never; Returns: boolean }
      is_platform_admin: { Args: never; Returns: boolean }
      log_impersonation: {
        Args: { _target_user_id: string }
        Returns: undefined
      }
      mark_conversation_read: {
        Args: { _conversation_id: string }
        Returns: undefined
      }
      normalize_phone: { Args: { _raw: string }; Returns: string }
      platform_invite_company_member: {
        Args: {
          _company_id: string
          _email: string
          _role?: Database["public"]["Enums"]["app_role"]
        }
        Returns: Json
      }
      platform_remove_company_member: {
        Args: { _company_id: string; _user_id: string }
        Returns: undefined
      }
      platform_set_company_limits: {
        Args: {
          _company_id: string
          _max_consultants: number
          _max_internal_users: number
        }
        Returns: undefined
      }
      platform_set_member_role: {
        Args: {
          _company_id: string
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: undefined
      }
      post_message: {
        Args: {
          _content?: string
          _conversation_id: string
          _external_message_id?: string
          _media_url?: string
          _message_type?: Database["public"]["Enums"]["message_type"]
          _metadata?: Json
          _mime_type?: string
          _sender_name?: string
          _sender_type: Database["public"]["Enums"]["sender_type"]
        }
        Returns: string
      }
      provision_whatsapp_instance: {
        Args: {
          _api_host?: string
          _api_key?: string
          _company_id: string
          _instance_key: string
          _instance_number?: number
          _name?: string
        }
        Returns: string
      }
      queue_assign_next: { Args: { _conversation_id: string }; Returns: string }
      queue_register_response: {
        Args: { _conversation_id: string; _user_id: string }
        Returns: undefined
      }
      queue_tick: { Args: never; Returns: number }
      raise_license_limit: { Args: { _company: string }; Returns: undefined }
      redeem_invite_link: {
        Args: { _document?: string; _token: string }
        Returns: string
      }
      release_whatsapp_instance: {
        Args: { _connection_id: string; _reason?: string }
        Returns: undefined
      }
      set_conversation_status: {
        Args: {
          _conversation_id: string
          _status: Database["public"]["Enums"]["conversation_status"]
        }
        Returns: undefined
      }
      set_conversation_summary: {
        Args: { _conversation_id: string; _summary: string }
        Returns: undefined
      }
      set_instance_connection_state: {
        Args: {
          _connection_id: string
          _phone_number?: string
          _qr_code?: string
          _qr_code_status?: string
          _status: Database["public"]["Enums"]["whatsapp_connection_status"]
        }
        Returns: undefined
      }
      set_lead_status: {
        Args: {
          _lead_id: string
          _status: Database["public"]["Enums"]["lead_status"]
        }
        Returns: undefined
      }
      set_message_transcription: {
        Args: {
          _message_id: string
          _status: Database["public"]["Enums"]["transcription_status"]
          _transcription?: string
        }
        Returns: undefined
      }
      set_trunk_whatsapp_instance: {
        Args: { _connection_id: string }
        Returns: undefined
      }
      update_message_delivery: {
        Args: {
          _company_id: string
          _external_message_id: string
          _reason?: string
          _status: Database["public"]["Enums"]["message_delivery_status"]
        }
        Returns: boolean
      }
      upsert_lead: {
        Args: {
          _assigned_user_id?: string
          _city?: string
          _email?: string
          _metadata?: Json
          _name?: string
          _phone?: string
          _source?: Database["public"]["Enums"]["lead_source"]
          _state?: string
        }
        Returns: string
      }
      upsert_lead_memory: {
        Args: {
          _confidence?: number
          _key: string
          _lead_id: string
          _source?: Database["public"]["Enums"]["sender_type"]
          _value: string
        }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "ADMIN" | "CONSULTANT" | "PLATFORM_ADMIN"
      assignment_attempt_status:
        | "WAITING"
        | "RESPONDED"
        | "TIMEOUT"
        | "CANCELLED"
      assignment_status: "ACTIVE" | "RELEASED" | "TRANSFERRED" | "CLOSED"
      availability_status: "ONLINE" | "OFFLINE" | "PAUSED" | "BUSY"
      company_status: "ACTIVE" | "SUSPENDED" | "INACTIVE"
      content_status: "DRAFT" | "ACTIVE" | "ARCHIVED"
      conversation_status:
        | "AI_ACTIVE"
        | "WAITING_HUMAN"
        | "QUEUED"
        | "ASSIGNED"
        | "HUMAN_ACTIVE"
        | "WAITING_CUSTOMER"
        | "CLOSED"
        | "PAUSED"
      distribution_mode: "ROUND_ROBIN" | "LEAST_BUSY" | "MANUAL"
      knowledge_category:
        | "planos"
        | "operadoras"
        | "precos"
        | "coberturas"
        | "carencias"
        | "faq"
        | "processos"
        | "institucional"
        | "outros"
      lead_source:
        | "facebook"
        | "instagram"
        | "whatsapp"
        | "site"
        | "indicacao"
        | "outro"
      lead_status:
        | "NEW"
        | "AI_QUALIFYING"
        | "QUALIFIED"
        | "IN_SERVICE"
        | "WON"
        | "LOST"
        | "ARCHIVED"
        | "WAITING_HUMAN"
        | "WAITING_CUSTOMER"
      message_delivery_status:
        | "PENDING"
        | "SENT"
        | "DELIVERED"
        | "READ"
        | "FAILED"
      message_type:
        | "text"
        | "audio"
        | "image"
        | "document"
        | "video"
        | "system"
        | "other"
        | "sticker"
      sender_type: "customer" | "ai" | "consultant" | "admin" | "system"
      transcription_status:
        | "NONE"
        | "PENDING"
        | "PROCESSING"
        | "COMPLETED"
        | "FAILED"
      whatsapp_connection_status:
        | "DISCONNECTED"
        | "CONNECTING"
        | "CONNECTED"
        | "ERROR"
        | "LOGGED_OUT"
        | "AVAILABLE"
        | "BLOCKED"
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
    Enums: {
      app_role: ["ADMIN", "CONSULTANT", "PLATFORM_ADMIN"],
      assignment_attempt_status: [
        "WAITING",
        "RESPONDED",
        "TIMEOUT",
        "CANCELLED",
      ],
      assignment_status: ["ACTIVE", "RELEASED", "TRANSFERRED", "CLOSED"],
      availability_status: ["ONLINE", "OFFLINE", "PAUSED", "BUSY"],
      company_status: ["ACTIVE", "SUSPENDED", "INACTIVE"],
      content_status: ["DRAFT", "ACTIVE", "ARCHIVED"],
      conversation_status: [
        "AI_ACTIVE",
        "WAITING_HUMAN",
        "QUEUED",
        "ASSIGNED",
        "HUMAN_ACTIVE",
        "WAITING_CUSTOMER",
        "CLOSED",
        "PAUSED",
      ],
      distribution_mode: ["ROUND_ROBIN", "LEAST_BUSY", "MANUAL"],
      knowledge_category: [
        "planos",
        "operadoras",
        "precos",
        "coberturas",
        "carencias",
        "faq",
        "processos",
        "institucional",
        "outros",
      ],
      lead_source: [
        "facebook",
        "instagram",
        "whatsapp",
        "site",
        "indicacao",
        "outro",
      ],
      lead_status: [
        "NEW",
        "AI_QUALIFYING",
        "QUALIFIED",
        "IN_SERVICE",
        "WON",
        "LOST",
        "ARCHIVED",
        "WAITING_HUMAN",
        "WAITING_CUSTOMER",
      ],
      message_delivery_status: [
        "PENDING",
        "SENT",
        "DELIVERED",
        "READ",
        "FAILED",
      ],
      message_type: [
        "text",
        "audio",
        "image",
        "document",
        "video",
        "system",
        "other",
        "sticker",
      ],
      sender_type: ["customer", "ai", "consultant", "admin", "system"],
      transcription_status: [
        "NONE",
        "PENDING",
        "PROCESSING",
        "COMPLETED",
        "FAILED",
      ],
      whatsapp_connection_status: [
        "DISCONNECTED",
        "CONNECTING",
        "CONNECTED",
        "ERROR",
        "LOGGED_OUT",
        "AVAILABLE",
        "BLOCKED",
      ],
    },
  },
} as const
