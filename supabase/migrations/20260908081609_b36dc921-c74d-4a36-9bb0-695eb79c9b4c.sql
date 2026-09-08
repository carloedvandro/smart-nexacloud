CREATE OR REPLACE FUNCTION public.redeem_invite_link(_token uuid, _document text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _inv public.company_invites; _uid uuid := auth.uid(); _profile public.profiles; _auth_email text;
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

  SELECT lower(u.email) INTO _auth_email FROM auth.users u WHERE u.id = _uid;

  IF _inv.email IS NOT NULL
     AND lower(_inv.email) <> lower(coalesce(_profile.email, ''))
     AND lower(_inv.email) <> coalesce(_auth_email, '') THEN
    RAISE EXCEPTION 'este convite é destinado a % — você está logado como %',
      _inv.email, coalesce(_auth_email, _profile.email, 'outra conta');
  END IF;

  IF _profile.company_id IS NOT NULL AND _profile.company_id <> _inv.company_id THEN
    RAISE EXCEPTION 'este usuário já pertence a outra empresa';
  END IF;

  UPDATE public.profiles
     SET company_id = _inv.company_id,
         email = COALESCE(email, _auth_email),
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

REVOKE ALL ON FUNCTION public.redeem_invite_link(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_invite_link(uuid, text) TO authenticated;