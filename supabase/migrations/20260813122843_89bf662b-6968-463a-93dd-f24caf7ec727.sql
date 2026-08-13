-- 1) Novos estados de lead (não usados nesta mesma migração)
ALTER TYPE public.lead_status ADD VALUE IF NOT EXISTS 'WAITING_HUMAN';
ALTER TYPE public.lead_status ADD VALUE IF NOT EXISTS 'WAITING_CUSTOMER';

-- 2) Normalização centralizada de telefone
CREATE OR REPLACE FUNCTION public.normalize_phone(_raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE d text;
BEGIN
  IF _raw IS NULL THEN RETURN NULL; END IF;
  d := regexp_replace(_raw, '[^0-9]', '', 'g');
  IF d = '' THEN RETURN NULL; END IF;
  d := regexp_replace(d, '^0+', '');
  -- Brasil: 10/11 dígitos (DDD + número) recebem o código do país
  IF length(d) IN (10, 11) THEN d := '55' || d; END IF;
  RETURN d;
END; $$;

-- 3) Coluna de não lidas + índices
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS unread_count integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_leads_last_interaction
  ON public.leads(company_id, last_interaction_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_leads_email ON public.leads(company_id, email);

-- 4) Visibilidade por empresa (consultor vê a própria empresa)
DROP POLICY IF EXISTS "leads_select" ON public.leads;
CREATE POLICY "leads_select" ON public.leads FOR SELECT TO authenticated
  USING (company_id = public.current_company_id());

DROP POLICY IF EXISTS "conversations_select" ON public.conversations;
CREATE POLICY "conversations_select" ON public.conversations FOR SELECT TO authenticated
  USING (company_id = public.current_company_id());

DROP POLICY IF EXISTS "messages_select" ON public.messages;
CREATE POLICY "messages_select" ON public.messages FOR SELECT TO authenticated
  USING (company_id = public.current_company_id());

DROP POLICY IF EXISTS "lead_memory_select" ON public.lead_memory;
CREATE POLICY "lead_memory_select" ON public.lead_memory FOR SELECT TO authenticated
  USING (company_id = public.current_company_id());

DROP POLICY IF EXISTS "conv_events_select" ON public.conversation_events;
CREATE POLICY "conv_events_select" ON public.conversation_events FOR SELECT TO authenticated
  USING (company_id = public.current_company_id());

DROP POLICY IF EXISTS "ai_summaries_select" ON public.ai_summaries;
CREATE POLICY "ai_summaries_select" ON public.ai_summaries FOR SELECT TO authenticated
  USING (company_id = public.current_company_id());

-- 5) Trigger: mensagem mantém conversa e lead atualizados
CREATE OR REPLACE FUNCTION public.on_message_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _lead uuid;
BEGIN
  UPDATE public.conversations
     SET last_message_at = NEW.created_at,
         unread_count = CASE WHEN NEW.sender_type = 'customer' THEN unread_count + 1 ELSE unread_count END,
         updated_at = now()
   WHERE id = NEW.conversation_id
   RETURNING lead_id INTO _lead;

  IF _lead IS NOT NULL THEN
    UPDATE public.leads
       SET last_interaction_at = NEW.created_at,
           first_contact_at = COALESCE(first_contact_at, NEW.created_at)
     WHERE id = _lead;
  END IF;

  INSERT INTO public.conversation_events (company_id, conversation_id, event_type, actor_id, metadata)
  VALUES (NEW.company_id, NEW.conversation_id,
          CASE WHEN NEW.sender_type = 'customer' THEN 'MESSAGE_RECEIVED' ELSE 'MESSAGE_SENT' END,
          NEW.sender_id, jsonb_build_object('message_id', NEW.id, 'sender_type', NEW.sender_type));
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_message_insert ON public.messages;
CREATE TRIGGER trg_message_insert AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.on_message_insert();

-- 6) Guarda de acesso por empresa
CREATE OR REPLACE FUNCTION public.assert_company_member(_company_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _company_id IS NULL OR _company_id <> public.current_company_id() THEN
    RAISE EXCEPTION 'acesso negado';
  END IF;
END; $$;

-- 7) Criar/reaproveitar lead pelo telefone normalizado
CREATE OR REPLACE FUNCTION public.upsert_lead(
  _name text DEFAULT NULL,
  _phone text DEFAULT NULL,
  _email text DEFAULT NULL,
  _city text DEFAULT NULL,
  _state text DEFAULT NULL,
  _source lead_source DEFAULT 'outro',
  _assigned_user_id uuid DEFAULT NULL,
  _metadata jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _company uuid := public.current_company_id();
  _norm text := public.normalize_phone(_phone);
  _lead uuid;
BEGIN
  PERFORM public.assert_company_member(_company);
  IF _norm IS NULL AND coalesce(btrim(_name),'') = '' THEN
    RAISE EXCEPTION 'informe nome ou telefone';
  END IF;

  IF _norm IS NOT NULL THEN
    SELECT id INTO _lead FROM public.leads
     WHERE company_id = _company AND whatsapp = _norm LIMIT 1;
  END IF;

  IF _lead IS NOT NULL THEN
    UPDATE public.leads SET
      name = COALESCE(NULLIF(btrim(_name),''), name),
      email = COALESCE(NULLIF(btrim(_email),''), email),
      city = COALESCE(NULLIF(btrim(_city),''), city),
      state = COALESCE(NULLIF(btrim(_state),''), state),
      assigned_user_id = COALESCE(_assigned_user_id, assigned_user_id),
      metadata = metadata || _metadata,
      last_interaction_at = now()
    WHERE id = _lead;
    RETURN _lead;
  END IF;

  INSERT INTO public.leads (company_id, name, phone, whatsapp, email, city, state, source,
                            assigned_user_id, metadata, first_contact_at, last_interaction_at)
  VALUES (_company, NULLIF(btrim(_name),''), _norm, _norm, NULLIF(btrim(_email),''),
          NULLIF(btrim(_city),''), NULLIF(btrim(_state),''), _source, _assigned_user_id,
          _metadata, now(), now())
  RETURNING id INTO _lead;

  INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id)
  VALUES (_company, auth.uid(), 'CREATE_LEAD', 'lead', _lead);

  RETURN _lead;
END; $$;

-- 8) Abrir (ou reaproveitar) conversa do lead
CREATE OR REPLACE FUNCTION public.get_or_create_conversation(
  _lead_id uuid,
  _channel text DEFAULT 'whatsapp'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _company uuid := public.current_company_id();
  _conv uuid;
  _wa text;
BEGIN
  PERFORM public.assert_company_member(_company);
  PERFORM 1 FROM public.leads WHERE id = _lead_id AND company_id = _company;
  IF NOT FOUND THEN RAISE EXCEPTION 'lead inexistente'; END IF;

  SELECT id INTO _conv FROM public.conversations
   WHERE lead_id = _lead_id AND company_id = _company AND status <> 'CLOSED'
   ORDER BY started_at DESC LIMIT 1;
  IF _conv IS NOT NULL THEN RETURN _conv; END IF;

  SELECT whatsapp INTO _wa FROM public.leads WHERE id = _lead_id;

  INSERT INTO public.conversations (company_id, lead_id, channel, channel_id, status, started_at)
  VALUES (_company, _lead_id, _channel, _wa, 'AI_ACTIVE', now())
  RETURNING id INTO _conv;

  INSERT INTO public.conversation_events (company_id, conversation_id, event_type, actor_id)
  VALUES (_company, _conv, 'CONVERSATION_OPENED', auth.uid());

  RETURN _conv;
END; $$;

-- 9) Enviar/registrar mensagem sem duplicação
CREATE OR REPLACE FUNCTION public.post_message(
  _conversation_id uuid,
  _sender_type sender_type,
  _content text DEFAULT NULL,
  _message_type message_type DEFAULT 'text',
  _external_message_id text DEFAULT NULL,
  _sender_name text DEFAULT NULL,
  _media_url text DEFAULT NULL,
  _mime_type text DEFAULT NULL,
  _metadata jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _company uuid := public.current_company_id();
  _msg uuid;
  _sender uuid;
  _name text := _sender_name;
BEGIN
  PERFORM public.assert_company_member(_company);
  PERFORM 1 FROM public.conversations WHERE id = _conversation_id AND company_id = _company;
  IF NOT FOUND THEN RAISE EXCEPTION 'conversa inexistente'; END IF;

  IF _external_message_id IS NOT NULL THEN
    SELECT id INTO _msg FROM public.messages
     WHERE company_id = _company AND external_message_id = _external_message_id;
    IF _msg IS NOT NULL THEN RETURN _msg; END IF;
  END IF;

  IF _sender_type IN ('consultant','admin') THEN
    _sender := auth.uid();
    IF _name IS NULL THEN
      SELECT COALESCE(full_name, email) INTO _name FROM public.profiles WHERE id = _sender;
    END IF;
  END IF;

  INSERT INTO public.messages (company_id, conversation_id, external_message_id, sender_type,
                               sender_id, sender_name, message_type, content, media_url,
                               mime_type, metadata)
  VALUES (_company, _conversation_id, _external_message_id, _sender_type, _sender, _name,
          _message_type, _content, _media_url, _mime_type, _metadata)
  RETURNING id INTO _msg;

  IF _sender_type IN ('consultant','admin') THEN
    UPDATE public.conversations
       SET status = CASE WHEN status IN ('CLOSED','PAUSED') THEN status ELSE 'WAITING_CUSTOMER'::conversation_status END,
           unread_count = 0
     WHERE id = _conversation_id;
  END IF;

  RETURN _msg;
END; $$;

-- 10) Atribuição, situação, leitura, memória e resumo
CREATE OR REPLACE FUNCTION public.assign_conversation(_conversation_id uuid, _consultant_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _company uuid := public.current_company_id(); _prev uuid;
BEGIN
  PERFORM public.assert_company_member(_company);
  IF _consultant_id IS NOT NULL THEN
    PERFORM 1 FROM public.profiles WHERE id = _consultant_id AND company_id = _company;
    IF NOT FOUND THEN RAISE EXCEPTION 'consultor inválido'; END IF;
  END IF;

  SELECT assigned_user_id INTO _prev FROM public.conversations
   WHERE id = _conversation_id AND company_id = _company;
  IF NOT FOUND THEN RAISE EXCEPTION 'conversa inexistente'; END IF;

  UPDATE public.conversations
     SET assigned_user_id = _consultant_id,
         status = CASE WHEN _consultant_id IS NULL THEN 'QUEUED'::conversation_status
                       WHEN status IN ('AI_ACTIVE','WAITING_HUMAN','QUEUED') THEN 'ASSIGNED'::conversation_status
                       ELSE status END
   WHERE id = _conversation_id;

  UPDATE public.conversation_assignments SET status = 'RELEASED', ended_at = now()
   WHERE conversation_id = _conversation_id AND status = 'ACTIVE';

  IF _consultant_id IS NOT NULL THEN
    INSERT INTO public.conversation_assignments (company_id, conversation_id, consultant_id, assigned_by, status)
    VALUES (_company, _conversation_id, _consultant_id, auth.uid(), 'ACTIVE');
  END IF;

  INSERT INTO public.conversation_events (company_id, conversation_id, event_type, actor_id, metadata)
  VALUES (_company, _conversation_id, CASE WHEN _prev IS NULL THEN 'ASSIGNED' ELSE 'TRANSFERRED' END,
          auth.uid(), jsonb_build_object('from', _prev, 'to', _consultant_id));

  INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (_company, auth.uid(), 'ASSIGN_CONVERSATION', 'conversation', _conversation_id,
          jsonb_build_object('to', _consultant_id));
END; $$;

CREATE OR REPLACE FUNCTION public.set_conversation_status(_conversation_id uuid, _status conversation_status)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _company uuid := public.current_company_id();
BEGIN
  PERFORM public.assert_company_member(_company);
  UPDATE public.conversations
     SET status = _status,
         closed_at = CASE WHEN _status = 'CLOSED' THEN now() ELSE NULL END
   WHERE id = _conversation_id AND company_id = _company;
  IF NOT FOUND THEN RAISE EXCEPTION 'conversa inexistente'; END IF;

  INSERT INTO public.conversation_events (company_id, conversation_id, event_type, actor_id, metadata)
  VALUES (_company, _conversation_id,
          CASE WHEN _status = 'CLOSED' THEN 'CONVERSATION_CLOSED' ELSE 'STATUS_CHANGED' END,
          auth.uid(), jsonb_build_object('status', _status));
END; $$;

CREATE OR REPLACE FUNCTION public.mark_conversation_read(_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _company uuid := public.current_company_id();
BEGIN
  PERFORM public.assert_company_member(_company);
  UPDATE public.conversations SET unread_count = 0
   WHERE id = _conversation_id AND company_id = _company AND unread_count > 0;
END; $$;

CREATE OR REPLACE FUNCTION public.upsert_lead_memory(
  _lead_id uuid, _key text, _value text,
  _source sender_type DEFAULT 'consultant', _confidence numeric DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _company uuid := public.current_company_id();
BEGIN
  PERFORM public.assert_company_member(_company);
  PERFORM 1 FROM public.leads WHERE id = _lead_id AND company_id = _company;
  IF NOT FOUND THEN RAISE EXCEPTION 'lead inexistente'; END IF;

  INSERT INTO public.lead_memory (company_id, lead_id, key, value, source, confidence)
  VALUES (_company, _lead_id, btrim(_key), _value, _source, _confidence)
  ON CONFLICT (lead_id, key) DO UPDATE
    SET value = EXCLUDED.value, source = EXCLUDED.source,
        confidence = EXCLUDED.confidence, updated_at = now();
END; $$;

CREATE OR REPLACE FUNCTION public.set_conversation_summary(_conversation_id uuid, _summary text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _company uuid := public.current_company_id(); _lead uuid;
BEGIN
  PERFORM public.assert_company_member(_company);
  UPDATE public.conversations SET summary = _summary
   WHERE id = _conversation_id AND company_id = _company
   RETURNING lead_id INTO _lead;
  IF NOT FOUND THEN RAISE EXCEPTION 'conversa inexistente'; END IF;

  INSERT INTO public.ai_summaries (company_id, conversation_id, lead_id, summary, model)
  VALUES (_company, _conversation_id, _lead, _summary, 'manual');
END; $$;

CREATE OR REPLACE FUNCTION public.set_lead_status(_lead_id uuid, _status lead_status)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _company uuid := public.current_company_id();
BEGIN
  PERFORM public.assert_company_member(_company);
  UPDATE public.leads
     SET status = _status,
         qualified_at = CASE WHEN _status = 'QUALIFIED' THEN COALESCE(qualified_at, now()) ELSE qualified_at END,
         closed_at = CASE WHEN _status IN ('WON','LOST','ARCHIVED') THEN now() ELSE NULL END
   WHERE id = _lead_id AND company_id = _company;
  IF NOT FOUND THEN RAISE EXCEPTION 'lead inexistente'; END IF;

  INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (_company, auth.uid(), 'UPDATE_LEAD', 'lead', _lead_id, jsonb_build_object('status', _status));
END; $$;

CREATE OR REPLACE FUNCTION public.assign_lead(_lead_id uuid, _consultant_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _company uuid := public.current_company_id();
BEGIN
  PERFORM public.assert_company_member(_company);
  IF _consultant_id IS NOT NULL THEN
    PERFORM 1 FROM public.profiles WHERE id = _consultant_id AND company_id = _company;
    IF NOT FOUND THEN RAISE EXCEPTION 'consultor inválido'; END IF;
  END IF;
  UPDATE public.leads SET assigned_user_id = _consultant_id
   WHERE id = _lead_id AND company_id = _company;
  IF NOT FOUND THEN RAISE EXCEPTION 'lead inexistente'; END IF;
END; $$;

REVOKE ALL ON FUNCTION public.assert_company_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.normalize_phone(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_lead(text,text,text,text,text,lead_source,uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_conversation(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_message(uuid,sender_type,text,message_type,text,text,text,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_conversation(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_conversation_status(uuid,conversation_status) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_lead_memory(uuid,text,text,sender_type,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_conversation_summary(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_lead_status(uuid,lead_status) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_lead(uuid,uuid) TO authenticated;