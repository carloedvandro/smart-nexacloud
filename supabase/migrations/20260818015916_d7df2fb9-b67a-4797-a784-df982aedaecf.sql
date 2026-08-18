-- Interrompe imediatamente ofertas repetidas que ainda estejam aguardando.
WITH ranked_waiting AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY conversation_id, consultant_id
           ORDER BY assigned_at ASC, id ASC
         ) AS occurrence
  FROM public.assignment_attempts
  WHERE status = 'WAITING'
)
UPDATE public.assignment_attempts a
SET status = 'CANCELLED', resolved_at = now()
FROM ranked_waiting r
WHERE a.id = r.id AND r.occurrence > 1;

-- Remove registros duplicados de notificação anteriores, preservando apenas o primeiro.
WITH duplicated_events AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY conversation_id, event_type, (metadata->>'attempt_id')
           ORDER BY created_at ASC, id ASC
         ) AS occurrence
  FROM public.conversation_events
  WHERE event_type IN ('CONSULTANT_NOTIFIED', 'CONSULTANT_TIMEOUT_NOTIFIED')
    AND metadata->>'attempt_id' IS NOT NULL
)
DELETE FROM public.conversation_events e
USING duplicated_events d
WHERE e.id = d.id AND d.occurrence > 1;

CREATE UNIQUE INDEX IF NOT EXISTS conversation_events_attempt_notification_unique
ON public.conversation_events (conversation_id, event_type, (metadata->>'attempt_id'))
WHERE event_type IN ('CONSULTANT_NOTIFIED', 'CONSULTANT_TIMEOUT_NOTIFIED')
  AND metadata->>'attempt_id' IS NOT NULL;

CREATE OR REPLACE FUNCTION public.queue_assign_next(_conversation_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _company uuid;
  _cfg public.queue_settings;
  _next uuid;
  _tried uuid[];
  _prev uuid;
  _already_queued boolean;
BEGIN
  SELECT company_id, assigned_user_id, status = 'QUEUED'
    INTO _company, _prev, _already_queued
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
             WHERE a.consultant_id = p.id) AS last_offer
      FROM public.profiles p
     WHERE p.company_id = _company
       AND p.is_active
       AND NOT (p.id = ANY(_tried))
       AND EXISTS (SELECT 1 FROM public.user_roles r
                    WHERE r.user_id = p.id AND r.company_id = _company
                      AND r.role IN ('CONSULTANT','ADMIN'))
       AND (
         NOT _cfg.only_online
         OR p.availability = 'ONLINE'
         OR EXISTS (
           SELECT 1 FROM public.whatsapp_connections w
            WHERE w.company_id = _company
              AND w.user_id = p.id
              AND w.status = 'CONNECTED'
              AND NOT w.is_trunk
              AND w.phone_number IS NOT NULL
         )
       )
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
           status = CASE WHEN status IN ('CLOSED','PAUSED') THEN status ELSE 'QUEUED'::conversation_status END
     WHERE id = _conversation_id;
    IF NOT _already_queued THEN
      INSERT INTO public.conversation_events (company_id, conversation_id, event_type, metadata)
      VALUES (_company, _conversation_id, 'QUEUE_NO_CONSULTANT', jsonb_build_object('reason', 'all_consultants_already_tried'));
    END IF;
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