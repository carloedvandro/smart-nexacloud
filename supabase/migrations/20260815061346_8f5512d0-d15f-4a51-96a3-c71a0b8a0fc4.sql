CREATE OR REPLACE FUNCTION public.assign_whatsapp_instance(_connection_id uuid, _user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _company uuid; _conn record; _uname text; _platform boolean := public.is_platform_admin();
BEGIN
  SELECT * INTO _conn FROM public.whatsapp_connections WHERE id = _connection_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'instância inexistente'; END IF;
  _company := _conn.company_id;

  IF NOT _platform THEN
    PERFORM public.assert_company_member(_company);
    IF NOT public.is_company_admin() THEN RAISE EXCEPTION 'somente administradores'; END IF;
  END IF;

  IF _conn.user_id IS NOT NULL AND _conn.user_id <> _user_id THEN
    RAISE EXCEPTION 'instância já vinculada a outro colaborador; libere-a antes';
  END IF;
  IF _conn.status = 'BLOCKED' THEN RAISE EXCEPTION 'instância bloqueada'; END IF;

  SELECT COALESCE(full_name, email) INTO _uname FROM public.profiles
   WHERE id = _user_id AND company_id = _company;
  IF _uname IS NULL THEN RAISE EXCEPTION 'colaborador inválido'; END IF;

  UPDATE public.whatsapp_connections
     SET user_id = _user_id, assigned_at = now(), assigned_by = auth.uid(),
         status = CASE WHEN status = 'CONNECTED' THEN status ELSE 'DISCONNECTED'::whatsapp_connection_status END
   WHERE id = _connection_id;

  IF NOT EXISTS (SELECT 1 FROM public.whatsapp_instance_assignments
                  WHERE connection_id = _connection_id AND user_id = _user_id AND ended_at IS NULL) THEN
    INSERT INTO public.whatsapp_instance_assignments
      (company_id, connection_id, user_id, user_name, assigned_by)
    VALUES (_company, _connection_id, _user_id, _uname, auth.uid());
  END IF;

  INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (_company, auth.uid(), 'ASSIGN_WHATSAPP_INSTANCE', 'whatsapp_connection', _connection_id,
          jsonb_build_object('user_id', _user_id));
END; $$;

CREATE OR REPLACE FUNCTION public.release_whatsapp_instance(_connection_id uuid, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _company uuid; _conn record; _platform boolean := public.is_platform_admin();
BEGIN
  SELECT * INTO _conn FROM public.whatsapp_connections WHERE id = _connection_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'instância inexistente'; END IF;
  _company := _conn.company_id;

  IF NOT _platform THEN
    PERFORM public.assert_company_member(_company);
    IF NOT public.is_company_admin() THEN RAISE EXCEPTION 'somente administradores'; END IF;
  END IF;

  UPDATE public.whatsapp_instance_assignments
     SET ended_at = now(), released_by = auth.uid(), release_reason = _reason,
         phone_number = COALESCE(phone_number, _conn.phone_number)
   WHERE connection_id = _connection_id AND ended_at IS NULL;

  UPDATE public.whatsapp_connections
     SET user_id = NULL, assigned_at = NULL, assigned_by = NULL,
         phone_number = NULL, qr_code = NULL, qr_code_status = NULL,
         status = 'AVAILABLE', last_disconnected_at = now()
   WHERE id = _connection_id;

  INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (_company, auth.uid(), 'RELEASE_WHATSAPP_INSTANCE', 'whatsapp_connection', _connection_id,
          jsonb_build_object('previous_user', _conn.user_id, 'previous_phone', _conn.phone_number,
                             'reason', _reason));
END; $$;

CREATE OR REPLACE FUNCTION public.set_trunk_whatsapp_instance(_connection_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _company uuid; _platform boolean := public.is_platform_admin();
BEGIN
  SELECT company_id INTO _company FROM public.whatsapp_connections WHERE id = _connection_id;
  IF _company IS NULL THEN RAISE EXCEPTION 'instância inexistente'; END IF;

  IF NOT _platform THEN
    PERFORM public.assert_company_member(_company);
    IF NOT public.is_company_admin() THEN RAISE EXCEPTION 'somente administradores'; END IF;
  END IF;

  UPDATE public.whatsapp_connections SET is_trunk = false
   WHERE company_id = _company AND is_trunk = true AND id <> _connection_id;
  UPDATE public.whatsapp_connections SET is_trunk = true WHERE id = _connection_id;

  INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (_company, auth.uid(), 'SET_TRUNK_WHATSAPP_INSTANCE', 'whatsapp_connection', _connection_id, '{}'::jsonb);
END; $$;