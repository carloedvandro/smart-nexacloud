alter table public.whatsapp_events
  add column if not exists processing_started_at timestamptz,
  add column if not exists attempts integer not null default 0;

create index if not exists idx_whatsapp_events_pending
  on public.whatsapp_events (created_at)
  where processed_at is null;

create or replace function public.claim_whatsapp_events(_limit integer default 5)
returns table (
  id uuid,
  company_id uuid,
  connection_id uuid,
  payload jsonb,
  attempts integer
)
language sql
security definer
set search_path = public
as $$
  with candidates as (
    select event.id
    from public.whatsapp_events event
    where event.processed_at is null
      and event.attempts < 5
      and (
        event.processing_started_at is null
        or event.processing_started_at < now() - interval '10 minutes'
      )
    order by event.created_at
    for update skip locked
    limit greatest(1, least(coalesce(_limit, 5), 20))
  )
  update public.whatsapp_events event
  set processing_started_at = now(),
      attempts = event.attempts + 1,
      error = null
  from candidates
  where event.id = candidates.id
  returning event.id, event.company_id, event.connection_id, event.payload, event.attempts;
$$;

revoke all on function public.claim_whatsapp_events(integer) from public, anon, authenticated;
grant execute on function public.claim_whatsapp_events(integer) to service_role;