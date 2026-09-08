-- lovable-cron-fallback-reviewed: 8640 runs/day; verificação leve (só escoa a fila de eventos do WhatsApp quando há algo pendente) para que a mensagem do cliente apareça no painel em segundos, sem esperar o ciclo de 30s.
select cron.unschedule('nexa-whatsapp-tick')
where exists (select 1 from cron.job where jobname = 'nexa-whatsapp-tick');

select cron.schedule(
  'nexa-whatsapp-tick',
  '10 seconds',
  $$select net.http_post(
      url := 'https://nexaatende.yrwentechnology.com.br/api/public/queue/tick?scope=whatsapp',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := '{"scope":"whatsapp"}'::jsonb,
      timeout_milliseconds := 120000
    );$$
);