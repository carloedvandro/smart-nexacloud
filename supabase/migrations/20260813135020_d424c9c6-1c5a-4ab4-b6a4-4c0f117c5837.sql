-- Instâncias já existentes sem numeração viram DISPONÍVEL quando não têm colaborador
UPDATE public.whatsapp_connections
   SET status = 'AVAILABLE'
 WHERE user_id IS NULL AND status = 'DISCONNECTED';

ALTER TABLE public.whatsapp_connections ALTER COLUMN status SET DEFAULT 'AVAILABLE';

-- ============ PROVISIONAMENTO (somente administrador da plataforma) ============
CREATE OR REPLACE FUNCTION public.provision_whatsapp_instance(
  _company_id uuid,
  _instance_key text,
  _name text DEFAULT NULL,
  _instance_number integer DEFAULT NULL,
  _api_host text DEFAULT NULL,
  _api_key text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid; _num integer; _label text; _company_name text;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'somente o administrador da plataforma pode provisionar instâncias';
  END IF;
  IF coalesce(btrim(_instance_key),'') = '' THEN RAISE EXCEPTION 'instance_key obrigatória'; END IF;

  SELECT name INTO _company_name FROM public.companies WHERE id = _company_id;
  IF _company_name IS NULL THEN RAISE EXCEPTION 'empresa inexistente'; END IF;

  _num := COALESCE(_instance_number,
           (SELECT COALESCE(MAX(instance_number), 0) + 1
              FROM public.whatsapp_connections WHERE company_id = _company_id));
  _label := COALESCE(NULLIF(btrim(_name), ''), _company_name || ' — Instância ' || _num);

  INSERT INTO public.whatsapp_connections
    (company_id, name, instance_number, provider, instance_id, status, provisioned_by, provisioned_at)
  VALUES (_company_id, _label, _num, 'mega', NULL, 'AVAILABLE', auth.uid(), now())
  RETURNING id INTO _id;

  INSERT INTO public.whatsapp_credentials (connection_id, company_id, instance_key, api_host, api_key)
  VALUES (_id, _company_id, btrim(_instance_key), NULLIF(btrim(coalesce(_api_host,'')),''),
          NULLIF(btrim(coalesce(_api_key,'')),''));

  INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (_company_id, auth.uid(), 'PROVISION_WHATSAPP_INSTANCE', 'whatsapp_connection', _id,
          jsonb_build_object('name', _label, 'instance_number', _num));

  RETURN _id;
END; $$;
REVOKE ALL ON FUNCTION public.provision_whatsapp_instance(uuid,text,text,integer,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provision_whatsapp_instance(uuid,text,text,integer,text,text) TO authenticated, service_role;

-- ============ VÍNCULO DE COLABORADOR ============
CREATE OR REPLACE FUNCTION public.assign_whatsapp_instance(_connection_id uuid, _user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _company uuid := public.current_company_id(); _conn record; _uname text;
BEGIN
  PERFORM public.assert_company_member(_company);
  IF NOT public.is_company_admin() THEN RAISE EXCEPTION 'somente administradores'; END IF;

  SELECT * INTO _conn FROM public.whatsapp_connections
   WHERE id = _connection_id AND company_id = _company FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'instância inexistente'; END IF;
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
REVOKE ALL ON FUNCTION public.assign_whatsapp_instance(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_whatsapp_instance(uuid,uuid) TO authenticated, service_role;

-- ============ LIBERAÇÃO DA INSTÂNCIA (histórico preservado) ============
CREATE OR REPLACE FUNCTION public.release_whatsapp_instance(_connection_id uuid, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _company uuid := public.current_company_id(); _conn record;
BEGIN
  PERFORM public.assert_company_member(_company);
  IF NOT public.is_company_admin() THEN RAISE EXCEPTION 'somente administradores'; END IF;

  SELECT * INTO _conn FROM public.whatsapp_connections
   WHERE id = _connection_id AND company_id = _company FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'instância inexistente'; END IF;

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
REVOKE ALL ON FUNCTION public.release_whatsapp_instance(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_whatsapp_instance(uuid,text) TO authenticated, service_role;

-- ============ ATUALIZAÇÃO DE ESTADO / NÚMERO (backend) ============
CREATE OR REPLACE FUNCTION public.set_instance_connection_state(
  _connection_id uuid,
  _status public.whatsapp_connection_status,
  _phone_number text DEFAULT NULL,
  _qr_code text DEFAULT NULL,
  _qr_code_status text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _phone text := public.normalize_phone(_phone_number);
BEGIN
  UPDATE public.whatsapp_connections
     SET status = _status,
         phone_number = COALESCE(_phone, phone_number),
         qr_code = CASE WHEN _status = 'CONNECTED' THEN NULL ELSE COALESCE(_qr_code, qr_code) END,
         qr_code_status = _qr_code_status,
         last_connected_at = CASE WHEN _status = 'CONNECTED' THEN now() ELSE last_connected_at END,
         last_disconnected_at = CASE WHEN _status IN ('DISCONNECTED','LOGGED_OUT') THEN now() ELSE last_disconnected_at END,
         last_event_at = now()
   WHERE id = _connection_id;

  IF _phone IS NOT NULL THEN
    UPDATE public.whatsapp_instance_assignments
       SET phone_number = _phone
     WHERE connection_id = _connection_id AND ended_at IS NULL;
  END IF;
END; $$;
REVOKE ALL ON FUNCTION public.set_instance_connection_state(uuid,public.whatsapp_connection_status,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_instance_connection_state(uuid,public.whatsapp_connection_status,text,text,text) TO service_role;