-- Interrompe imediatamente o lote retroativo que está notificando consultores.
UPDATE public.assignment_attempts a
SET status = 'CANCELLED', resolved_at = now()
FROM public.conversations c
WHERE c.id = a.conversation_id
  AND a.status IN ('WAITING', 'TIMEOUT')
  AND COALESCE(c.last_message_at, c.started_at, c.created_at) < now() - interval '15 minutes';

UPDATE public.conversation_assignments ca
SET status = 'RELEASED', ended_at = now(), reason = COALESCE(ca.reason, 'fila retroativa cancelada')
FROM public.conversations c
WHERE c.id = ca.conversation_id
  AND ca.status = 'ACTIVE'
  AND c.status IN ('ASSIGNED', 'QUEUED', 'WAITING_HUMAN')
  AND COALESCE(c.last_message_at, c.started_at, c.created_at) < now() - interval '15 minutes';

UPDATE public.conversations
SET assigned_user_id = NULL,
    status = 'WAITING_HUMAN'
WHERE status IN ('ASSIGNED', 'QUEUED')
  AND COALESCE(last_message_at, started_at, created_at) < now() - interval '15 minutes'
  AND NOT EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.conversation_id = conversations.id
      AND m.sender_type IN ('consultant', 'admin')
  );

CREATE OR REPLACE FUNCTION public.queue_tick()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _rec record; _count integer := 0;
BEGIN
  -- Expira e repassa somente ofertas ligadas a uma interação recente do lead.
  FOR _rec IN
    SELECT a.*
      FROM public.assignment_attempts a
      JOIN public.conversations c ON c.id = a.conversation_id
     WHERE a.status = 'WAITING'
       AND a.deadline_at < now()
       AND c.status NOT IN ('CLOSED','HUMAN_ACTIVE','PAUSED')
       AND COALESCE(c.last_message_at, c.started_at, c.created_at) >= now() - interval '15 minutes'
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

  -- Nunca varre o estoque histórico de QUEUED. Só processa uma entrada explícita
  -- e recente na fila, vinculada a uma mensagem também recente.
  FOR _rec IN
    SELECT c.id AS conversation_id
      FROM public.conversations c
     WHERE c.status = 'QUEUED'
       AND c.assigned_user_id IS NULL
       AND COALESCE(c.last_message_at, c.started_at, c.created_at) >= now() - interval '15 minutes'
       AND EXISTS (
         SELECT 1
           FROM public.conversation_events e
          WHERE e.conversation_id = c.id
            AND e.event_type = 'QUEUE_ENTERED'
            AND e.created_at >= now() - interval '15 minutes'
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.assignment_attempts a
          WHERE a.conversation_id = c.id AND a.status = 'WAITING'
       )
     ORDER BY c.last_message_at ASC NULLS LAST
     LIMIT 50
  LOOP
    PERFORM public.queue_assign_next(_rec.conversation_id);
    _count := _count + 1;
  END LOOP;

  -- Limpeza silenciosa: qualquer oferta que envelheceu sem interação nova deixa
  -- de participar do rodízio e não gera aviso de timeout.
  UPDATE public.assignment_attempts a
     SET status = 'CANCELLED', resolved_at = now()
    FROM public.conversations c
   WHERE c.id = a.conversation_id
     AND a.status = 'WAITING'
     AND COALESCE(c.last_message_at, c.started_at, c.created_at) < now() - interval '15 minutes';

  RETURN _count;
END; $$;

REVOKE ALL ON FUNCTION public.queue_tick() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.queue_tick() TO authenticated, service_role;