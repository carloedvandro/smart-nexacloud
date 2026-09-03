-- ============================================================
-- Unificação de leads por identidade (LID + telefone)
-- Evita que o mesmo contato gere dois leads quando ora chega
-- por LID (@lid) ora por telefone normalizado.
-- ============================================================

-- 1) Tabela de identidades de lead
CREATE TABLE public.lead_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  identifier text NOT NULL,
  identifier_type text NOT NULL CHECK (identifier_type IN ('lid','phone')),
  source text NOT NULL DEFAULT 'whatsapp',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_lead_identities_company_identifier
  ON public.lead_identities(company_id, identifier);
CREATE INDEX idx_lead_identities_lead ON public.lead_identities(lead_id);

GRANT SELECT ON public.lead_identities TO authenticated;
GRANT ALL ON public.lead_identities TO service_role;

ALTER TABLE public.lead_identities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lead_identities_select" ON public.lead_identities;
CREATE POLICY "lead_identities_select" ON public.lead_identities FOR SELECT TO authenticated
  USING (company_id = public.current_company_id() AND public.can_view_lead(lead_id));

DROP POLICY IF EXISTS "platform admin full access" ON public.lead_identities;
CREATE POLICY "platform admin full access" ON public.lead_identities FOR ALL TO authenticated
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

-- 2) Popular lead_identities a partir dos leads existentes
INSERT INTO public.lead_identities (company_id, lead_id, identifier, identifier_type, source)
SELECT company_id, id, whatsapp,
       CASE WHEN whatsapp LIKE '%@lid' THEN 'lid' ELSE 'phone' END,
       'whatsapp'
  FROM public.leads
 WHERE whatsapp IS NOT NULL
 ON CONFLICT (company_id, identifier) DO NOTHING;

-- 3) Resolver lead por qualquer identificador (LID ou telefone)
CREATE OR REPLACE FUNCTION public.resolve_lead_identity(_company_id uuid, _identifier text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _lead uuid;
BEGIN
  IF _identifier IS NULL OR btrim(_identifier) = '' THEN RETURN NULL; END IF;

  SELECT lead_id INTO _lead FROM public.lead_identities
   WHERE company_id = _company_id AND identifier = _identifier LIMIT 1;
  IF _lead IS NOT NULL THEN RETURN _lead; END IF;

  -- Fallback: busca direta em leads.whatsapp (compatibilidade)
  SELECT id INTO _lead FROM public.leads
   WHERE company_id = _company_id AND whatsapp = _identifier LIMIT 1;
  RETURN _lead;
END; $$;

REVOKE ALL ON FUNCTION public.resolve_lead_identity(uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.resolve_lead_identity(uuid, text) TO authenticated, service_role;

-- 4) Vincular identificador a lead existente (idempotente)
CREATE OR REPLACE FUNCTION public.link_lead_identity(
  _lead_id uuid, _identifier text, _identifier_type text, _source text DEFAULT 'whatsapp'
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _company uuid;
BEGIN
  IF _identifier IS NULL OR btrim(_identifier) = '' THEN RETURN; END IF;
  SELECT company_id INTO _company FROM public.leads WHERE id = _lead_id;
  IF _company IS NULL THEN RAISE EXCEPTION 'lead inexistente'; END IF;

  INSERT INTO public.lead_identities (company_id, lead_id, identifier, identifier_type, source)
  VALUES (_company, _lead_id, _identifier, _identifier_type, _source)
  ON CONFLICT (company_id, identifier) DO NOTHING;
END; $$;

REVOKE ALL ON FUNCTION public.link_lead_identity(uuid, text, text, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.link_lead_identity(uuid, text, text, text) TO authenticated, service_role;

-- 5) Fundir dois leads duplicados, mantendo _keep_id
CREATE OR REPLACE FUNCTION public.merge_leads(_keep_id uuid, _drop_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _company uuid;
  _keep record;
  _drop record;
  _drop_whatsapp text;
  _drop_phone text;
BEGIN
  IF _keep_id = _drop_id THEN RETURN _keep_id; END IF;

  SELECT * INTO _keep FROM public.leads WHERE id = _keep_id;
  SELECT * INTO _drop FROM public.leads WHERE id = _drop_id;
  IF _keep.id IS NULL OR _drop.id IS NULL THEN
    RAISE EXCEPTION 'lead inexistente para merge';
  END IF;
  IF _keep.company_id <> _drop.company_id THEN
    RAISE EXCEPTION 'leads de empresas distintas não podem ser fundidos';
  END IF;
  _company := _keep.company_id;

  -- Permissão: admin da empresa ou platform admin
  IF auth.uid() IS NOT NULL THEN
    PERFORM public.assert_company_member(_company);
  END IF;

  -- Repointar conversas (mensagens vêm por cascade da conversa)
  UPDATE public.conversations SET lead_id = _keep_id WHERE lead_id = _drop_id;

  -- Repointar tabelas com FK direta para leads
  UPDATE public.lead_memory SET lead_id = _keep_id WHERE lead_id = _drop_id;
  UPDATE public.lead_notes SET lead_id = _keep_id WHERE lead_id = _drop_id;
  UPDATE public.ai_sessions SET lead_id = _keep_id WHERE lead_id = _drop_id;
  UPDATE public.ai_summaries SET lead_id = _keep_id WHERE lead_id = _drop_id;
  UPDATE public.privacy_consents SET lead_id = _keep_id WHERE lead_id = _drop_id;
  UPDATE public.service_ratings SET lead_id = _keep_id WHERE lead_id = _drop_id;

  -- Repointar auditoria (entity_type = 'lead')
  UPDATE public.audit_logs
     SET entity_id = _keep_id
   WHERE entity_type = 'lead' AND entity_id = _drop_id;

  -- Fundir campos do lead
  _drop_whatsapp := _drop.whatsapp;
  _drop_phone := _drop.phone;

  UPDATE public.leads SET
    name = COALESCE(NULLIF(btrim(_keep.name), ''), _drop.name),
    email = COALESCE(NULLIF(btrim(_keep.email), ''), _drop.email),
    city = COALESCE(NULLIF(btrim(_keep.city), ''), _drop.city),
    state = COALESCE(NULLIF(btrim(_keep.state), ''), _drop.state),
    phone = COALESCE(_keep.phone, _drop.phone),
    assigned_user_id = COALESCE(_keep.assigned_user_id, _drop.assigned_user_id),
    first_contact_at = LEAST(_keep.first_contact_at, _drop.first_contact_at),
    last_interaction_at = GREATEST(_keep.last_interaction_at, _drop.last_interaction_at),
    qualified_at = COALESCE(_keep.qualified_at, _drop.qualified_at),
    closed_at = COALESCE(_keep.closed_at, _drop.closed_at),
    metadata = _keep.metadata || _drop.metadata,
    updated_at = now()
  WHERE id = _keep_id;

  -- Se o keep era LID-only e o drop tinha telefone real, promover o telefone
  IF _keep.whatsapp LIKE '%@lid' AND _drop_whatsapp IS NOT NULL
     AND _drop_whatsapp NOT LIKE '%@lid' THEN
    -- Remover drop do índice único antes de copiar o telefone para o keep
    UPDATE public.leads SET whatsapp = NULL WHERE id = _drop_id;
    UPDATE public.leads
       SET whatsapp = _drop_whatsapp,
           phone = COALESCE(phone, _drop_phone)
     WHERE id = _keep_id;
  END IF;

  -- Repointar identidades do drop para o keep (idempotente)
  UPDATE public.lead_identities SET lead_id = _keep_id WHERE lead_id = _drop_id;

  -- Excluir o lead fundido (nada mais referencia via FK — tudo foi repontado)
  DELETE FROM public.leads WHERE id = _drop_id;

  -- Auditoria
  INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (_company, auth.uid(), 'MERGE_LEAD', 'lead', _keep_id,
          jsonb_build_object('dropped', _drop_id, 'kept', _keep_id));

  RETURN _keep_id;
END; $$;

REVOKE ALL ON FUNCTION public.merge_leads(uuid, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.merge_leads(uuid, uuid) TO authenticated, service_role;

-- 6) Reescrever ingest_inbound_message com _real_phone + identidades
CREATE OR REPLACE FUNCTION public.ingest_inbound_message(
  _connection_id uuid,
  _remote_jid text,
  _external_message_id text,
  _push_name text DEFAULT NULL,
  _message_type public.message_type DEFAULT 'text',
  _content text DEFAULT NULL,
  _media_url text DEFAULT NULL,
  _mime_type text DEFAULT NULL,
  _metadata jsonb DEFAULT '{}'::jsonb,
  _real_phone text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _company uuid;
  _identifier text;
  _is_lid boolean := _remote_jid LIKE '%@lid';
  _phone text;
  _real_phone_norm text;
  _lead uuid;
  _lead_by_lid uuid;
  _lead_by_phone uuid;
  _conv uuid;
  _msg uuid;
  _existing uuid;
BEGIN
  SELECT company_id INTO _company FROM public.whatsapp_connections WHERE id = _connection_id;
  IF _company IS NULL THEN RAISE EXCEPTION 'conexão inexistente'; END IF;

  IF _is_lid THEN
    _identifier := _remote_jid;
  ELSE
    _phone := public.normalize_phone(replace(_remote_jid, '@s.whatsapp.net', ''));
    _identifier := _phone;
  END IF;
  IF _identifier IS NULL OR _identifier = '' THEN RAISE EXCEPTION 'remetente inválido'; END IF;

  -- Normalizar telefone real quando informado (vindo de senderPn/participantPn)
  _real_phone_norm := public.normalize_phone(_real_phone);

  IF _external_message_id IS NOT NULL THEN
    SELECT id INTO _existing FROM public.messages
     WHERE company_id = _company AND external_message_id = _external_message_id;
    IF _existing IS NOT NULL THEN
      RETURN jsonb_build_object('duplicate', true, 'message_id', _existing);
    END IF;
  END IF;

  -- Resolver lead por identidade (LID e/ou telefone)
  _lead_by_lid := NULL;
  _lead_by_phone := NULL;

  IF _is_lid THEN
    _lead_by_lid := public.resolve_lead_identity(_company, _identifier);
    IF _real_phone_norm IS NOT NULL THEN
      _lead_by_phone := public.resolve_lead_identity(_company, _real_phone_norm);
    END IF;
  ELSE
    _lead_by_phone := public.resolve_lead_identity(_company, _identifier);
  END IF;

  -- Decidir qual lead usar
  IF _lead_by_lid IS NOT NULL AND _lead_by_phone IS NOT NULL
     AND _lead_by_lid <> _lead_by_phone THEN
    -- Dois leads distintos para o mesmo contato: fundir
    -- Preferir o com first_contact_at mais antigo (mais histórico)
    SELECT id INTO _lead FROM public.leads
     WHERE id IN (_lead_by_lid, _lead_by_phone)
     ORDER BY first_contact_at ASC NULLS LAST, created_at ASC LIMIT 1;
    IF _lead = _lead_by_lid THEN
      PERFORM public.merge_leads(_lead_by_lid, _lead_by_phone);
    ELSE
      PERFORM public.merge_leads(_lead_by_phone, _lead_by_lid);
    END IF;
  ELSE
    _lead := COALESCE(_lead_by_lid, _lead_by_phone);
  END IF;

  IF _lead IS NULL THEN
    -- Criar novo lead
    INSERT INTO public.leads (company_id, name, phone, whatsapp, source, status,
                              first_contact_at, last_interaction_at, metadata)
    VALUES (_company, NULLIF(btrim(coalesce(_push_name,'')),''),
            CASE WHEN _is_lid THEN _real_phone_norm ELSE _identifier END,
            _identifier,
            'whatsapp', 'NEW', now(), now(),
            jsonb_build_object('remote_jid', _remote_jid, 'is_lid', _is_lid))
    RETURNING id INTO _lead;

    -- Registrar identidade principal
    PERFORM public.link_lead_identity(
      _lead, _identifier,
      CASE WHEN _is_lid THEN 'lid' ELSE 'phone' END, 'whatsapp');

    -- Se temos LID + telefone real, registrar também o telefone
    IF _is_lid AND _real_phone_norm IS NOT NULL THEN
      PERFORM public.link_lead_identity(_lead, _real_phone_norm, 'phone', 'whatsapp');
    END IF;
  ELSE
    -- Lead existente: atualizar e vincular identidades faltantes
    UPDATE public.leads
       SET name = COALESCE(name, NULLIF(btrim(coalesce(_push_name,'')),'')),
           phone = COALESCE(phone, _real_phone_norm, CASE WHEN NOT _is_lid THEN _identifier ELSE NULL END),
           last_interaction_at = now(),
           first_contact_at = COALESCE(first_contact_at, now())
     WHERE id = _lead;

    PERFORM public.link_lead_identity(
      _lead, _identifier,
      CASE WHEN _is_lid THEN 'lid' ELSE 'phone' END, 'whatsapp');

    IF _is_lid AND _real_phone_norm IS NOT NULL THEN
      PERFORM public.link_lead_identity(_lead, _real_phone_norm, 'phone', 'whatsapp');
    END IF;
  END IF;

  SELECT id INTO _conv FROM public.conversations
   WHERE company_id = _company AND lead_id = _lead AND status <> 'CLOSED'
   ORDER BY started_at DESC LIMIT 1;

  IF _conv IS NULL THEN
    INSERT INTO public.conversations (company_id, lead_id, channel, channel_id, status, started_at, metadata)
    VALUES (_company, _lead, 'whatsapp', _identifier, 'WAITING_HUMAN', now(),
            jsonb_build_object('connection_id', _connection_id, 'remote_jid', _remote_jid))
    RETURNING id INTO _conv;

    INSERT INTO public.conversation_events (company_id, conversation_id, event_type, metadata)
    VALUES (_company, _conv, 'CONVERSATION_OPENED', jsonb_build_object('source', 'whatsapp'));
  END IF;

  INSERT INTO public.messages (company_id, conversation_id, connection_id, external_message_id,
                               sender_type, sender_name, message_type, content, media_url,
                               mime_type, metadata, delivery_status, transcription_status)
  VALUES (_company, _conv, _connection_id, _external_message_id, 'customer',
          NULLIF(btrim(coalesce(_push_name,'')),''), _message_type, _content, _media_url,
          _mime_type, _metadata, 'DELIVERED',
          CASE WHEN _message_type = 'audio' THEN 'PENDING'::public.transcription_status
               ELSE 'NONE'::public.transcription_status END)
  RETURNING id INTO _msg;

  UPDATE public.whatsapp_connections SET last_event_at = now() WHERE id = _connection_id;

  RETURN jsonb_build_object('duplicate', false, 'message_id', _msg,
                            'conversation_id', _conv, 'lead_id', _lead, 'company_id', _company);
END; $$;
REVOKE ALL ON FUNCTION public.ingest_inbound_message(uuid,text,text,text,public.message_type,text,text,text,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_inbound_message(uuid,text,text,text,public.message_type,text,text,text,jsonb,text) TO service_role;

-- 7) Reescrever ingest_outbound_echo com _real_phone + identidades
CREATE OR REPLACE FUNCTION public.ingest_outbound_echo(
  _connection_id uuid,
  _remote_jid text,
  _external_message_id text,
  _message_type public.message_type DEFAULT 'text',
  _content text DEFAULT NULL,
  _media_url text DEFAULT NULL,
  _mime_type text DEFAULT NULL,
  _metadata jsonb DEFAULT '{}'::jsonb,
  _real_phone text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _company uuid;
  _identifier text;
  _is_lid boolean := _remote_jid LIKE '%@lid';
  _phone text;
  _real_phone_norm text;
  _lead uuid;
  _lead_by_lid uuid;
  _lead_by_phone uuid;
  _conv uuid;
  _msg uuid;
  _existing uuid;
BEGIN
  SELECT company_id INTO _company FROM public.whatsapp_connections WHERE id = _connection_id;
  IF _company IS NULL THEN RAISE EXCEPTION 'conexão inexistente'; END IF;

  IF _is_lid THEN
    _identifier := _remote_jid;
  ELSE
    _phone := public.normalize_phone(replace(_remote_jid, '@s.whatsapp.net', ''));
    _identifier := _phone;
  END IF;
  IF _identifier IS NULL OR _identifier = '' THEN RAISE EXCEPTION 'destinatário inválido'; END IF;

  _real_phone_norm := public.normalize_phone(_real_phone);

  IF _external_message_id IS NOT NULL THEN
    SELECT id INTO _existing FROM public.messages
     WHERE company_id = _company AND external_message_id = _external_message_id;
    IF _existing IS NOT NULL THEN
      RETURN jsonb_build_object('duplicate', true, 'message_id', _existing);
    END IF;
  END IF;

  _lead_by_lid := NULL;
  _lead_by_phone := NULL;

  IF _is_lid THEN
    _lead_by_lid := public.resolve_lead_identity(_company, _identifier);
    IF _real_phone_norm IS NOT NULL THEN
      _lead_by_phone := public.resolve_lead_identity(_company, _real_phone_norm);
    END IF;
  ELSE
    _lead_by_phone := public.resolve_lead_identity(_company, _identifier);
  END IF;

  IF _lead_by_lid IS NOT NULL AND _lead_by_phone IS NOT NULL
     AND _lead_by_lid <> _lead_by_phone THEN
    SELECT id INTO _lead FROM public.leads
     WHERE id IN (_lead_by_lid, _lead_by_phone)
     ORDER BY first_contact_at ASC NULLS LAST, created_at ASC LIMIT 1;
    IF _lead = _lead_by_lid THEN
      PERFORM public.merge_leads(_lead_by_lid, _lead_by_phone);
    ELSE
      PERFORM public.merge_leads(_lead_by_phone, _lead_by_lid);
    END IF;
  ELSE
    _lead := COALESCE(_lead_by_lid, _lead_by_phone);
  END IF;

  IF _lead IS NULL THEN
    INSERT INTO public.leads (company_id, phone, whatsapp, source, status,
                              first_contact_at, last_interaction_at, metadata)
    VALUES (_company,
            CASE WHEN _is_lid THEN _real_phone_norm ELSE _identifier END,
            _identifier,
            'whatsapp', 'NEW', now(), now(),
            jsonb_build_object('remote_jid', _remote_jid, 'is_lid', _is_lid, 'origin', 'outbound'))
    RETURNING id INTO _lead;

    PERFORM public.link_lead_identity(
      _lead, _identifier,
      CASE WHEN _is_lid THEN 'lid' ELSE 'phone' END, 'whatsapp');

    IF _is_lid AND _real_phone_norm IS NOT NULL THEN
      PERFORM public.link_lead_identity(_lead, _real_phone_norm, 'phone', 'whatsapp');
    END IF;
  ELSE
    PERFORM public.link_lead_identity(
      _lead, _identifier,
      CASE WHEN _is_lid THEN 'lid' ELSE 'phone' END, 'whatsapp');

    IF _is_lid AND _real_phone_norm IS NOT NULL THEN
      PERFORM public.link_lead_identity(_lead, _real_phone_norm, 'phone', 'whatsapp');
    END IF;
  END IF;

  SELECT id INTO _conv FROM public.conversations
   WHERE company_id = _company AND lead_id = _lead AND status <> 'CLOSED'
   ORDER BY started_at DESC LIMIT 1;

  IF _conv IS NULL THEN
    INSERT INTO public.conversations (company_id, lead_id, channel, channel_id, status, started_at, metadata)
    VALUES (_company, _lead, 'whatsapp', _identifier, 'HUMAN_ACTIVE', now(),
            jsonb_build_object('connection_id', _connection_id, 'remote_jid', _remote_jid))
    RETURNING id INTO _conv;

    INSERT INTO public.conversation_events (company_id, conversation_id, event_type, metadata)
    VALUES (_company, _conv, 'CONVERSATION_OPENED', jsonb_build_object('source', 'whatsapp_device'));
  END IF;

  INSERT INTO public.messages (company_id, conversation_id, connection_id, external_message_id,
                               sender_type, sender_name, message_type, content, media_url,
                               mime_type, metadata, delivery_status, delivered_at)
  VALUES (_company, _conv, _connection_id, _external_message_id, 'consultant',
          'WhatsApp da empresa', _message_type, _content, _media_url,
          _mime_type, _metadata || jsonb_build_object('origin', 'device'), 'SENT', now())
  RETURNING id INTO _msg;

  UPDATE public.whatsapp_connections SET last_event_at = now() WHERE id = _connection_id;

  RETURN jsonb_build_object('duplicate', false, 'message_id', _msg,
                            'conversation_id', _conv, 'lead_id', _lead, 'company_id', _company);
END; $$;
REVOKE ALL ON FUNCTION public.ingest_outbound_echo(uuid,text,text,public.message_type,text,text,text,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_outbound_echo(uuid,text,text,public.message_type,text,text,text,jsonb,text) TO service_role;

-- 8) Reescrever upsert_lead para usar resolve_lead_identity
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
    _lead := public.resolve_lead_identity(_company, _norm);
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

  IF _norm IS NOT NULL THEN
    PERFORM public.link_lead_identity(_lead, _norm, 'phone', 'manual');
  END IF;

  INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id)
  VALUES (_company, auth.uid(), 'CREATE_LEAD', 'lead', _lead);

  RETURN _lead;
END; $$;

REVOKE ALL ON FUNCTION public.upsert_lead(text,text,text,text,text,lead_source,uuid,jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.upsert_lead(text,text,text,text,text,lead_source,uuid,jsonb) TO authenticated, service_role;

-- 9) Dedup conservadora one-shot: funde leads quando há evidência explícita
--    de que LID e telefone pertencem ao mesmo contato (via senderPn em
--    whatsapp_events.payload casando com leads.whatsapp de telefone).
CREATE OR REPLACE FUNCTION public.dedup_leads_by_lid_phone()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _merged integer := 0;
  _pair record;
  _phone_lead uuid;
  _lid_lead uuid;
  _phone_norm text;
BEGIN
  -- Para cada lead com LID, procurar em whatsapp_events um senderPn que
  -- case com o whatsapp (telefone) de outro lead da mesma empresa.
  FOR _pair IN
    SELECT DISTINCT
           l_lid.id AS lid_lead_id,
           l_lid.company_id AS company_id,
           l_lid.whatsapp AS lid_identifier
      FROM public.leads l_lid
     WHERE l_lid.whatsapp LIKE '%@lid'
       AND EXISTS (
         SELECT 1 FROM public.whatsapp_events e
          WHERE e.company_id = l_lid.company_id
            AND e.payload::text LIKE '%' || l_lid.whatsapp || '%'
            AND (e.payload->'key'->>'senderPn' IS NOT NULL
                 OR e.payload->'key'->>'participantPn' IS NOT NULL
                 OR e.payload->>'senderPn' IS NOT NULL
                 OR e.payload->>'participantPn' IS NOT NULL)
       )
  LOOP
    -- Extrair telefone real do payload do evento
    SELECT public.normalize_phone(
             COALESCE(
               e.payload->'key'->>'senderPn',
               e.payload->'key'->>'participantPn',
               e.payload->>'senderPn',
               e.payload->>'participantPn'
             )
           )
      INTO _phone_norm
      FROM public.whatsapp_events e
     WHERE e.company_id = _pair.company_id
       AND e.payload::text LIKE '%' || _pair.lid_identifier || '%'
       AND (e.payload->'key'->>'senderPn' IS NOT NULL
            OR e.payload->'key'->>'participantPn' IS NOT NULL
            OR e.payload->>'senderPn' IS NOT NULL
            OR e.payload->>'participantPn' IS NOT NULL)
     LIMIT 1;

    IF _phone_norm IS NULL THEN CONTINUE; END IF;

    -- Procurar lead com esse telefone na mesma empresa
    SELECT id INTO _phone_lead FROM public.leads
     WHERE company_id = _pair.company_id
       AND whatsapp = _phone_norm
       AND id <> _pair.lid_lead_id
     LIMIT 1;

    IF _phone_lead IS NOT NULL THEN
      -- Fundir: preferir o lead com first_contact_at mais antigo
      SELECT id INTO _lid_lead FROM public.leads
       WHERE id IN (_pair.lid_lead_id, _phone_lead)
       ORDER BY first_contact_at ASC NULLS LAST, created_at ASC LIMIT 1;

      IF _lid_lead = _pair.lid_lead_id THEN
        PERFORM public.merge_leads(_pair.lid_lead_id, _phone_lead);
      ELSE
        PERFORM public.merge_leads(_phone_lead, _pair.lid_lead_id);
      END IF;
      _merged := _merged + 1;
    END IF;
  END LOOP;

  RETURN _merged;
END; $$;

REVOKE ALL ON FUNCTION public.dedup_leads_by_lid_phone() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.dedup_leads_by_lid_phone() TO authenticated, service_role;

-- Executar dedup conservadora (ignora erro se não houver duplicatas)
DO $$
DECLARE _result integer;
BEGIN
  SELECT public.dedup_leads_by_lid_phone() INTO _result;
  RAISE NOTICE 'Dedup: % leads fundidos', _result;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Dedup ignorada: %', SQLERRM;
END $$;
