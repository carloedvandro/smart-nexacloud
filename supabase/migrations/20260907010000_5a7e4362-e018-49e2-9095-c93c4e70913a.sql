-- ============================================================
-- Aviso de retomada da IA: no máximo UMA mensagem por evento
-- AI_RESUMED, mesmo com ticks da fila rodando em paralelo.
--
-- A "reserva" feita em resume.server.ts (insert de AI_RESUME_NOTIFIED)
-- não tinha garantia no banco: dois ticks concorrentes passavam pela
-- checagem e ambos enviavam a mesma mensagem ao cliente.
-- ============================================================

-- Remove duplicatas já existentes antes de criar o índice único.
DELETE FROM public.conversation_events e
 USING public.conversation_events d
 WHERE e.event_type = 'AI_RESUME_NOTIFIED'
   AND d.event_type = 'AI_RESUME_NOTIFIED'
   AND e.conversation_id = d.conversation_id
   AND COALESCE(e.metadata->>'resume_event_id', '') = COALESCE(d.metadata->>'resume_event_id', '')
   AND e.id > d.id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_conv_events_resume_notified
  ON public.conversation_events (conversation_id, (metadata->>'resume_event_id'))
  WHERE event_type = 'AI_RESUME_NOTIFIED';
