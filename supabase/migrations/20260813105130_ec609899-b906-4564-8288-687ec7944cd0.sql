
CREATE TYPE public.lead_status AS ENUM ('NEW','AI_QUALIFYING','QUALIFIED','IN_SERVICE','WON','LOST','ARCHIVED');
CREATE TYPE public.lead_source AS ENUM ('facebook','instagram','whatsapp','site','indicacao','outro');
CREATE TYPE public.conversation_status AS ENUM ('AI_ACTIVE','WAITING_HUMAN','QUEUED','ASSIGNED','HUMAN_ACTIVE','WAITING_CUSTOMER','CLOSED','PAUSED');
CREATE TYPE public.sender_type AS ENUM ('customer','ai','consultant','admin','system');
CREATE TYPE public.message_type AS ENUM ('text','audio','image','document','video','system','other');
CREATE TYPE public.assignment_attempt_status AS ENUM ('WAITING','RESPONDED','TIMEOUT','CANCELLED');
CREATE TYPE public.assignment_status AS ENUM ('ACTIVE','RELEASED','TRANSFERRED','CLOSED');

-- ============ LEADS ============
CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text,
  phone text,
  whatsapp text,
  email text,
  city text,
  state text,
  source public.lead_source NOT NULL DEFAULT 'whatsapp',
  status public.lead_status NOT NULL DEFAULT 'NEW',
  assigned_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  utm_source text, utm_medium text, utm_campaign text, utm_content text,
  campaign_id text, ad_id text,
  first_contact_at timestamptz,
  last_interaction_at timestamptz,
  qualified_at timestamptz,
  closed_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_leads_company ON public.leads(company_id);
CREATE INDEX idx_leads_phone ON public.leads(company_id, phone);
CREATE INDEX idx_leads_whatsapp ON public.leads(company_id, whatsapp);
CREATE INDEX idx_leads_status ON public.leads(company_id, status);
CREATE INDEX idx_leads_assigned ON public.leads(assigned_user_id);
CREATE INDEX idx_leads_created ON public.leads(company_id, created_at DESC);
CREATE UNIQUE INDEX uq_leads_company_whatsapp ON public.leads(company_id, whatsapp) WHERE whatsapp IS NOT NULL;

CREATE TABLE public.lead_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  key text NOT NULL,
  value text,
  source public.sender_type NOT NULL DEFAULT 'ai',
  confidence numeric(3,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lead_id, key)
);
CREATE INDEX idx_lead_memory_lead ON public.lead_memory(lead_id);
CREATE INDEX idx_lead_memory_company ON public.lead_memory(company_id);

CREATE TABLE public.lead_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  author_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_lead_notes_lead ON public.lead_notes(lead_id);

-- ============ CONVERSATIONS ============
CREATE TABLE public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  channel text NOT NULL DEFAULT 'whatsapp',
  channel_id text,
  assigned_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  status public.conversation_status NOT NULL DEFAULT 'AI_ACTIVE',
  summary text,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz,
  closed_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_conv_company ON public.conversations(company_id);
CREATE INDEX idx_conv_lead ON public.conversations(lead_id);
CREATE INDEX idx_conv_assigned ON public.conversations(assigned_user_id);
CREATE INDEX idx_conv_status ON public.conversations(company_id, status);
CREATE INDEX idx_conv_last_message ON public.conversations(company_id, last_message_at DESC);

CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  external_message_id text,
  sender_type public.sender_type NOT NULL,
  sender_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  sender_name text,
  message_type public.message_type NOT NULL DEFAULT 'text',
  content text,
  media_url text,
  mime_type text,
  transcription text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_messages_conversation ON public.messages(conversation_id, created_at DESC);
CREATE INDEX idx_messages_company ON public.messages(company_id, created_at DESC);
CREATE UNIQUE INDEX uq_messages_external ON public.messages(company_id, external_message_id)
  WHERE external_message_id IS NOT NULL;

-- ============ ASSIGNMENTS ============
CREATE TABLE public.conversation_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  consultant_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  status public.assignment_status NOT NULL DEFAULT 'ACTIVE',
  reason text,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_assign_conv ON public.conversation_assignments(conversation_id);
CREATE INDEX idx_assign_consultant ON public.conversation_assignments(consultant_id);
CREATE UNIQUE INDEX uq_assign_active ON public.conversation_assignments(conversation_id)
  WHERE status = 'ACTIVE';

CREATE TABLE public.assignment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  consultant_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  status public.assignment_attempt_status NOT NULL DEFAULT 'WAITING',
  assigned_at timestamptz NOT NULL DEFAULT now(),
  deadline_at timestamptz NOT NULL,
  responded_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_attempt_conv ON public.assignment_attempts(conversation_id);
CREATE INDEX idx_attempt_consultant ON public.assignment_attempts(consultant_id);
CREATE INDEX idx_attempt_waiting ON public.assignment_attempts(deadline_at) WHERE status = 'WAITING';
CREATE UNIQUE INDEX uq_attempt_waiting_conv ON public.assignment_attempts(conversation_id)
  WHERE status = 'WAITING';

CREATE TABLE public.conversation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_conv_events_conv ON public.conversation_events(conversation_id, created_at DESC);

-- triggers
CREATE TRIGGER trg_leads_updated BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_lead_memory_updated BEFORE UPDATE ON public.lead_memory FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_lead_notes_updated BEFORE UPDATE ON public.lead_notes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_conversations_updated BEFORE UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ GRANTS + RLS ============
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_memory TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_notes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;
GRANT SELECT ON public.conversation_assignments TO authenticated;
GRANT SELECT ON public.assignment_attempts TO authenticated;
GRANT SELECT ON public.conversation_events TO authenticated;
GRANT ALL ON public.leads, public.lead_memory, public.lead_notes, public.conversations,
  public.messages, public.conversation_assignments, public.assignment_attempts,
  public.conversation_events TO service_role;

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_events ENABLE ROW LEVEL SECURITY;

-- leads
CREATE POLICY "leads_select" ON public.leads FOR SELECT TO authenticated
  USING (company_id = public.current_company_id()
         AND (public.is_company_admin() OR assigned_user_id = auth.uid()));
CREATE POLICY "leads_admin_write" ON public.leads FOR ALL TO authenticated
  USING (company_id = public.current_company_id() AND public.is_company_admin())
  WITH CHECK (company_id = public.current_company_id() AND public.is_company_admin());
CREATE POLICY "leads_consultant_update" ON public.leads FOR UPDATE TO authenticated
  USING (company_id = public.current_company_id() AND assigned_user_id = auth.uid())
  WITH CHECK (company_id = public.current_company_id() AND assigned_user_id = auth.uid());

-- lead_memory
CREATE POLICY "lead_memory_select" ON public.lead_memory FOR SELECT TO authenticated
  USING (company_id = public.current_company_id() AND EXISTS (
    SELECT 1 FROM public.leads l WHERE l.id = lead_id
      AND (public.is_company_admin() OR l.assigned_user_id = auth.uid())));
CREATE POLICY "lead_memory_admin_write" ON public.lead_memory FOR ALL TO authenticated
  USING (company_id = public.current_company_id() AND public.is_company_admin())
  WITH CHECK (company_id = public.current_company_id() AND public.is_company_admin());

-- lead_notes
CREATE POLICY "lead_notes_select" ON public.lead_notes FOR SELECT TO authenticated
  USING (company_id = public.current_company_id() AND EXISTS (
    SELECT 1 FROM public.leads l WHERE l.id = lead_id
      AND (public.is_company_admin() OR l.assigned_user_id = auth.uid())));
CREATE POLICY "lead_notes_insert" ON public.lead_notes FOR INSERT TO authenticated
  WITH CHECK (company_id = public.current_company_id() AND author_id = auth.uid());
CREATE POLICY "lead_notes_update_own" ON public.lead_notes FOR UPDATE TO authenticated
  USING (company_id = public.current_company_id() AND (author_id = auth.uid() OR public.is_company_admin()))
  WITH CHECK (company_id = public.current_company_id());
CREATE POLICY "lead_notes_delete_own" ON public.lead_notes FOR DELETE TO authenticated
  USING (company_id = public.current_company_id() AND (author_id = auth.uid() OR public.is_company_admin()));

-- conversations
CREATE POLICY "conversations_select" ON public.conversations FOR SELECT TO authenticated
  USING (company_id = public.current_company_id()
         AND (public.is_company_admin() OR assigned_user_id = auth.uid()));
CREATE POLICY "conversations_admin_write" ON public.conversations FOR ALL TO authenticated
  USING (company_id = public.current_company_id() AND public.is_company_admin())
  WITH CHECK (company_id = public.current_company_id() AND public.is_company_admin());
CREATE POLICY "conversations_consultant_update" ON public.conversations FOR UPDATE TO authenticated
  USING (company_id = public.current_company_id() AND assigned_user_id = auth.uid())
  WITH CHECK (company_id = public.current_company_id() AND assigned_user_id = auth.uid());

-- messages
CREATE POLICY "messages_select" ON public.messages FOR SELECT TO authenticated
  USING (company_id = public.current_company_id() AND EXISTS (
    SELECT 1 FROM public.conversations c WHERE c.id = conversation_id
      AND (public.is_company_admin() OR c.assigned_user_id = auth.uid())));
CREATE POLICY "messages_insert" ON public.messages FOR INSERT TO authenticated
  WITH CHECK (company_id = public.current_company_id()
    AND sender_id = auth.uid()
    AND sender_type IN ('consultant','admin')
    AND EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_id
      AND (public.is_company_admin() OR c.assigned_user_id = auth.uid())));

-- assignments / attempts / events: read-only for app, written by backend
CREATE POLICY "assignments_select" ON public.conversation_assignments FOR SELECT TO authenticated
  USING (company_id = public.current_company_id()
         AND (public.is_company_admin() OR consultant_id = auth.uid()));
CREATE POLICY "attempts_select" ON public.assignment_attempts FOR SELECT TO authenticated
  USING (company_id = public.current_company_id()
         AND (public.is_company_admin() OR consultant_id = auth.uid()));
CREATE POLICY "conv_events_select" ON public.conversation_events FOR SELECT TO authenticated
  USING (company_id = public.current_company_id() AND EXISTS (
    SELECT 1 FROM public.conversations c WHERE c.id = conversation_id
      AND (public.is_company_admin() OR c.assigned_user_id = auth.uid())));
