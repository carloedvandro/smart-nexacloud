
CREATE TYPE public.whatsapp_connection_status AS ENUM ('DISCONNECTED','CONNECTING','CONNECTED','ERROR','LOGGED_OUT');
CREATE TYPE public.knowledge_category AS ENUM ('planos','operadoras','precos','coberturas','carencias','faq','processos','institucional','outros');
CREATE TYPE public.content_status AS ENUM ('DRAFT','ACTIVE','ARCHIVED');
CREATE TYPE public.distribution_mode AS ENUM ('ROUND_ROBIN','LEAST_BUSY','MANUAL');

-- WHATSAPP
CREATE TABLE public.whatsapp_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  name text,
  provider text NOT NULL DEFAULT 'megaapi',
  instance_id text,
  phone_number text,
  status public.whatsapp_connection_status NOT NULL DEFAULT 'DISCONNECTED',
  qr_code_status text,
  last_connected_at timestamptz,
  last_disconnected_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_wa_conn_company ON public.whatsapp_connections(company_id);
CREATE UNIQUE INDEX uq_wa_conn_instance ON public.whatsapp_connections(provider, instance_id) WHERE instance_id IS NOT NULL;

CREATE TABLE public.whatsapp_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  connection_id uuid REFERENCES public.whatsapp_connections(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'megaapi',
  event_type text,
  external_event_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  processed_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_wa_events_company ON public.whatsapp_events(company_id, created_at DESC);
CREATE UNIQUE INDEX uq_wa_events_external ON public.whatsapp_events(provider, external_event_id) WHERE external_event_id IS NOT NULL;

-- AI
CREATE TABLE public.ai_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  model text,
  status text NOT NULL DEFAULT 'ACTIVE',
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  handoff_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_sessions_conv ON public.ai_sessions(conversation_id);

CREATE TABLE public.ai_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  summary text NOT NULL,
  model text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_summaries_conv ON public.ai_summaries(conversation_id, created_at DESC);

CREATE TABLE public.knowledge_base (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  title text NOT NULL,
  category public.knowledge_category NOT NULL DEFAULT 'outros',
  content text NOT NULL,
  status public.content_status NOT NULL DEFAULT 'DRAFT',
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_kb_company ON public.knowledge_base(company_id, category, status);

-- SETTINGS
CREATE TABLE public.business_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time time NOT NULL DEFAULT '08:00',
  end_time time NOT NULL DEFAULT '18:00',
  is_active boolean NOT NULL DEFAULT true,
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, weekday)
);

CREATE TABLE public.queue_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL UNIQUE REFERENCES public.companies(id) ON DELETE CASCADE,
  distribution_mode public.distribution_mode NOT NULL DEFAULT 'ROUND_ROBIN',
  round_robin_position integer NOT NULL DEFAULT 0,
  sla_seconds integer NOT NULL DEFAULT 60,
  only_online boolean NOT NULL DEFAULT true,
  business_hours_enabled boolean NOT NULL DEFAULT true,
  max_concurrent_per_consultant integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.system_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  key text NOT NULL,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, key)
);

-- LGPD + AUDIT
CREATE TABLE public.privacy_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  consent_type text NOT NULL,
  version text NOT NULL,
  accepted boolean NOT NULL DEFAULT false,
  accepted_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_consents_lead ON public.privacy_consents(lead_id);

CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text,
  entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_company ON public.audit_logs(company_id, created_at DESC);
CREATE INDEX idx_audit_user ON public.audit_logs(user_id, created_at DESC);

-- triggers
CREATE TRIGGER trg_wa_conn_updated BEFORE UPDATE ON public.whatsapp_connections FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_kb_updated BEFORE UPDATE ON public.knowledge_base FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_bh_updated BEFORE UPDATE ON public.business_hours FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_queue_updated BEFORE UPDATE ON public.queue_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_sys_updated BEFORE UPDATE ON public.system_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- GRANTS
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_connections, public.knowledge_base,
  public.business_hours, public.queue_settings, public.system_settings TO authenticated;
GRANT SELECT ON public.whatsapp_events, public.ai_sessions, public.ai_summaries,
  public.privacy_consents, public.audit_logs TO authenticated;
GRANT ALL ON public.whatsapp_connections, public.whatsapp_events, public.ai_sessions,
  public.ai_summaries, public.knowledge_base, public.business_hours, public.queue_settings,
  public.system_settings, public.privacy_consents, public.audit_logs TO service_role;

ALTER TABLE public.whatsapp_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_base ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.queue_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.privacy_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wa_conn_admin" ON public.whatsapp_connections FOR ALL TO authenticated
  USING (company_id = public.current_company_id() AND public.is_company_admin())
  WITH CHECK (company_id = public.current_company_id() AND public.is_company_admin());
CREATE POLICY "wa_events_admin_select" ON public.whatsapp_events FOR SELECT TO authenticated
  USING (company_id = public.current_company_id() AND public.is_company_admin());

CREATE POLICY "ai_sessions_select" ON public.ai_sessions FOR SELECT TO authenticated
  USING (company_id = public.current_company_id() AND EXISTS (
    SELECT 1 FROM public.conversations c WHERE c.id = conversation_id
      AND (public.is_company_admin() OR c.assigned_user_id = auth.uid())));
CREATE POLICY "ai_summaries_select" ON public.ai_summaries FOR SELECT TO authenticated
  USING (company_id = public.current_company_id() AND EXISTS (
    SELECT 1 FROM public.conversations c WHERE c.id = conversation_id
      AND (public.is_company_admin() OR c.assigned_user_id = auth.uid())));

CREATE POLICY "kb_select" ON public.knowledge_base FOR SELECT TO authenticated
  USING (company_id = public.current_company_id());
CREATE POLICY "kb_admin_write" ON public.knowledge_base FOR ALL TO authenticated
  USING (company_id = public.current_company_id() AND public.is_company_admin())
  WITH CHECK (company_id = public.current_company_id() AND public.is_company_admin());

CREATE POLICY "bh_select" ON public.business_hours FOR SELECT TO authenticated
  USING (company_id = public.current_company_id());
CREATE POLICY "bh_admin_write" ON public.business_hours FOR ALL TO authenticated
  USING (company_id = public.current_company_id() AND public.is_company_admin())
  WITH CHECK (company_id = public.current_company_id() AND public.is_company_admin());

CREATE POLICY "queue_select" ON public.queue_settings FOR SELECT TO authenticated
  USING (company_id = public.current_company_id());
CREATE POLICY "queue_admin_write" ON public.queue_settings FOR ALL TO authenticated
  USING (company_id = public.current_company_id() AND public.is_company_admin())
  WITH CHECK (company_id = public.current_company_id() AND public.is_company_admin());

CREATE POLICY "sys_admin_all" ON public.system_settings FOR ALL TO authenticated
  USING (company_id = public.current_company_id() AND public.is_company_admin())
  WITH CHECK (company_id = public.current_company_id() AND public.is_company_admin());

CREATE POLICY "consents_admin_select" ON public.privacy_consents FOR SELECT TO authenticated
  USING (company_id = public.current_company_id() AND public.is_company_admin());
CREATE POLICY "audit_admin_select" ON public.audit_logs FOR SELECT TO authenticated
  USING (company_id = public.current_company_id() AND public.is_company_admin());

-- REALTIME
ALTER TABLE public.conversations REPLICA IDENTITY FULL;
ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.conversation_assignments REPLICA IDENTITY FULL;
ALTER TABLE public.assignment_attempts REPLICA IDENTITY FULL;
ALTER TABLE public.whatsapp_connections REPLICA IDENTITY FULL;
ALTER TABLE public.profiles REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_assignments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.assignment_attempts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_connections;
ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
