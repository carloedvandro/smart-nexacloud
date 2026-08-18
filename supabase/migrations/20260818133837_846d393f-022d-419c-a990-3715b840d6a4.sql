DO $$
DECLARE _rec record;
BEGIN
  FOR _rec IN
    SELECT DISTINCT c.id
      FROM public.conversations c
      JOIN public.assignment_attempts a ON a.conversation_id = c.id
      JOIN public.profiles p ON p.id = a.consultant_id
      JOIN public.whatsapp_connections w ON w.company_id = c.company_id AND w.is_trunk = true
     WHERE a.status = 'CANCELLED'
       AND a.resolved_at >= now() - interval '10 minutes'
       AND COALESCE(c.last_message_at, c.started_at, c.created_at) >= now() - interval '15 minutes'
       AND public.normalize_phone(p.phone) IS NOT NULL
       AND public.normalize_phone(p.phone) = public.normalize_phone(w.phone_number)
       AND c.status NOT IN ('CLOSED', 'PAUSED', 'HUMAN_ACTIVE')
  LOOP
    PERFORM public.queue_assign_next(_rec.id);
  END LOOP;
END $$;