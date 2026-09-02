select cron.unschedule('nexa-queue-tick')
where exists (select 1 from cron.job where jobname = 'nexa-queue-tick');

select cron.schedule(
  'nexa-queue-tick',
  '30 seconds',
  $$select net.http_post(
      url := 'https://nexaatende.yrwentechnology.com.br/api/public/queue/tick',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := '{}'::jsonb,
      timeout_milliseconds := 300000
    );$$
);