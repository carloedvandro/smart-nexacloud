
CREATE OR REPLACE FUNCTION public.company_invite_member(_email text, _role app_role DEFAULT 'CONSULTANT'::app_role)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _company uuid := public.current_company_id(); _uid uuid; _invite uuid; _mail text := lower(btrim(coalesce(_email,'')));
BEGIN
  PERFORM public.assert_company_member(_company);
  IF NOT public.is_company_admin() THEN RAISE EXCEPTION 'somente administradores'; END IF;
  IF _mail = '' THEN RAISE EXCEPTION 'informe o e-mail'; END IF;
  IF _role = 'PLATFORM_ADMIN' THEN RAISE EXCEPTION 'papel inválido para empresa'; END IF;

  SELECT id INTO _uid FROM public.profiles WHERE lower(email) = _mail LIMIT 1;

  IF _uid IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.profiles WHERE id = _uid AND company_id IS NOT NULL AND company_id <> _company) THEN
      RAISE EXCEPTION 'este usuário já pertence a outra empresa';
    END IF;
    UPDATE public.profiles SET company_id = _company WHERE id = _uid;
    INSERT INTO public.user_roles (user_id, company_id, role)
    VALUES (_uid, _company, _role)
    ON CONFLICT (user_id, role) DO UPDATE SET company_id = EXCLUDED.company_id;

    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, metadata)
    VALUES (_company, auth.uid(), 'LINK_COMPANY_MEMBER', 'profile', _uid,
            jsonb_build_object('role', _role, 'email', _mail));
    RETURN jsonb_build_object('linked', true, 'user_id', _uid);
  END IF;

  INSERT INTO public.company_invites (company_id, email, role, invited_by)
  VALUES (_company, _mail, _role, auth.uid())
  ON CONFLICT (company_id, lower(email)) WHERE status = 'PENDING'
  DO UPDATE SET role = EXCLUDED.role, updated_at = now()
  RETURNING id INTO _invite;

  INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (_company, auth.uid(), 'INVITE_COMPANY_MEMBER', 'company_invite', _invite,
          jsonb_build_object('role', _role, 'email', _mail));

  RETURN jsonb_build_object('linked', false, 'invite_id', _invite);
END; $$;

CREATE OR REPLACE FUNCTION public.company_set_member_role(_user_id uuid, _role app_role)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _company uuid := public.current_company_id();
BEGIN
  PERFORM public.assert_company_member(_company);
  IF NOT public.is_company_admin() THEN RAISE EXCEPTION 'somente administradores'; END IF;
  IF _role = 'PLATFORM_ADMIN' THEN RAISE EXCEPTION 'papel inválido para empresa'; END IF;

  PERFORM 1 FROM public.profiles WHERE id = _user_id AND company_id = _company;
  IF NOT FOUND THEN RAISE EXCEPTION 'usuário não pertence a esta empresa'; END IF;

  IF _role <> 'ADMIN' AND (
    SELECT count(*) FROM public.user_roles ur
     JOIN public.profiles p ON p.id = ur.user_id
     WHERE ur.role = 'ADMIN' AND p.company_id = _company AND ur.user_id <> _user_id) = 0
  THEN RAISE EXCEPTION 'a empresa precisa manter ao menos um administrador'; END IF;

  DELETE FROM public.user_roles
   WHERE user_id = _user_id AND role IN ('ADMIN','CONSULTANT') AND role <> _role;

  INSERT INTO public.user_roles (user_id, company_id, role)
  VALUES (_user_id, _company, _role)
  ON CONFLICT (user_id, role) DO UPDATE SET company_id = EXCLUDED.company_id;

  INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (_company, auth.uid(), 'SET_COMPANY_MEMBER_ROLE', 'profile', _user_id,
          jsonb_build_object('role', _role));
END; $$;

CREATE OR REPLACE FUNCTION public.company_remove_member(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _company uuid := public.current_company_id();
BEGIN
  PERFORM public.assert_company_member(_company);
  IF NOT public.is_company_admin() THEN RAISE EXCEPTION 'somente administradores'; END IF;
  IF _user_id = auth.uid() THEN RAISE EXCEPTION 'não é possível remover o próprio vínculo'; END IF;

  PERFORM 1 FROM public.profiles WHERE id = _user_id AND company_id = _company;
  IF NOT FOUND THEN RAISE EXCEPTION 'usuário não pertence a esta empresa'; END IF;

  IF EXISTS (SELECT 1 FROM public.whatsapp_connections WHERE company_id = _company AND user_id = _user_id)
  THEN RAISE EXCEPTION 'libere as instâncias de WhatsApp deste usuário antes de remover o vínculo'; END IF;

  IF (SELECT count(*) FROM public.user_roles ur
        JOIN public.profiles p ON p.id = ur.user_id
       WHERE ur.role = 'ADMIN' AND p.company_id = _company AND ur.user_id <> _user_id) = 0
  THEN RAISE EXCEPTION 'transfira o papel de administrador antes de remover este vínculo'; END IF;

  DELETE FROM public.user_roles WHERE user_id = _user_id AND role IN ('ADMIN','CONSULTANT');
  UPDATE public.profiles SET company_id = NULL WHERE id = _user_id;

  INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (_company, auth.uid(), 'REMOVE_COMPANY_MEMBER', 'profile', _user_id, '{}'::jsonb);
END; $$;

CREATE OR REPLACE FUNCTION public.company_cancel_invite(_invite_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _company uuid := public.current_company_id();
BEGIN
  PERFORM public.assert_company_member(_company);
  IF NOT public.is_company_admin() THEN RAISE EXCEPTION 'somente administradores'; END IF;
  UPDATE public.company_invites SET status = 'CANCELLED', updated_at = now()
   WHERE id = _invite_id AND company_id = _company AND status = 'PENDING';
END; $$;
