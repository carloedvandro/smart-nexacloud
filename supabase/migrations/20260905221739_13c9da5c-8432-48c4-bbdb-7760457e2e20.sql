-- lovable-cron-fallback-reviewed: 2880 runs/day; o controle de velocidade (mensagens por minuto e intervalo mínimo entre envios) exige verificação da fila a cada 30s; cadências maiores quebrariam o ritmo prometido ao administrador.
select cron.unschedule('nexa-broadcast-tick')
where exists (select 1 from cron.job where jobname = 'nexa-broadcast-tick');

select cron.schedule(
  'nexa-broadcast-tick',
  '30 seconds',
  $$select net.http_post(
      url := 'https://nexaatende.yrwentechnology.com.br/api/public/broadcast/tick',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := '{}'::jsonb,
      timeout_milliseconds := 300000
    );$$
);