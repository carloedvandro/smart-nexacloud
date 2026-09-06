-- ============================================================
-- Remove as assinaturas ANTIGAS das RPCs de ingestão.
--
-- A migração 20260902120000 adicionou o parâmetro _real_phone via
-- CREATE OR REPLACE, mas assinatura diferente cria uma NOVA função em
-- vez de substituir. Ficaram duas versões de cada; quando a chamada não
-- envia _real_phone o Postgres não consegue escolher:
--   "Could not choose the best candidate function between ..."
-- e o evento falha. Só a versão com _real_phone (DEFAULT NULL) deve
-- existir — ela atende às duas formas de chamada.
-- ============================================================

DROP FUNCTION IF EXISTS public.ingest_inbound_message(
  uuid, text, text, text, public.message_type, text, text, text, jsonb);

DROP FUNCTION IF EXISTS public.ingest_outbound_echo(
  uuid, text, text, public.message_type, text, text, text, jsonb);

-- Verificação: deve sobrar exatamente UMA versão de cada.
DO $$
DECLARE _n integer;
BEGIN
  SELECT count(*) INTO _n FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'ingest_inbound_message';
  IF _n <> 1 THEN RAISE EXCEPTION 'ingest_inbound_message: esperava 1 versão, há %', _n; END IF;

  SELECT count(*) INTO _n FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'ingest_outbound_echo';
  IF _n <> 1 THEN RAISE EXCEPTION 'ingest_outbound_echo: esperava 1 versão, há %', _n; END IF;
END $$;

-- Reprocessa os eventos que falharam por causa da ambiguidade (ainda
-- dentro da janela de 5 min do worker serão processados; os demais são
-- marcados como expirados normalmente).
UPDATE public.whatsapp_events
   SET processed_at = NULL, processing_started_at = NULL, attempts = 0, error = NULL
 WHERE error LIKE 'Could not choose the best candidate function%'
   AND created_at > now() - interval '10 minutes';
