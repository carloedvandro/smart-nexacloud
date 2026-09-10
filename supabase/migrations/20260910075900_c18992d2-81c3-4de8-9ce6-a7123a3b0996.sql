CREATE OR REPLACE FUNCTION public.set_lead_stage(_lead_id uuid, _status lead_status)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _company uuid := public.lead_company_scope(_lead_id);
  _conversation uuid;
  _owner uuid;
  _next conversation_status;
BEGIN
  PERFORM public.set_lead_status(_lead_id, _status);

  SELECT id, assigned_user_id INTO _conversation, _owner
    FROM public.conversations
   WHERE lead_id = _lead_id AND company_id = _company AND status <> 'CLOSED'
   ORDER BY last_message_at DESC NULLS LAST, started_at DESC
   LIMIT 1;

  IF _conversation IS NULL AND _status IN ('AI_QUALIFYING','NEW','QUALIFIED') THEN
    SELECT id INTO _conversation
      FROM public.conversations
     WHERE lead_id = _lead_id AND company_id = _company
     ORDER BY last_message_at DESC NULLS LAST, started_at DESC
     LIMIT 1;
  END IF;

  IF _conversation IS NULL THEN RETURN; END IF;

  IF _status = 'AI_QUALIFYING' THEN
    PERFORM public.ai_resume_conversation(_conversation, 'lead movido para qualificação (IA)');
    RETURN;
  END IF;

  -- Mover para "Novo" ou "Qualificado" é ação deliberada do administrador:
  -- o pedido de atendimento humano em aberto é encerrado para o card não
  -- voltar sozinho a "Aguardando consultor" no esfriamento da fila.
  IF _status IN ('NEW','QUALIFIED') THEN
    UPDATE public.assignment_attempts
       SET status = 'CANCELLED', resolved_at = now()
     WHERE conversation_id = _conversation AND status IN ('WAITING','TIMEOUT');
    INSERT INTO public.conversation_events (company_id, conversation_id, event_type, metadata)
    VALUES (_company, _conversation, 'AI_RESUMED', jsonb_build_object('reason', 'lead movido no kanban'));
    RETURN;
  END IF;

  _next := CASE _status
    WHEN 'IN_SERVICE' THEN CASE WHEN _owner IS NULL THEN 'WAITING_HUMAN'::conversation_status
                                ELSE 'HUMAN_ACTIVE'::conversation_status END
    WHEN 'WAITING_CUSTOMER' THEN 'WAITING_CUSTOMER'::conversation_status
    WHEN 'WAITING_HUMAN' THEN 'WAITING_HUMAN'::conversation_status
    WHEN 'WON' THEN 'CLOSED'::conversation_status
    WHEN 'LOST' THEN 'CLOSED'::conversation_status
    WHEN 'ARCHIVED' THEN 'CLOSED'::conversation_status
    ELSE NULL END;

  IF _next IS NULL THEN RETURN; END IF;

  UPDATE public.conversations
     SET status = _next,
         closed_at = CASE WHEN _next = 'CLOSED' THEN now() ELSE NULL END
   WHERE id = _conversation;

  IF _next = 'CLOSED' THEN
    UPDATE public.conversation_assignments SET status = 'CLOSED', ended_at = now()
     WHERE conversation_id = _conversation AND status = 'ACTIVE';
    UPDATE public.assignment_attempts SET status = 'CANCELLED', resolved_at = now()
     WHERE conversation_id = _conversation AND status = 'WAITING';
  END IF;
END; $$;

REVOKE ALL ON FUNCTION public.set_lead_stage(uuid, lead_status) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_lead_stage(uuid, lead_status) TO authenticated, service_role;