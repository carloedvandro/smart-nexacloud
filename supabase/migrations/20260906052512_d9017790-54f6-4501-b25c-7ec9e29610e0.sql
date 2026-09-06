create or replace function public.broadcast_enqueue_campaign(_campaign_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  camp record;
  inserted integer := 0;
begin
  select * into camp from public.broadcast_campaigns where id = _campaign_id;
  if camp is null then raise exception 'Campanha inexistente.'; end if;
  if camp.message_id is null then raise exception 'Selecione uma mensagem antes de iniciar.'; end if;

  insert into public.broadcast_queue (
    company_id, campaign_id, instance_id, contact_id, message_id, rendered_content, status, scheduled_at
  )
  select
    camp.company_id, camp.id, camp.instance_id, c.id, camp.message_id,
    public.broadcast_render(m.content, c.name),
    'PENDING', now()
  from public.broadcast_campaign_contacts cc
  join public.broadcast_contacts c on c.id = cc.contact_id
  join public.broadcast_messages m on m.id = camp.message_id
  where cc.campaign_id = camp.id
    and c.status = 'ATIVO'
    and (not camp.require_opt_in or c.opt_in)
  on conflict (campaign_id, contact_id) do update
    set instance_id = excluded.instance_id,
        message_id = excluded.message_id,
        rendered_content = excluded.rendered_content,
        status = 'PENDING',
        scheduled_at = now(),
        sent_at = null,
        attempts = 0,
        error_message = null,
        provider_message_id = null,
        updated_at = now()
    where public.broadcast_queue.status in ('SENT', 'FAILED', 'SKIPPED', 'CANCELLED')
       or public.broadcast_queue.status = 'PENDING';

  get diagnostics inserted = row_count;
  return inserted;
end;
$$;