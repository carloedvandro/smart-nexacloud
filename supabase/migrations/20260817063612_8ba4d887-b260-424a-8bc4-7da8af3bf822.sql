
CREATE UNIQUE INDEX IF NOT EXISTS queue_settings_company_key ON public.queue_settings (company_id);
CREATE INDEX IF NOT EXISTS assignment_attempts_waiting_idx ON public.assignment_attempts (status, deadline_at);

-- Oferece a conversa ao próximo consultor elegível. Retorna o consultor escolhido (ou NULL).
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
           COALESCE((p.metadata->>'max_concurrent')::int, _cfg.max_concurrent_per_consultant) AS limite,
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

-- Coloca a conversa na fila (usado pela IA e pelo painel).
CREATE OR REPLACE FUNCTION public.enqueue_conversation(_conversation_id uuid, _reason text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _company uuid;
BEGIN
  SELECT company_id INTO _company FROM public.conversations WHERE id = _conversation_id;
  IF _company IS NULL THEN RETURN NULL; END IF;

  UPDATE public.conversations
     SET assigned_user_id = NULL,
         status = 'WAITING_HUMAN'
   WHERE id = _conversation_id AND status NOT IN ('CLOSED');

  INSERT INTO public.conversation_events (company_id, conversation_id, event_type, metadata)
  VALUES (_company, _conversation_id, 'QUEUE_ENTERED', jsonb_build_object('reason', _reason));

  RETURN public.queue_assign_next(_conversation_id);
END; $$;

-- Expira ofertas vencidas e repassa para o próximo consultor.
CREATE OR REPLACE FUNCTION public.queue_tick()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _rec record; _count integer := 0;
BEGIN
  FOR _rec IN
    SELECT a.* FROM public.assignment_attempts a
     JOIN public.conversations c ON c.id = a.conversation_id
     WHERE a.status = 'WAITING' AND a.deadline_at < now()
       AND c.status NOT IN ('CLOSED','HUMAN_ACTIVE')
     ORDER BY a.deadline_at ASC
     LIMIT 50
  LOOP
    UPDATE public.assignment_attempts
       SET status = 'TIMEOUT', resolved_at = now()
     WHERE id = _rec.id AND status = 'WAITING';

    INSERT INTO public.conversation_events (company_id, conversation_id, event_type, metadata)
    VALUES (_rec.company_id, _rec.conversation_id, 'QUEUE_TIMEOUT',
            jsonb_build_object('consultant', _rec.consultant_id));

    PERFORM public.queue_assign_next(_rec.conversation_id);
    _count := _count + 1;
  END LOOP;
  RETURN _count;
END; $$;

-- Consultor respondeu: encerra o rodízio desta conversa.
CREATE OR REPLACE FUNCTION public.queue_register_response(_conversation_id uuid, _user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _company uuid;
BEGIN
  SELECT company_id INTO _company FROM public.conversations WHERE id = _conversation_id;
  IF _company IS NULL THEN RETURN; END IF;

  UPDATE public.assignment_attempts
     SET status = 'RESPONDED', responded_at = now(), resolved_at = now()
   WHERE conversation_id = _conversation_id AND status = 'WAITING'
     AND (consultant_id = _user_id OR _user_id IS NULL);

  UPDATE public.conversations
     SET assigned_user_id = COALESCE(assigned_user_id, _user_id),
         status = CASE WHEN status IN ('CLOSED','PAUSED') THEN status ELSE 'HUMAN_ACTIVE'::conversation_status END
   WHERE id = _conversation_id;

  INSERT INTO public.conversation_events (company_id, conversation_id, event_type, actor_id, metadata)
  VALUES (_company, _conversation_id, 'QUEUE_RESPONDED', _user_id, '{}'::jsonb);
END; $$;

REVOKE ALL ON FUNCTION public.queue_assign_next(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.enqueue_conversation(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.queue_tick() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.queue_register_response(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.queue_assign_next(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_conversation(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.queue_tick() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.queue_register_response(uuid, uuid) TO authenticated, service_role;

-- Configuração de fila para empresas existentes (SLA de 60 segundos).
INSERT INTO public.queue_settings (company_id, sla_seconds)
SELECT c.id, 60 FROM public.companies c
ON CONFLICT (company_id) DO NOTHING;
