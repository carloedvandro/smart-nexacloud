CREATE OR REPLACE FUNCTION public.ai_resume_conversation(_conversation_id uuid, _reason text DEFAULT 'retomada manual')
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _company uuid;
  _status conversation_status;
  _automatic_loop_block boolean := false;
BEGIN
  SELECT company_id, status INTO _company, _status
    FROM public.conversations WHERE id = _conversation_id;
  IF _company IS NULL THEN RETURN; END IF;

  IF auth.uid() IS NOT NULL
     AND NOT public.is_platform_admin()
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND company_id = _company) THEN
    RAISE EXCEPTION 'sem permissão para esta conversa';
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM public.ai_sessions
     WHERE conversation_id = _conversation_id
       AND status = 'HANDOFF'
       AND lower(COALESCE(handoff_reason, '')) IN (
         'interlocutor automatizado (outra ia/robô)',
         'muitas respostas automáticas em poucos minutos',
         'limite de mensagens automáticas atingido'
       )
  ) INTO _automatic_loop_block;

  IF _automatic_loop_block AND lower(COALESCE(_reason, '')) LIKE '%rodízio esgotado%' THEN
    UPDATE public.conversations
       SET assigned_user_id = NULL,
           status = 'WAITING_HUMAN'::conversation_status
     WHERE id = _conversation_id;
    RETURN;
  END IF;

  UPDATE public.assignment_attempts
     SET status = 'CANCELLED', resolved_at = now()
   WHERE conversation_id = _conversation_id AND status IN ('WAITING', 'TIMEOUT');

  UPDATE public.conversation_assignments
     SET status = 'RELEASED', ended_at = now(), reason = COALESCE(reason, _reason)
   WHERE conversation_id = _conversation_id AND status = 'ACTIVE';

  UPDATE public.ai_sessions
     SET status = 'RESUMED', ended_at = COALESCE(ended_at, now())
   WHERE conversation_id = _conversation_id AND status = 'HANDOFF';

  UPDATE public.conversations
     SET assigned_user_id = NULL,
         status = CASE WHEN status = 'PAUSED' THEN status ELSE 'AI_ACTIVE'::conversation_status END,
         closed_at = NULL
   WHERE id = _conversation_id;

  INSERT INTO public.conversation_events (company_id, conversation_id, event_type, metadata)
  VALUES (_company, _conversation_id, 'AI_RESUMED', jsonb_build_object('reason', _reason));
END; $$;

REVOKE ALL ON FUNCTION public.ai_resume_conversation(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_resume_conversation(uuid, text) TO authenticated, service_role;