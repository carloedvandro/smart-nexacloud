-- Empresa efetiva do lead (platform admin opera qualquer empresa)
CREATE OR REPLACE FUNCTION public.lead_company_scope(_lead_id uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _lead_company uuid; _mine uuid := public.current_company_id();
BEGIN
  SELECT company_id INTO _lead_company FROM public.leads WHERE id = _lead_id;
  IF _lead_company IS NULL THEN RAISE EXCEPTION 'lead inexistente'; END IF;
  IF public.is_platform_admin() THEN RETURN _lead_company; END IF;
  IF _lead_company <> _mine THEN RAISE EXCEPTION 'acesso negado'; END IF;
  RETURN _lead_company;
END; $$;

REVOKE ALL ON FUNCTION public.lead_company_scope(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.lead_company_scope(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.assign_lead(_lead_id uuid, _consultant_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _company uuid := public.lead_company_scope(_lead_id);
BEGIN
  PERFORM public.assert_company_member(_company);
  IF _consultant_id IS NOT NULL THEN
    PERFORM 1 FROM public.profiles WHERE id = _consultant_id AND company_id = _company;
    IF NOT FOUND THEN RAISE EXCEPTION 'consultor inválido'; END IF;
  END IF;
  UPDATE public.leads SET assigned_user_id = _consultant_id
   WHERE id = _lead_id AND company_id = _company;
  IF NOT FOUND THEN RAISE EXCEPTION 'lead inexistente'; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.set_lead_status(_lead_id uuid, _status lead_status)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _company uuid := public.lead_company_scope(_lead_id);
BEGIN
  PERFORM public.assert_company_member(_company);
  UPDATE public.leads
     SET status = _status,
         qualified_at = CASE WHEN _status = 'QUALIFIED' THEN COALESCE(qualified_at, now()) ELSE qualified_at END,
         closed_at = CASE WHEN _status IN ('WON','LOST','ARCHIVED') THEN now() ELSE NULL END
   WHERE id = _lead_id AND company_id = _company;
  IF NOT FOUND THEN RAISE EXCEPTION 'lead inexistente'; END IF;

  INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (_company, auth.uid(), 'UPDATE_LEAD', 'lead', _lead_id, jsonb_build_object('status', _status));
END; $$;

-- Atribuir responsável = colocar em atendimento, ponta a ponta
CREATE OR REPLACE FUNCTION public.assign_lead_and_service(_lead_id uuid, _consultant_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _company uuid := public.lead_company_scope(_lead_id);
  _conversation uuid;
  _prev uuid;
BEGIN
  PERFORM public.assert_company_member(_company);
  IF _consultant_id IS NOT NULL THEN
    PERFORM 1 FROM public.profiles WHERE id = _consultant_id AND company_id = _company;
    IF NOT FOUND THEN RAISE EXCEPTION 'consultor inválido'; END IF;
  END IF;

  UPDATE public.leads
     SET assigned_user_id = _consultant_id,
         status = CASE
           WHEN _consultant_id IS NOT NULL AND status NOT IN ('WON','LOST','ARCHIVED')
             THEN 'IN_SERVICE'::lead_status
           WHEN _consultant_id IS NULL AND status = 'IN_SERVICE'
             THEN 'WAITING_HUMAN'::lead_status
           ELSE status END
   WHERE id = _lead_id AND company_id = _company;
  IF NOT FOUND THEN RAISE EXCEPTION 'lead inexistente'; END IF;

  SELECT id, assigned_user_id INTO _conversation, _prev
    FROM public.conversations
   WHERE lead_id = _lead_id AND company_id = _company AND status <> 'CLOSED'
   ORDER BY last_message_at DESC NULLS LAST, started_at DESC
   LIMIT 1;

  IF _conversation IS NOT NULL THEN
    UPDATE public.conversations
       SET assigned_user_id = _consultant_id,
           status = CASE
             WHEN _consultant_id IS NULL THEN 'QUEUED'::conversation_status
             WHEN status IN ('AI_ACTIVE','WAITING_HUMAN','QUEUED','ASSIGNED')
               THEN 'ASSIGNED'::conversation_status
             ELSE status END
     WHERE id = _conversation;

    UPDATE public.conversation_assignments SET status = 'RELEASED', ended_at = now()
     WHERE conversation_id = _conversation AND status = 'ACTIVE';

    IF _consultant_id IS NOT NULL THEN
      INSERT INTO public.conversation_assignments (company_id, conversation_id, consultant_id, assigned_by, status)
      VALUES (_company, _conversation, _consultant_id, auth.uid(), 'ACTIVE');
    END IF;

    UPDATE public.assignment_attempts
       SET status = 'CANCELLED', resolved_at = now()
     WHERE conversation_id = _conversation AND status = 'WAITING';

    INSERT INTO public.conversation_events (company_id, conversation_id, event_type, actor_id, metadata)
    VALUES (_company, _conversation,
            CASE WHEN _prev IS NULL THEN 'ASSIGNED' ELSE 'TRANSFERRED' END,
            auth.uid(), jsonb_build_object('from', _prev, 'to', _consultant_id, 'origin', 'kanban'));
  END IF;

  INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (_company, auth.uid(), 'ASSIGN_CONVERSATION', 'lead', _lead_id,
          jsonb_build_object('to', _consultant_id, 'conversation', _conversation));

  RETURN _conversation;
END; $$;

REVOKE ALL ON FUNCTION public.assign_lead_and_service(uuid,uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.assign_lead_and_service(uuid,uuid) TO authenticated;

-- Mudança de etapa no funil reflete na conversa aberta
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
  IF _conversation IS NULL THEN RETURN; END IF;

  _next := CASE _status
    WHEN 'IN_SERVICE' THEN CASE WHEN _owner IS NULL THEN 'WAITING_HUMAN'::conversation_status
                                ELSE 'HUMAN_ACTIVE'::conversation_status END
    WHEN 'WAITING_CUSTOMER' THEN 'WAITING_CUSTOMER'::conversation_status
    WHEN 'WAITING_HUMAN' THEN 'WAITING_HUMAN'::conversation_status
    WHEN 'AI_QUALIFYING' THEN 'AI_ACTIVE'::conversation_status
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

  INSERT INTO public.conversation_events (company_id, conversation_id, event_type, actor_id, metadata)
  VALUES (_company, _conversation,
          CASE WHEN _next = 'CLOSED' THEN 'CONVERSATION_CLOSED' ELSE 'STATUS_CHANGED' END,
          auth.uid(), jsonb_build_object('status', _next, 'origin', 'kanban'));
END; $$;

REVOKE ALL ON FUNCTION public.set_lead_stage(uuid,lead_status) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.set_lead_stage(uuid,lead_status) TO authenticated;