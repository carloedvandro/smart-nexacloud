-- 1) Convites de empresa
CREATE TABLE public.company_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  email text NOT NULL,
  role public.app_role NOT NULL DEFAULT 'ADMIN',
  status text NOT NULL DEFAULT 'PENDING',
  invited_by uuid REFERENCES public.profiles(id),
  accepted_by uuid REFERENCES public.profiles(id),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_invites TO authenticated;
GRANT ALL ON public.company_invites TO service_role;

ALTER TABLE public.company_invites ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX company_invites_pending_uniq
  ON public.company_invites (company_id, lower(email))
  WHERE status = 'PENDING';

CREATE TRIGGER trg_company_invites_updated
BEFORE UPDATE ON public.company_invites
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "company admins read own invites"
ON public.company_invites FOR SELECT TO authenticated
USING (company_id = public.current_company_id() AND public.is_company_admin());

CREATE POLICY "invitee reads own invite"
ON public.company_invites FOR SELECT TO authenticated
USING (lower(email) = lower(coalesce((auth.jwt() ->> 'email'), '')));

-- 2) Acesso global do administrador da plataforma (backend, não só menu)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'companies','profiles','user_roles','leads','lead_memory','lead_notes',
    'conversations','messages','conversation_assignments','conversation_events',
    'assignment_attempts','ai_sessions','ai_summaries','knowledge_base',
    'business_hours','queue_settings','system_settings','privacy_consents',
    'audit_logs','whatsapp_connections','whatsapp_credentials','whatsapp_events',
    'whatsapp_instance_assignments','company_invites'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY "platform admin full access" ON public.%I FOR ALL TO authenticated USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin())', t);
  END LOOP;
END $$;

-- 3) Membro da empresa: platform admin não precisa de vínculo operacional
CREATE OR REPLACE FUNCTION public.assert_company_member(_company_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF public.is_platform_admin() THEN RETURN; END IF;
  IF _company_id IS NULL OR _company_id <> public.current_company_id() THEN
    RAISE EXCEPTION 'acesso negado';
  END IF;
END; $function$;

-- 4) Aceitar convites (usuário novo ou já existente)
CREATE OR REPLACE FUNCTION public.accept_company_invites(_user_id uuid, _email text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _inv record;
BEGIN
  IF _user_id IS NULL OR coalesce(btrim(_email),'') = '' THEN RETURN NULL; END IF;

  SELECT * INTO _inv FROM public.company_invites
   WHERE status = 'PENDING' AND lower(email) = lower(btrim(_email))
   ORDER BY created_at ASC LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  UPDATE public.profiles SET company_id = _inv.company_id WHERE id = _user_id;

  INSERT INTO public.user_roles (user_id, company_id, role)
  VALUES (_user_id, _inv.company_id, _inv.role)
  ON CONFLICT (user_id, role) DO UPDATE SET company_id = EXCLUDED.company_id;

  UPDATE public.company_invites
     SET status = 'ACCEPTED', accepted_by = _user_id, accepted_at = now()
   WHERE id = _inv.id;

  INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (_inv.company_id, _user_id, 'ACCEPT_COMPANY_INVITE', 'company_invite', _inv.id,
          jsonb_build_object('role', _inv.role));

  RETURN _inv.company_id;
END; $function$;

CREATE OR REPLACE FUNCTION public.claim_company_invite()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _email text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT email INTO _email FROM public.profiles WHERE id = auth.uid();
  RETURN public.accept_company_invites(auth.uid(), _email);
END; $function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, NULLIF(NEW.raw_user_meta_data->>'full_name',''))
  ON CONFLICT (id) DO NOTHING;

  PERFORM public.accept_company_invites(NEW.id, NEW.email);
  RETURN NEW;
END; $function$;

-- 5) Gestão de membros pelo administrador da plataforma
CREATE OR REPLACE FUNCTION public.platform_invite_company_member(
  _company_id uuid, _email text, _role public.app_role DEFAULT 'ADMIN')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _uid uuid; _invite uuid; _mail text := lower(btrim(coalesce(_email,'')));
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'somente o administrador da plataforma'; END IF;
  IF _mail = '' THEN RAISE EXCEPTION 'informe o e-mail'; END IF;
  IF _role = 'PLATFORM_ADMIN' THEN RAISE EXCEPTION 'papel inválido para empresa'; END IF;
  PERFORM 1 FROM public.companies WHERE id = _company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'empresa inexistente'; END IF;

  SELECT id INTO _uid FROM public.profiles WHERE lower(email) = _mail LIMIT 1;

  IF _uid IS NOT NULL THEN
    UPDATE public.profiles SET company_id = _company_id WHERE id = _uid;
    INSERT INTO public.user_roles (user_id, company_id, role)
    VALUES (_uid, _company_id, _role)
    ON CONFLICT (user_id, role) DO UPDATE SET company_id = EXCLUDED.company_id;

    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, metadata)
    VALUES (_company_id, auth.uid(), 'LINK_COMPANY_MEMBER', 'profile', _uid,
            jsonb_build_object('role', _role, 'email', _mail));

    RETURN jsonb_build_object('linked', true, 'user_id', _uid);
  END IF;

  INSERT INTO public.company_invites (company_id, email, role, invited_by)
  VALUES (_company_id, _mail, _role, auth.uid())
  ON CONFLICT (company_id, lower(email)) WHERE status = 'PENDING'
  DO UPDATE SET role = EXCLUDED.role, updated_at = now()
  RETURNING id INTO _invite;

  INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (_company_id, auth.uid(), 'INVITE_COMPANY_MEMBER', 'company_invite', _invite,
          jsonb_build_object('role', _role, 'email', _mail));

  RETURN jsonb_build_object('linked', false, 'invite_id', _invite);
END; $function$;

CREATE OR REPLACE FUNCTION public.platform_set_member_role(
  _user_id uuid, _company_id uuid, _role public.app_role)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'somente o administrador da plataforma'; END IF;
  IF _role = 'PLATFORM_ADMIN' THEN RAISE EXCEPTION 'papel inválido para empresa'; END IF;

  PERFORM 1 FROM public.profiles WHERE id = _user_id AND company_id = _company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'usuário não pertence a esta empresa'; END IF;

  IF _role <> 'ADMIN' AND (
    SELECT count(*) FROM public.user_roles ur
     JOIN public.profiles p ON p.id = ur.user_id
     WHERE ur.role = 'ADMIN' AND p.company_id = _company_id AND ur.user_id <> _user_id) = 0
  THEN RAISE EXCEPTION 'a empresa precisa manter ao menos um administrador'; END IF;

  DELETE FROM public.user_roles
   WHERE user_id = _user_id AND role IN ('ADMIN','CONSULTANT') AND role <> _role;

  INSERT INTO public.user_roles (user_id, company_id, role)
  VALUES (_user_id, _company_id, _role)
  ON CONFLICT (user_id, role) DO UPDATE SET company_id = EXCLUDED.company_id;

  INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (_company_id, auth.uid(), 'SET_COMPANY_MEMBER_ROLE', 'profile', _user_id,
          jsonb_build_object('role', _role));
END; $function$;

CREATE OR REPLACE FUNCTION public.platform_remove_company_member(
  _user_id uuid, _company_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'somente o administrador da plataforma'; END IF;

  PERFORM 1 FROM public.profiles WHERE id = _user_id AND company_id = _company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'usuário não pertence a esta empresa'; END IF;

  IF (SELECT count(*) FROM public.user_roles ur
        JOIN public.profiles p ON p.id = ur.user_id
       WHERE ur.role = 'ADMIN' AND p.company_id = _company_id AND ur.user_id <> _user_id) = 0
  THEN RAISE EXCEPTION 'transfira o papel de administrador antes de remover este vínculo'; END IF;

  IF EXISTS (SELECT 1 FROM public.whatsapp_connections
              WHERE company_id = _company_id AND user_id = _user_id)
  THEN RAISE EXCEPTION 'libere as instâncias de WhatsApp deste usuário antes de remover o vínculo'; END IF;

  DELETE FROM public.user_roles
   WHERE user_id = _user_id AND role IN ('ADMIN','CONSULTANT');

  UPDATE public.profiles SET company_id = NULL WHERE id = _user_id;

  INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (_company_id, auth.uid(), 'REMOVE_COMPANY_MEMBER', 'profile', _user_id, '{}'::jsonb);
END; $function$;