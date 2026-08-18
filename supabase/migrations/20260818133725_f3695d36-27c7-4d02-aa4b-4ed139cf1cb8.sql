-- Interrompe ofertas abertas destinadas ao próprio telefone tronco.
UPDATE public.assignment_attempts a
SET status = 'CANCELLED', resolved_at = now()
FROM public.profiles p, public.whatsapp_connections w
WHERE a.consultant_id = p.id
  AND w.company_id = a.company_id
  AND w.is_trunk = true
  AND a.status IN ('WAITING', 'TIMEOUT')
  AND public.normalize_phone(p.phone) IS NOT NULL
  AND public.normalize_phone(p.phone) = public.normalize_phone(w.phone_number);

UPDATE public.conversation_assignments ca
SET status = 'RELEASED', ended_at = now(), reason = 'telefone do consultor coincide com o tronco'
FROM public.profiles p, public.whatsapp_connections w
WHERE ca.consultant_id = p.id
  AND w.company_id = ca.company_id
  AND w.is_trunk = true
  AND ca.status = 'ACTIVE'
  AND public.normalize_phone(p.phone) IS NOT NULL
  AND public.normalize_phone(p.phone) = public.normalize_phone(w.phone_number);

UPDATE public.conversations c
SET assigned_user_id = NULL,
    status = CASE WHEN c.status IN ('CLOSED','PAUSED') THEN c.status ELSE 'WAITING_HUMAN'::public.conversation_status END
FROM public.profiles p, public.whatsapp_connections w
WHERE c.assigned_user_id = p.id
  AND w.company_id = c.company_id
  AND w.is_trunk = true
  AND public.normalize_phone(p.phone) IS NOT NULL
  AND public.normalize_phone(p.phone) = public.normalize_phone(w.phone_number);

CREATE OR REPLACE FUNCTION public.queue_assign_next(_conversation_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _company uuid;
  _cfg public.queue_settings;
  _next uuid;
  _tried uuid[];
  _prev uuid;
  _trunk_phone text;
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

  SELECT public.normalize_phone(w.phone_number)
    INTO _trunk_phone
    FROM public.whatsapp_connections w
   WHERE w.company_id = _company AND w.is_trunk = true
   LIMIT 1;

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
             WHERE a.consultant_id = p.id) AS last_offer
      FROM public.profiles p
     WHERE p.company_id = _company
       AND p.is_active
       AND EXISTS (SELECT 1 FROM public.user_roles r
                    WHERE r.user_id = p.id AND r.company_id = _company
                      AND r.role IN ('CONSULTANT','ADMIN'))
       AND (NOT _cfg.only_online OR p.availability = 'ONLINE')
       AND public.normalize_phone(p.phone) IS NOT NULL
       AND (_trunk_phone IS NULL OR public.normalize_phone(p.phone) <> _trunk_phone)
       AND NOT (p.id = ANY(_tried))
  )
  SELECT id INTO _next
    FROM candidates
   WHERE load < limite
   ORDER BY CASE WHEN _cfg.distribution_mode = 'LEAST_BUSY' THEN load ELSE 0 END ASC,
            last_offer ASC NULLS FIRST
   LIMIT 1;

  IF _next IS NULL THEN
    UPDATE public.conversations
       SET assigned_user_id = NULL,
           status = CASE WHEN status IN ('CLOSED','PAUSED') THEN status ELSE 'WAITING_HUMAN'::public.conversation_status END
     WHERE id = _conversation_id;
    UPDATE public.conversation_assignments
       SET status = 'RELEASED', ended_at = now(), reason = COALESCE(reason, 'sem outro consultor elegível')
     WHERE conversation_id = _conversation_id AND status = 'ACTIVE';
    INSERT INTO public.conversation_events (company_id, conversation_id, event_type, metadata)
    VALUES (_company, _conversation_id, 'QUEUE_NO_CONSULTANT', jsonb_build_object('tried', COALESCE(array_length(_tried, 1), 0)));
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
         status = CASE WHEN status IN ('CLOSED','PAUSED') THEN status ELSE 'ASSIGNED'::public.conversation_status END
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