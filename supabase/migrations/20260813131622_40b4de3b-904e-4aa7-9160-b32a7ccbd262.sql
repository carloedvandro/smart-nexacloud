-- ============ ENUMS ============
DO $$ BEGIN
  CREATE TYPE public.message_delivery_status AS ENUM ('PENDING','SENT','DELIVERED','READ','FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.transcription_status AS ENUM ('NONE','PENDING','PROCESSING','COMPLETED','FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============ CONEXÕES ============
ALTER TABLE public.whatsapp_connections
  ADD COLUMN IF NOT EXISTS webhook_token uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS qr_code text,
  ADD COLUMN IF NOT EXISTS last_event_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_connections_webhook_token_key
  ON public.whatsapp_connections (webhook_token);

-- Credenciais sensíveis isoladas: sem grants para anon/authenticated.
CREATE TABLE IF NOT EXISTS public.whatsapp_credentials (
  connection_id uuid PRIMARY KEY REFERENCES public.whatsapp_connections(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  instance_key text NOT NULL,
  api_host text,
  api_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.whatsapp_credentials TO service_role;
ALTER TABLE public.whatsapp_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "no direct access to credentials" ON public.whatsapp_credentials
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
DROP TRIGGER IF EXISTS trg_wa_cred_updated ON public.whatsapp_credentials;
CREATE TRIGGER trg_wa_cred_updated BEFORE UPDATE ON public.whatsapp_credentials
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ MENSAGENS ============
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS delivery_status public.message_delivery_status NOT NULL DEFAULT 'SENT',
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS read_at timestamptz,
  ADD COLUMN IF NOT EXISTS failed_at timestamptz,
  ADD COLUMN IF NOT EXISTS failed_reason text,
  ADD COLUMN IF NOT EXISTS send_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_send_attempts integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS connection_id uuid REFERENCES public.whatsapp_connections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS transcription_status public.transcription_status NOT NULL DEFAULT 'NONE';

CREATE INDEX IF NOT EXISTS messages_company_external_idx
  ON public.messages (company_id, external_message_id) WHERE external_message_id IS NOT NULL;

-- permitir que o dono da mensagem enviada atualize status (via service role apenas na prática)
DROP POLICY IF EXISTS "messages update by service" ON public.messages;

-- ============ EVENTOS ============
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_events_dedupe_idx
  ON public.whatsapp_events (connection_id, external_event_id)
  WHERE external_event_id IS NOT NULL;

-- ============ RPCs DE INTEGRAÇÃO (chamadas somente pelo backend) ============

-- Recebe mensagem do cliente: resolve lead, conversa e mensagem de forma idempotente.
CREATE OR REPLACE FUNCTION public.ingest_inbound_message(
  _connection_id uuid,
  _remote_jid text,
  _external_message_id text,
  _push_name text DEFAULT NULL,
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
    _identifier := _remote_jid;              -- LID preservado integralmente
  ELSE
    _phone := public.normalize_phone(replace(_remote_jid, '@s.whatsapp.net', ''));
    _identifier := _phone;
  END IF;
  IF _identifier IS NULL OR _identifier = '' THEN RAISE EXCEPTION 'remetente inválido'; END IF;

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
    INSERT INTO public.leads (company_id, name, phone, whatsapp, source, status,
                              first_contact_at, last_interaction_at, metadata)
    VALUES (_company, NULLIF(btrim(coalesce(_push_name,'')),''),
            CASE WHEN _is_lid THEN NULL ELSE _identifier END, _identifier,
            'whatsapp', 'NEW', now(), now(),
            jsonb_build_object('remote_jid', _remote_jid, 'is_lid', _is_lid))
    RETURNING id INTO _lead;
  ELSE
    UPDATE public.leads
       SET name = COALESCE(name, NULLIF(btrim(coalesce(_push_name,'')),'')),
           last_interaction_at = now(),
           first_contact_at = COALESCE(first_contact_at, now())
     WHERE id = _lead;
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
REVOKE ALL ON FUNCTION public.ingest_inbound_message(uuid,text,text,text,public.message_type,text,text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_inbound_message(uuid,text,text,text,public.message_type,text,text,text,jsonb) TO service_role;

-- Atualiza status de uma mensagem específica pelo external_message_id (nunca "a última do número").
CREATE OR REPLACE FUNCTION public.update_message_delivery(
  _company_id uuid,
  _external_message_id text,
  _status public.message_delivery_status,
  _reason text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _count integer;
BEGIN
  UPDATE public.messages
     SET delivery_status = _status,
         delivered_at = CASE WHEN _status IN ('DELIVERED','READ') THEN COALESCE(delivered_at, now()) ELSE delivered_at END,
         read_at = CASE WHEN _status = 'READ' THEN COALESCE(read_at, now()) ELSE read_at END,
         failed_at = CASE WHEN _status = 'FAILED' THEN now() ELSE failed_at END,
         failed_reason = CASE WHEN _status = 'FAILED' THEN _reason ELSE failed_reason END
   WHERE company_id = _company_id AND external_message_id = _external_message_id;
  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count > 0;
END; $$;
REVOKE ALL ON FUNCTION public.update_message_delivery(uuid,text,public.message_delivery_status,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_message_delivery(uuid,text,public.message_delivery_status,text) TO service_role;

-- Registra mensagem enviada pelo painel (estado inicial PENDING) e devolve o id.
CREATE OR REPLACE FUNCTION public.create_outbound_message(
  _conversation_id uuid,
  _company_id uuid,
  _sender_id uuid,
  _sender_type public.sender_type,
  _sender_name text,
  _content text,
  _message_type public.message_type DEFAULT 'text',
  _media_url text DEFAULT NULL,
  _connection_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _msg uuid;
BEGIN
  PERFORM 1 FROM public.conversations WHERE id = _conversation_id AND company_id = _company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'conversa inexistente'; END IF;

  INSERT INTO public.messages (company_id, conversation_id, connection_id, sender_type, sender_id,
                               sender_name, message_type, content, media_url, delivery_status, send_attempts)
  VALUES (_company_id, _conversation_id, _connection_id, _sender_type, _sender_id, _sender_name,
          _message_type, _content, _media_url, 'PENDING', 1)
  RETURNING id INTO _msg;

  UPDATE public.conversations
     SET status = CASE WHEN status IN ('CLOSED','PAUSED') THEN status ELSE 'WAITING_CUSTOMER'::conversation_status END,
         unread_count = 0
   WHERE id = _conversation_id;

  RETURN _msg;
END; $$;
REVOKE ALL ON FUNCTION public.create_outbound_message(uuid,uuid,uuid,public.sender_type,text,text,public.message_type,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_outbound_message(uuid,uuid,uuid,public.sender_type,text,text,public.message_type,text,uuid) TO service_role;

-- Conclui o envio: grava id externo e status.
CREATE OR REPLACE FUNCTION public.finalize_outbound_message(
  _message_id uuid,
  _external_message_id text,
  _status public.message_delivery_status,
  _reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.messages
     SET external_message_id = COALESCE(_external_message_id, external_message_id),
         delivery_status = _status,
         failed_at = CASE WHEN _status = 'FAILED' THEN now() ELSE failed_at END,
         failed_reason = CASE WHEN _status = 'FAILED' THEN _reason ELSE NULL END,
         next_retry_at = CASE WHEN _status = 'FAILED' THEN now() + interval '2 minutes' ELSE NULL END
   WHERE id = _message_id;
END; $$;
REVOKE ALL ON FUNCTION public.finalize_outbound_message(uuid,text,public.message_delivery_status,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_outbound_message(uuid,text,public.message_delivery_status,text) TO service_role;