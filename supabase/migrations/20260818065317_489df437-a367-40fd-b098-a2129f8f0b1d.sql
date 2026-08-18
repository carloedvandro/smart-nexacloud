
-- 1) Limites comerciais por empresa -------------------------------------------------
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS max_internal_users integer NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS max_consultants integer NOT NULL DEFAULT 7;

CREATE OR REPLACE FUNCTION public.company_license_usage(_company uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _target uuid := COALESCE(_company, public.current_company_id());
  _max_users integer; _max_consultants integer;
  _users integer; _consultants integer; _admins integer;
BEGIN
  IF _target IS NULL THEN RETURN NULL; END IF;
  IF NOT public.is_platform_admin()
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND company_id = _target) THEN
    RAISE EXCEPTION 'acesso negado';
  END IF;

  SELECT c.max_internal_users, c.max_consultants INTO _max_users, _max_consultants
    FROM public.companies c WHERE c.id = _target;

  SELECT count(*) INTO _users
    FROM public.profiles p
   WHERE p.company_id = _target AND p.is_active
     AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id AND r.role = 'PLATFORM_ADMIN');

  SELECT count(DISTINCT p.id) INTO _consultants
    FROM public.profiles p
    JOIN public.user_roles r ON r.user_id = p.id AND r.role = 'CONSULTANT'
   WHERE p.company_id = _target AND p.is_active
     AND NOT EXISTS (SELECT 1 FROM public.user_roles pr WHERE pr.user_id = p.id AND pr.role = 'PLATFORM_ADMIN');

  SELECT count(DISTINCT p.id) INTO _admins
    FROM public.profiles p
    JOIN public.user_roles r ON r.user_id = p.id AND r.role = 'ADMIN'
   WHERE p.company_id = _target AND p.is_active
     AND NOT EXISTS (SELECT 1 FROM public.user_roles pr WHERE pr.user_id = p.id AND pr.role = 'PLATFORM_ADMIN');

  RETURN jsonb_build_object(
    'company_id', _target,
    'max_internal_users', _max_users,
    'max_consultants', _max_consultants,
    'users', _users,
    'consultants', _consultants,
    'admins', _admins,
    'pending_invites', (SELECT count(*) FROM public.company_invites i
                         WHERE i.company_id = _target AND i.status = 'PENDING'
                           AND i.expires_at > now() AND i.used_count < i.max_uses)
  );
END; $$;

REVOKE ALL ON FUNCTION public.company_license_usage(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.company_license_usage(uuid) TO authenticated, service_role;

-- Mensagem única de limite atingido
CREATE OR REPLACE FUNCTION public.raise_license_limit(_company uuid)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _u integer; _c integer;
BEGIN
  SELECT max_internal_users, max_consultants INTO _u, _c FROM public.companies WHERE id = _company;
  RAISE EXCEPTION 'Limite contratado atingido: esta empresa possui até % consultores e % usuários internos no total. Para ampliar, entre em contato com o administrador da plataforma.', COALESCE(_c,7), COALESCE(_u,8);
END; $$;

-- Validação usada por convites e vínculos (conta o novo usuário que entraria)
CREATE OR REPLACE FUNCTION public.assert_company_license(_company uuid, _role app_role, _new_user boolean DEFAULT true)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _usage jsonb;
BEGIN
  IF _company IS NULL THEN RETURN; END IF;
  SELECT jsonb_build_object(
    'max_internal_users', c.max_internal_users,
    'max_consultants', c.max_consultants,
    'users', (SELECT count(*) FROM public.profiles p
               WHERE p.company_id = _company AND p.is_active
                 AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id AND r.role = 'PLATFORM_ADMIN')),
    'consultants', (SELECT count(DISTINCT p.id) FROM public.profiles p
                      JOIN public.user_roles r ON r.user_id = p.id AND r.role = 'CONSULTANT'
                     WHERE p.company_id = _company AND p.is_active
                       AND NOT EXISTS (SELECT 1 FROM public.user_roles pr WHERE pr.user_id = p.id AND pr.role = 'PLATFORM_ADMIN'))
  ) INTO _usage FROM public.companies c WHERE c.id = _company;

  IF _usage IS NULL THEN RETURN; END IF;

  IF _new_user AND (_usage->>'users')::int + 1 > (_usage->>'max_internal_users')::int THEN
    PERFORM public.raise_license_limit(_company);
  END IF;
  IF _role = 'CONSULTANT' AND (_usage->>'consultants')::int + 1 > (_usage->>'max_consultants')::int THEN
    PERFORM public.raise_license_limit(_company);
  END IF;
END; $$;

REVOKE ALL ON FUNCTION public.assert_company_license(uuid, app_role, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_company_license(uuid, app_role, boolean) TO authenticated, service_role;

-- Barreira final no banco: qualquer rota que ultrapasse a licença é bloqueada.
CREATE OR REPLACE FUNCTION public.enforce_company_license()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _company uuid; _users integer; _consultants integer; _max_u integer; _max_c integer;
BEGIN
  IF TG_TABLE_NAME = 'user_roles' THEN
    _company := COALESCE(NEW.company_id, (SELECT company_id FROM public.profiles WHERE id = NEW.user_id));
  ELSE
    _company := NEW.company_id;
  END IF;
  IF _company IS NULL THEN RETURN NEW; END IF;

  SELECT max_internal_users, max_consultants INTO _max_u, _max_c
    FROM public.companies WHERE id = _company;
  IF _max_u IS NULL THEN RETURN NEW; END IF;

  SELECT count(*) INTO _users
    FROM public.profiles p
   WHERE p.company_id = _company AND p.is_active
     AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id AND r.role = 'PLATFORM_ADMIN');

  SELECT count(DISTINCT p.id) INTO _consultants
    FROM public.profiles p
    JOIN public.user_roles r ON r.user_id = p.id AND r.role = 'CONSULTANT'
   WHERE p.company_id = _company AND p.is_active
     AND NOT EXISTS (SELECT 1 FROM public.user_roles pr WHERE pr.user_id = p.id AND pr.role = 'PLATFORM_ADMIN');

  IF _users > _max_u OR _consultants > _max_c THEN
    PERFORM public.raise_license_limit(_company);
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS enforce_license_on_roles ON public.user_roles;
CREATE CONSTRAINT TRIGGER enforce_license_on_roles
AFTER INSERT OR UPDATE ON public.user_roles
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW EXECUTE FUNCTION public.enforce_company_license();

DROP TRIGGER IF EXISTS enforce_license_on_profiles ON public.profiles;
CREATE CONSTRAINT TRIGGER enforce_license_on_profiles
AFTER INSERT OR UPDATE OF company_id, is_active ON public.profiles
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW EXECUTE FUNCTION public.enforce_company_license();

-- Somente a plataforma altera os limites da licença.
CREATE OR REPLACE FUNCTION public.platform_set_company_limits(_company_id uuid, _max_internal_users integer, _max_consultants integer)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'acesso restrito ao administrador da plataforma'; END IF;
  IF _max_internal_users < 1 OR _max_consultants < 0 THEN RAISE EXCEPTION 'limites inválidos'; END IF;
  IF _max_consultants > _max_internal_users THEN RAISE EXCEPTION 'consultores não podem exceder o total de usuários'; END IF;

  UPDATE public.companies
     SET max_internal_users = _max_internal_users,
         max_consultants = _max_consultants,
         updated_at = now()
   WHERE id = _company_id;

  INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (_company_id, auth.uid(), 'SET_COMPANY_LICENSE_LIMITS', 'company', _company_id,
          jsonb_build_object('max_internal_users', _max_internal_users, 'max_consultants', _max_consultants));
END; $$;

REVOKE ALL ON FUNCTION public.platform_set_company_limits(uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_set_company_limits(uuid, integer, integer) TO authenticated, service_role;

-- 2) Convites respeitam a licença antes mesmo de criar o link -----------------------
CREATE OR REPLACE FUNCTION public.create_invite_link(
  _role app_role DEFAULT 'CONSULTANT'::app_role,
  _email text DEFAULT NULL,
  _expires_hours integer DEFAULT 168,
  _company_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
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

  PERFORM public.assert_company_license(_company, _role, true);

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

CREATE OR REPLACE FUNCTION public.company_invite_member(_email text, _role app_role DEFAULT 'CONSULTANT'::app_role)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _company uuid := public.current_company_id(); _uid uuid; _invite uuid; _mail text := lower(btrim(coalesce(_email,'')));
BEGIN
  PERFORM public.assert_company_member(_company);
  IF NOT public.is_company_admin() THEN RAISE EXCEPTION 'somente administradores'; END IF;
  IF _mail = '' THEN RAISE EXCEPTION 'informe o e-mail'; END IF;
  IF _role = 'PLATFORM_ADMIN' THEN RAISE EXCEPTION 'papel inválido para empresa'; END IF;

  PERFORM public.assert_company_license(_company, _role, true);

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

-- 3) Rodízio: elegibilidade sem exigir instância própria do consultor ---------------
CREATE OR REPLACE FUNCTION public.queue_assign_next(_conversation_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _company uuid;
  _cfg public.queue_settings;
  _next uuid;
  _tried uuid[];
  _prev uuid;
BEGIN
  SELECT company_id, assigned_user_id INTO _company, _prev
    FROM public.conversations WHERE id = _conversation_id;
  IF _company IS NULL THEN RETURN NULL; END IF;

  IF auth.uid() IS NOT NULL
     AND NOT public.is_platform_admin()
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND company_id = _company) THEN
    RAISE EXCEPTION 'sem permissão para a fila desta empresa';
  END IF;

  INSERT INTO public.queue_settings (company_id) VALUES (_company)
  ON CONFLICT (company_id) DO NOTHING;
  SELECT * INTO _cfg FROM public.queue_settings WHERE company_id = _company;

  SELECT COALESCE(array_agg(DISTINCT consultant_id), '{}')
    INTO _tried
    FROM public.assignment_attempts
   WHERE conversation_id = _conversation_id
     AND consultant_id IS NOT NULL
     AND created_at > now() - interval '12 hours';

  UPDATE public.assignment_attempts
     SET status = 'CANCELLED', resolved_at = now()
   WHERE conversation_id = _conversation_id AND status = 'WAITING';

  WITH candidates AS (
    SELECT p.id,
           (SELECT count(*) FROM public.conversations c
             WHERE c.assigned_user_id = p.id
               AND c.status IN ('ASSIGNED','HUMAN_ACTIVE','WAITING_CUSTOMER')) AS load,
           GREATEST(
             1,
             CASE
               WHEN (p.metadata->>'max_concurrent') ~ '^[0-9]+$'
                 THEN (p.metadata->>'max_concurrent')::integer
               ELSE _cfg.max_concurrent_per_consultant
             END
           ) AS limite,
           (SELECT max(a.assigned_at) FROM public.assignment_attempts a
             WHERE a.consultant_id = p.id) AS last_offer,
           (p.id = ANY(_tried)) AS ja_tentado
      FROM public.profiles p
     WHERE p.company_id = _company
       AND p.is_active
       AND EXISTS (SELECT 1 FROM public.user_roles r
                    WHERE r.user_id = p.id AND r.company_id = _company
                      AND r.role IN ('CONSULTANT','ADMIN'))
       AND (NOT _cfg.only_online OR p.availability = 'ONLINE')
       -- Só precisa do WhatsApp pessoal cadastrado para receber o aviso.
       AND length(regexp_replace(COALESCE(p.phone,''), '[^0-9]', '', 'g')) >= 10
  )
  SELECT id INTO _next
    FROM candidates
   WHERE load < limite
   ORDER BY ja_tentado ASC,
            CASE WHEN _cfg.distribution_mode = 'LEAST_BUSY' THEN load ELSE 0 END ASC,
            last_offer ASC NULLS FIRST
   LIMIT 1;

  IF _next IS NULL THEN
    UPDATE public.conversations
       SET assigned_user_id = NULL,
           status = CASE WHEN status IN ('CLOSED','PAUSED') THEN status ELSE 'QUEUED'::conversation_status END
     WHERE id = _conversation_id;
    INSERT INTO public.conversation_events (company_id, conversation_id, event_type, metadata)
    VALUES (_company, _conversation_id, 'QUEUE_NO_CONSULTANT', '{}'::jsonb);
    RETURN NULL;
  END IF;

  INSERT INTO public.assignment_attempts
    (company_id, conversation_id, consultant_id, status, assigned_at, deadline_at)
  VALUES (_company, _conversation_id, _next, 'WAITING', now(),
          now() + make_interval(secs => GREATEST(_cfg.sla_seconds, 10)));

  UPDATE public.conversation_assignments SET status = 'RELEASED', ended_at = now()
   WHERE conversation_id = _conversation_id AND status = 'ACTIVE';

  INSERT INTO public.conversation_assignments
    (company_id, conversation_id, consultant_id, status, reason)
  VALUES (_company, _conversation_id, _next, 'ACTIVE', 'fila automática');

  UPDATE public.conversations
     SET assigned_user_id = _next,
         status = CASE WHEN status IN ('CLOSED','PAUSED') THEN status ELSE 'ASSIGNED'::conversation_status END
   WHERE id = _conversation_id;

  UPDATE public.queue_settings
     SET round_robin_position = round_robin_position + 1
   WHERE company_id = _company;

  INSERT INTO public.conversation_events (company_id, conversation_id, event_type, metadata)
  VALUES (_company, _conversation_id, 'QUEUE_OFFERED',
          jsonb_build_object('to', _next, 'from', _prev, 'sla_seconds', _cfg.sla_seconds));

  RETURN _next;
END; $$;

REVOKE ALL ON FUNCTION public.queue_assign_next(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.queue_assign_next(uuid) TO authenticated, service_role;

-- 4) Prazo padrão de 60 segundos para assumir --------------------------------------
ALTER TABLE public.queue_settings ALTER COLUMN sla_seconds SET DEFAULT 60;
