-- ============================================================
-- Sincroniza o status do LEAD com as transições da conversa.
--
-- Problema: quando o rodízio esgotava e a IA retomava o
-- atendimento, a conversa voltava para AI_ACTIVE mas o lead
-- continuava em WAITING_HUMAN — o Kanban mostrava "Aguardando
-- consultor" enquanto a IA (Ana) atendia ativamente. O mesmo
-- acontecia quando o consultor respondia: a conversa virava
-- HUMAN_ACTIVE mas o lead não ia para IN_SERVICE.
-- ============================================================

CREATE OR REPLACE FUNCTION public.ai_resume_conversation(_conversation_id uuid, _reason text DEFAULT 'retomada manual')
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _company uuid;
  _status conversation_status;
  _lead uuid;
  _automatic_loop_block boolean := false;
BEGIN
  SELECT company_id, status, lead_id INTO _company, _status, _lead
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

    -- Bloqueio anti-loop mantido: o lead aguarda humano (não volta à IA).
    IF _lead IS NOT NULL THEN
      UPDATE public.leads
         SET status = 'WAITING_HUMAN'::lead_status
       WHERE id = _lead
         AND company_id = _company
         AND status = 'AI_QUALIFYING';
    END IF;
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

  -- A IA voltou a atender: o Kanban precisa refletir isso no lead.
  IF _lead IS NOT NULL THEN
    UPDATE public.leads
       SET status = 'AI_QUALIFYING'::lead_status
     WHERE id = _lead
       AND company_id = _company
       AND status IN ('NEW','WAITING_HUMAN','WAITING_CUSTOMER','IN_SERVICE');
  END IF;

  INSERT INTO public.conversation_events (company_id, conversation_id, event_type, metadata)
  VALUES (_company, _conversation_id, 'AI_RESUMED', jsonb_build_object('reason', _reason));
END; $$;

REVOKE ALL ON FUNCTION public.ai_resume_conversation(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_resume_conversation(uuid, text) TO authenticated, service_role;

-- Consultor respondeu: encerra o rodízio desta conversa.
CREATE OR REPLACE FUNCTION public.queue_register_response(_conversation_id uuid, _user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _company uuid;
  _lead uuid;
BEGIN
  SELECT company_id, lead_id INTO _company, _lead
    FROM public.conversations WHERE id = _conversation_id;
  IF _company IS NULL THEN RETURN; END IF;

  UPDATE public.assignment_attempts
     SET status = 'RESPONDED', responded_at = now(), resolved_at = now()
   WHERE conversation_id = _conversation_id AND status = 'WAITING'
     AND (consultant_id = _user_id OR _user_id IS NULL);

  UPDATE public.conversations
     SET assigned_user_id = COALESCE(assigned_user_id, _user_id),
         status = CASE WHEN status IN ('CLOSED','PAUSED') THEN status ELSE 'HUMAN_ACTIVE'::conversation_status END
   WHERE id = _conversation_id;

  -- O humano assumiu de fato: o lead entra em atendimento no funil.
  IF _lead IS NOT NULL THEN
    UPDATE public.leads
       SET status = 'IN_SERVICE'::lead_status
     WHERE id = _lead
       AND company_id = _company
       AND status IN ('NEW','AI_QUALIFYING','QUALIFIED','WAITING_HUMAN','WAITING_CUSTOMER');
  END IF;

  INSERT INTO public.conversation_events (company_id, conversation_id, event_type, actor_id, metadata)
  VALUES (_company, _conversation_id, 'QUEUE_RESPONDED', _user_id, '{}'::jsonb);
END; $$;

REVOKE ALL ON FUNCTION public.queue_register_response(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.queue_register_response(uuid, uuid) TO authenticated, service_role;
