CREATE OR REPLACE FUNCTION public.post_message(_conversation_id uuid, _sender_type sender_type, _content text DEFAULT NULL::text, _message_type message_type DEFAULT 'text'::message_type, _external_message_id text DEFAULT NULL::text, _sender_name text DEFAULT NULL::text, _media_url text DEFAULT NULL::text, _mime_type text DEFAULT NULL::text, _metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _company uuid := public.current_company_id();
  _msg uuid;
  _sender uuid;
  _name text := _sender_name;
  _assigned uuid;
BEGIN
  PERFORM public.assert_company_member(_company);
  SELECT assigned_user_id INTO _assigned FROM public.conversations
   WHERE id = _conversation_id AND company_id = _company;
  IF NOT FOUND THEN RAISE EXCEPTION 'conversa inexistente'; END IF;

  -- Só quem está com a oportunidade pode falar com o lead: o responsável atual,
  -- quem tem oferta ainda aberta, ou um administrador da empresa.
  IF _sender_type IN ('consultant','admin')
     AND NOT public.is_company_admin()
     AND NOT public.is_platform_admin() THEN
    IF _assigned IS NOT NULL AND _assigned <> auth.uid() THEN
      RAISE EXCEPTION 'este atendimento já está com outro consultor';
    END IF;
    IF _assigned IS NULL AND NOT EXISTS (
      SELECT 1 FROM public.assignment_attempts a
       WHERE a.conversation_id = _conversation_id
         AND a.consultant_id = auth.uid()
         AND a.status = 'WAITING'
    ) THEN
      RAISE EXCEPTION 'esta oportunidade expirou e não está mais com você';
    END IF;
  END IF;

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
END; $function$;