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

  FOR _rec IN
    SELECT c.id AS conversation_id
      FROM public.conversations c
     WHERE c.status = 'QUEUED'
       AND c.assigned_user_id IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.assignment_attempts a
          WHERE a.conversation_id = c.id AND a.status = 'WAITING'
       )
     ORDER BY c.last_message_at ASC NULLS FIRST
     LIMIT 50
  LOOP
    PERFORM public.queue_assign_next(_rec.conversation_id);
    _count := _count + 1;
  END LOOP;

  RETURN _count;
END; $$;

REVOKE ALL ON FUNCTION public.queue_tick() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.queue_tick() TO authenticated, service_role;