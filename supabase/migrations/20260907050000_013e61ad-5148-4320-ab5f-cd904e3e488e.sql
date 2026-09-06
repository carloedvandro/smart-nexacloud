-- ============================================================
-- Disparos: "Iniciar" não apaga mais o histórico nem reenvia
-- para quem já recebeu.
--
-- Antes: cada clique em "Iniciar" resetava TODAS as linhas da
-- campanha para PENDING (sent_at = null, provider_message_id = null),
-- apagando o histórico das rodadas anteriores e REENVIANDO a mensagem
-- para os mesmos contatos.
--
-- Agora:
--   • SENT/SKIPPED nunca são tocados — histórico preservado, sem spam.
--   • FAILED/CANCELLED voltam a PENDING (retry explícito ao Iniciar).
--   • PENDING/PROCESSING são reagendados com o conteúdo atual.
--   • Contatos removidos da campanha têm pendências canceladas.
-- Para reenviar a mesma mensagem a todos, use "Duplicar" e inicie a cópia.
-- ============================================================

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

  -- Contatos que saíram da campanha: pendências não podem mais ser enviadas.
  update public.broadcast_queue q
     set status = 'CANCELLED',
         error_message = 'Contato removido da campanha.',
         updated_at = now()
   where q.campaign_id = camp.id
     and q.status = 'PENDING'
     and not exists (
       select 1 from public.broadcast_campaign_contacts cc
        where cc.campaign_id = camp.id
          and cc.contact_id = q.contact_id
     );

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
        attempts = 0,
        error_message = null,
        updated_at = now()
    -- SENT/SKIPPED ficam intocados: histórico preservado, contato não recebe
    -- duplicata. FAILED/CANCELLED voltam a enviar (retry explícito).
    where public.broadcast_queue.status in ('PENDING', 'PROCESSING', 'CANCELLED', 'FAILED');

  get diagnostics inserted = row_count;
  return inserted;
end;
$$;
