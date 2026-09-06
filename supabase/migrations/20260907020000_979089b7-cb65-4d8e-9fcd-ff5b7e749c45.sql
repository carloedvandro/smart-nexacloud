-- ============================================================
-- Processamento imediato dos eventos do WhatsApp.
--
-- Antes: o webhook só gravava o evento e a mensagem esperava o cron
-- da fila (a cada 30s, 12 eventos por vez). Com movimento, a fila
-- acumulava e mensagens com mais de 5 min eram descartadas como
-- "expiradas" — o cliente ficava sem resposta e o painel demorava.
--
-- Agora: ao inserir um evento, o banco dispara (assíncrono, via
-- pg_net) uma chamada ao worker só para eventos do WhatsApp. O cron
-- continua como rede de segurança para o que escapar.
-- O worker usa FOR UPDATE SKIP LOCKED, então chamadas concorrentes
-- não processam o mesmo evento duas vezes.
-- ============================================================

CREATE OR REPLACE FUNCTION public.kick_whatsapp_worker()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://nexaatende.yrwentechnology.com.br/api/public/queue/tick?scope=whatsapp',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := jsonb_build_object('scope', 'whatsapp', 'event_id', NEW.id),
    timeout_milliseconds := 120000
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Nunca bloqueia a gravação do webhook: o cron reprocessa depois.
  RAISE WARNING 'kick_whatsapp_worker falhou: %', SQLERRM;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_whatsapp_events_kick ON public.whatsapp_events;
CREATE TRIGGER trg_whatsapp_events_kick
AFTER INSERT ON public.whatsapp_events
FOR EACH ROW EXECUTE FUNCTION public.kick_whatsapp_worker();
