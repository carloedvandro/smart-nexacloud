ALTER TABLE public.company_invites
  ADD COLUMN IF NOT EXISTS token uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  ADD COLUMN IF NOT EXISTS max_uses integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS used_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.company_invites ALTER COLUMN email DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS company_invites_token_uidx ON public.company_invites(token);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS document text,
  ADD COLUMN IF NOT EXISTS person_type text NOT NULL DEFAULT 'PF';

CREATE OR REPLACE FUNCTION public.create_invite_link(
  _role app_role DEFAULT 'CONSULTANT'::app_role,
  _email text DEFAULT NULL,
  _expires_hours integer DEFAULT 168,
  _company_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _company uuid;
  _mail text := NULLIF(lower(btrim(coalesce(_email,''))), '');
  _hours integer := GREATEST(1, LEAST(coalesce(_expires_hours,168), 720));
  _row public.company_invites;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _role = 'PLATFORM_ADMIN' THEN RAISE EXCEPTION 'papel inválido para empresa'; END IF;

  IF public.is_platform_admin() THEN
    _company := COALESCE(_company_id, public.current_company_id());
  ELSE
    _company := public.current_company_id();
    IF NOT public.is_company_admin() THEN RAISE EXCEPTION 'somente administradores'; END IF;
    IF _company_id IS NOT NULL AND _company_id <> _company THEN RAISE EXCEPTION 'acesso negado'; END IF;
  END IF;

  IF _company IS NULL THEN RAISE EXCEPTION 'empresa não informada'; END IF;
  PERFORM 1 FROM public.companies WHERE id = _company;
  IF NOT FOUND THEN RAISE EXCEPTION 'empresa inexistente'; END IF;

  INSERT INTO public.company_invites (company_id, email, role, invited_by, status, expires_at, max_uses, used_count)
  VALUES (_company, _mail, _role, auth.uid(), 'PENDING', now() + make_interval(hours => _hours), 1, 0)
  RETURNING * INTO _row;

  INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (_company, auth.uid(), 'CREATE_INVITE_LINK', 'company_invite', _row.id,
          jsonb_build_object('role', _role, 'email', _mail, 'expires_at', _row.expires_at));

  RETURN jsonb_build_object('invite_id', _row.id, 'token', _row.token,
                            'expires_at', _row.expires_at, 'role', _row.role,
                            'company_id', _company);
END; $$;

CREATE OR REPLACE FUNCTION public.invite_link_info(_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _inv record; _company text;
BEGIN
  SELECT * INTO _inv FROM public.company_invites WHERE token = _token;
  IF NOT FOUND THEN RETURN jsonb_build_object('valid', false, 'reason', 'NOT_FOUND'); END IF;

  SELECT name INTO _company FROM public.companies WHERE id = _inv.company_id;

  IF _inv.status <> 'PENDING' OR _inv.used_count >= _inv.max_uses THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'USED', 'company_name', _company);
  END IF;
  IF _inv.expires_at <= now() THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'EXPIRED', 'company_name', _company);
  END IF;

  RETURN jsonb_build_object('valid', true, 'company_name', _company, 'role', _inv.role,
                            'email', _inv.email, 'expires_at', _inv.expires_at);
END; $$;

CREATE OR REPLACE FUNCTION public.redeem_invite_link(_token uuid, _document text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _inv public.company_invites; _uid uuid := auth.uid(); _profile public.profiles;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT * INTO _inv FROM public.company_invites WHERE token = _token FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'convite inválido'; END IF;
  IF _inv.status <> 'PENDING' OR _inv.used_count >= _inv.max_uses THEN
    RAISE EXCEPTION 'este convite já foi utilizado';
  END IF;
  IF _inv.expires_at <= now() THEN
    UPDATE public.company_invites SET status = 'EXPIRED', updated_at = now() WHERE id = _inv.id;
    RAISE EXCEPTION 'este convite expirou';
  END IF;

  SELECT * INTO _profile FROM public.profiles WHERE id = _uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'perfil inexistente'; END IF;
  IF _inv.email IS NOT NULL AND lower(coalesce(_profile.email,'')) <> lower(_inv.email) THEN
    RAISE EXCEPTION 'este convite é destinado a outro e-mail';
  END IF;
  IF _profile.company_id IS NOT NULL AND _profile.company_id <> _inv.company_id THEN
    RAISE EXCEPTION 'este usuário já pertence a outra empresa';
  END IF;

  UPDATE public.profiles
     SET company_id = _inv.company_id,
         document = COALESCE(NULLIF(regexp_replace(coalesce(_document,''), '[^0-9]', '', 'g'), ''), document),
         person_type = 'PF'
   WHERE id = _uid;

  INSERT INTO public.user_roles (user_id, company_id, role)
  VALUES (_uid, _inv.company_id, _inv.role)
  ON CONFLICT (user_id, role) DO UPDATE SET company_id = EXCLUDED.company_id;

  UPDATE public.company_invites
     SET status = 'ACCEPTED', accepted_by = _uid, accepted_at = now(),
         used_count = used_count + 1, updated_at = now()
   WHERE id = _inv.id;

  INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (_inv.company_id, _uid, 'REDEEM_INVITE_LINK', 'company_invite', _inv.id,
          jsonb_build_object('role', _inv.role));

  RETURN _inv.company_id;
END; $$;

CREATE OR REPLACE FUNCTION public.log_impersonation(_target_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _target public.profiles;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO _target FROM public.profiles WHERE id = _target_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'usuário inexistente'; END IF;

  IF NOT public.is_platform_admin() THEN
    IF NOT public.is_company_admin() OR _target.company_id IS DISTINCT FROM public.current_company_id() THEN
      RAISE EXCEPTION 'acesso negado';
    END IF;
  END IF;

  INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (_target.company_id, auth.uid(), 'START_IMPERSONATION', 'profile', _target_user_id, '{}'::jsonb);
END; $$;

GRANT EXECUTE ON FUNCTION public.invite_link_info(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_invite_link(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_invite_link(app_role, text, integer, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_impersonation(uuid) TO authenticated;