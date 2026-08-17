-- Mensagens enviadas pelo próprio aparelho (fromMe) passam a entrar no histórico
CREATE OR REPLACE FUNCTION public.ingest_outbound_echo(
  _connection_id uuid,
  _remote_jid text,
  _external_message_id text,
  _message_type public.message_type DEFAULT 'text',
  _content text DEFAULT NULL,
  _media_url text DEFAULT NULL,
  _mime_type text DEFAULT NULL,
  _metadata jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _company uuid;
  _identifier text;
  _is_lid boolean := _remote_jid LIKE '%@lid';
  _phone text;
  _lead uuid;
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

  IF _external_message_id IS NOT NULL THEN
    SELECT id INTO _existing FROM public.messages
     WHERE company_id = _company AND external_message_id = _external_message_id;
    IF _existing IS NOT NULL THEN
      RETURN jsonb_build_object('duplicate', true, 'message_id', _existing);
    END IF;
  END IF;

  SELECT id INTO _lead FROM public.leads
   WHERE company_id = _company AND whatsapp = _identifier LIMIT 1;

  IF _lead IS NULL THEN
    INSERT INTO public.leads (company_id, phone, whatsapp, source, status,
                              first_contact_at, last_interaction_at, metadata)
    VALUES (_company, CASE WHEN _is_lid THEN NULL ELSE _identifier END, _identifier,
            'whatsapp', 'NEW', now(), now(),
            jsonb_build_object('remote_jid', _remote_jid, 'is_lid', _is_lid, 'origin', 'outbound'))
    RETURNING id INTO _lead;
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

REVOKE ALL ON FUNCTION public.ingest_outbound_echo(uuid,text,text,public.message_type,text,text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_outbound_echo(uuid,text,text,public.message_type,text,text,text,jsonb) TO service_role;

-- Guarda a transcrição de um áudio recebido
CREATE OR REPLACE FUNCTION public.set_message_transcription(
  _message_id uuid,
  _status public.transcription_status,
  _transcription text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.messages
     SET transcription_status = _status,
         transcription = COALESCE(_transcription, transcription)
   WHERE id = _message_id;
END; $$;

REVOKE ALL ON FUNCTION public.set_message_transcription(uuid,public.transcription_status,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_message_transcription(uuid,public.transcription_status,text) TO service_role;