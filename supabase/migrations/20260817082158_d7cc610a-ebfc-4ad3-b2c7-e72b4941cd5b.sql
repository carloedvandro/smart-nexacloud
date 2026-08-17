create extension if not exists pg_cron with schema extensions;

do $$
begin
  perform cron.unschedule('nexa-queue-tick');
exception when others then null;
end $$;

select cron.schedule('nexa-queue-tick', '30 seconds', $$select public.queue_tick();$$);