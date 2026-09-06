-- ============================================================
-- Rodízio esgotado: o LEAD permanece "Aguardando consultor".
--
-- Quando todos os consultores foram acionados sem sucesso, a IA volta a
-- responder para o cliente não ficar sem resposta — mas o cliente PEDIU um
-- humano e ninguém assumiu. O administrador precisa ver isso no Kanban
-- (coluna "Aguardando consultor") para puxar o atendimento para si.
--
-- Regra:
--   • retomada por "rodízio esgotado"  → conversa AI_ACTIVE, lead WAITING_HUMAN
--   • retomada manual (arrastar p/ IA) → conversa AI_ACTIVE, lead AI_QUALIFYING
-- ============================================================

CREATE OR REPLACE FUNCTION public.ai_resume_conversation(_conversation_id uuid, _reason text DEFAULT 'retomada manual')
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _company uuid;
  _status conversation_status;
  _lead uuid;
  _automatic_loop_block boolean := false;
  _queue_exhausted boolean := lower(COALESCE(_reason, '')) LIKE '%rodízio esgotado%';
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

  IF _automatic_loop_block AND _queue_exhausted THEN
    UPDATE public.conversations
       SET assigned_user_id = NULL,
           status = 'WAITING_HUMAN'::conversation_status
     WHERE id = _conversation_id;

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

  IF _lead IS NOT NULL THEN
    IF _queue_exhausted THEN
      -- Ninguém assumiu: o pedido de humano continua em aberto no funil.
      UPDATE public.leads
         SET status = 'WAITING_HUMAN'::lead_status
       WHERE id = _lead
         AND company_id = _company
         AND status IN ('NEW','AI_QUALIFYING','WAITING_CUSTOMER');
    ELSE
      -- Devolução manual para a IA: o lead volta para a qualificação.
      UPDATE public.leads
         SET status = 'AI_QUALIFYING'::lead_status
       WHERE id = _lead
         AND company_id = _company
         AND status IN ('NEW','WAITING_HUMAN','WAITING_CUSTOMER','IN_SERVICE');
    END IF;
  END IF;

  INSERT INTO public.conversation_events (company_id, conversation_id, event_type, metadata)
  VALUES (_company, _conversation_id, 'AI_RESUMED', jsonb_build_object('reason', _reason));
END; $$;

REVOKE ALL ON FUNCTION public.ai_resume_conversation(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_resume_conversation(uuid, text) TO authenticated, service_role;

-- Corrige os leads que já estão nessa situação: conversa com a IA, mas com
-- rodízio esgotado recente e sem consultor — voltam para "Aguardando consultor".
UPDATE public.leads l
   SET status = 'WAITING_HUMAN'::lead_status
  FROM public.conversations c
 WHERE c.lead_id = l.id
   AND c.company_id = l.company_id
   AND c.status = 'AI_ACTIVE'
   AND c.assigned_user_id IS NULL
   AND l.status = 'AI_QUALIFYING'
   AND EXISTS (
     SELECT 1 FROM public.conversation_events e
      WHERE e.conversation_id = c.id
        AND e.event_type = 'QUEUE_NO_CONSULTANT'
        AND e.created_at > now() - interval '24 hours'
   )
   AND NOT EXISTS (
     SELECT 1 FROM public.conversation_events e
      WHERE e.conversation_id = c.id
        AND e.event_type = 'AI_RESUMED'
        AND lower(COALESCE(e.metadata->>'reason','')) NOT LIKE '%rodízio esgotado%'
        AND e.created_at > (
          SELECT max(x.created_at) FROM public.conversation_events x
           WHERE x.conversation_id = c.id AND x.event_type = 'QUEUE_NO_CONSULTANT'
        )
   );
