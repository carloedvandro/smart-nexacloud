drop function if exists public.broadcast_finalize(uuid, boolean, text, text);

create or replace function public.broadcast_finalize(
  _queue_id uuid,
  _ok boolean,
  _provider_message_id text,
  _error text,
  _skip boolean default false
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  qrow record;
  camp record;
begin
  select * into qrow from public.broadcast_queue where id = _queue_id;
  if qrow is null then return; end if;

  if _ok then
    update public.broadcast_queue
      set status = 'SENT', sent_at = now(), provider_message_id = _provider_message_id, error_message = null
      where id = _queue_id;
    update public.broadcast_campaigns
      set consecutive_failures = 0, last_activity_at = now()
      where id = qrow.campaign_id;
    return;
  end if;

  if _skip then
    -- Problema do destinatário (número sem WhatsApp): não é falha de conexão,
    -- então não conta para a pausa automática da campanha.
    update public.broadcast_queue
      set status = 'SKIPPED', error_message = _error
      where id = _queue_id;
    update public.broadcast_campaigns
      set consecutive_failures = 0, last_activity_at = now()
      where id = qrow.campaign_id;
    return;
  end if;

  update public.broadcast_queue
    set status = 'FAILED', error_message = _error
    where id = _queue_id;
  update public.broadcast_campaigns
    set consecutive_failures = consecutive_failures + 1, last_activity_at = now()
    where id = qrow.campaign_id
    returning * into camp;

  if camp.consecutive_failures >= camp.max_consecutive_failures then
    update public.broadcast_campaigns
      set status = 'PAUSED',
          pause_reason = 'Campanha pausada automaticamente devido a uma sequência de falhas. Verifique a conexão e o status da instância antes de continuar.'
      where id = camp.id;
    insert into public.broadcast_logs (company_id, campaign_id, action, metadata)
    values (camp.company_id, camp.id, 'AUTO_PAUSED', jsonb_build_object('falhas', camp.consecutive_failures));
  end if;
end;
$$;

revoke all on function public.broadcast_finalize(uuid, boolean, text, text, boolean) from public, anon, authenticated;
grant execute on function public.broadcast_finalize(uuid, boolean, text, text, boolean) to service_role;