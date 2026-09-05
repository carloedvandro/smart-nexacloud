-- ============================================================
-- MÓDULO DISPAROS — incremental, sem alterar o atendimento atual
-- ============================================================

-- 1. Tipo de conexão: TRONCO (atendimento) x DISPARO (campanhas)
do $$ begin
  create type public.whatsapp_connection_type as enum ('TRUNK', 'BROADCAST');
exception when duplicate_object then null; end $$;

alter table public.whatsapp_connections
  add column if not exists connection_type public.whatsapp_connection_type not null default 'TRUNK';

create or replace function public.enforce_connection_type()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.is_trunk and new.connection_type = 'BROADCAST' then
    raise exception 'A instância tronco é de uso exclusivo do atendimento e não pode ser usada em disparos.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_connection_type on public.whatsapp_connections;
create trigger trg_enforce_connection_type
before insert or update on public.whatsapp_connections
for each row execute function public.enforce_connection_type();

-- 2. Enums do módulo
do $$ begin
  create type public.broadcast_contact_status as enum ('ATIVO', 'PAUSADO', 'BLOQUEADO', 'DESCADASTRADO');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.broadcast_campaign_status as enum ('DRAFT', 'SCHEDULED', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED', 'ERROR');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.broadcast_queue_status as enum ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'SKIPPED', 'CANCELLED');
exception when duplicate_object then null; end $$;

-- 3. Configurações de proteção de envio (uma linha por empresa)
create table if not exists public.broadcast_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique references public.companies(id) on delete cascade,
  messages_per_minute integer not null default 5,
  min_interval_seconds integer not null default 10,
  max_interval_seconds integer not null default 25,
  hourly_limit integer not null default 120,
  daily_limit integer not null default 200,
  window_start time not null default '08:00',
  window_end time not null default '20:00',
  timezone text not null default 'America/Sao_Paulo',
  max_consecutive_failures integer not null default 5,
  auto_resume boolean not null default true,
  emergency_stop boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.broadcast_settings to authenticated;
grant all on public.broadcast_settings to service_role;
alter table public.broadcast_settings enable row level security;
create policy "disparos_settings_admin" on public.broadcast_settings for all to authenticated
  using ((company_id = public.current_company_id() and public.is_company_admin()) or public.is_platform_admin())
  with check ((company_id = public.current_company_id() and public.is_company_admin()) or public.is_platform_admin());

-- 4. Contatos de disparo
create table if not exists public.broadcast_contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text,
  phone text,
  whatsapp text not null,
  company_name text,
  tags text[] not null default '{}',
  source text,
  note text,
  status public.broadcast_contact_status not null default 'ATIVO',
  opt_in boolean not null default false,
  opt_in_source text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, whatsapp)
);
create index if not exists idx_broadcast_contacts_company on public.broadcast_contacts(company_id, status);
grant select, insert, update, delete on public.broadcast_contacts to authenticated;
grant all on public.broadcast_contacts to service_role;
alter table public.broadcast_contacts enable row level security;
create policy "disparos_contacts_admin" on public.broadcast_contacts for all to authenticated
  using ((company_id = public.current_company_id() and public.is_company_admin()) or public.is_platform_admin())
  with check ((company_id = public.current_company_id() and public.is_company_admin()) or public.is_platform_admin());

-- 5. Modelos de mensagem
create table if not exists public.broadcast_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  content text not null,
  status public.content_status not null default 'ACTIVE',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_broadcast_messages_company on public.broadcast_messages(company_id, status);
grant select, insert, update, delete on public.broadcast_messages to authenticated;
grant all on public.broadcast_messages to service_role;
alter table public.broadcast_messages enable row level security;
create policy "disparos_messages_admin" on public.broadcast_messages for all to authenticated
  using ((company_id = public.current_company_id() and public.is_company_admin()) or public.is_platform_admin())
  with check ((company_id = public.current_company_id() and public.is_company_admin()) or public.is_platform_admin());

-- 6. Campanhas
create table if not exists public.broadcast_campaigns (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  instance_id uuid references public.whatsapp_connections(id) on delete restrict,
  message_id uuid references public.broadcast_messages(id) on delete restrict,
  status public.broadcast_campaign_status not null default 'DRAFT',
  require_opt_in boolean not null default false,
  messages_per_minute integer not null default 5,
  min_interval_seconds integer not null default 10,
  max_interval_seconds integer not null default 25,
  daily_limit integer not null default 200,
  campaign_limit integer,
  window_start time not null default '08:00',
  window_end time not null default '20:00',
  max_consecutive_failures integer not null default 5,
  consecutive_failures integer not null default 0,
  auto_resume boolean not null default true,
  scheduled_at timestamptz,
  next_send_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  last_activity_at timestamptz,
  pause_reason text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_broadcast_campaigns_company on public.broadcast_campaigns(company_id, status);
grant select, insert, update, delete on public.broadcast_campaigns to authenticated;
grant all on public.broadcast_campaigns to service_role;
alter table public.broadcast_campaigns enable row level security;
create policy "disparos_campaigns_admin" on public.broadcast_campaigns for all to authenticated
  using ((company_id = public.current_company_id() and public.is_company_admin()) or public.is_platform_admin())
  with check ((company_id = public.current_company_id() and public.is_company_admin()) or public.is_platform_admin());

-- Regra crítica: campanha nunca usa a instância tronco
create or replace function public.enforce_broadcast_instance()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  conn record;
begin
  if new.instance_id is null then
    if new.status in ('SCHEDULED', 'RUNNING') then
      raise exception 'Selecione uma instância de disparo antes de iniciar a campanha.';
    end if;
    return new;
  end if;

  select id, company_id, is_trunk, connection_type into conn
  from public.whatsapp_connections where id = new.instance_id;

  if conn is null then
    raise exception 'Instância inexistente.';
  end if;
  if conn.company_id <> new.company_id then
    raise exception 'A instância pertence a outra empresa.';
  end if;
  if conn.is_trunk or conn.connection_type <> 'BROADCAST' then
    raise exception 'Somente instâncias marcadas como Disparo podem ser usadas em campanhas. A instância tronco é exclusiva do atendimento.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_broadcast_instance on public.broadcast_campaigns;
create trigger trg_enforce_broadcast_instance
before insert or update on public.broadcast_campaigns
for each row execute function public.enforce_broadcast_instance();

-- 7. Contatos da campanha
create table if not exists public.broadcast_campaign_contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  campaign_id uuid not null references public.broadcast_campaigns(id) on delete cascade,
  contact_id uuid not null references public.broadcast_contacts(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (campaign_id, contact_id)
);
grant select, insert, update, delete on public.broadcast_campaign_contacts to authenticated;
grant all on public.broadcast_campaign_contacts to service_role;
alter table public.broadcast_campaign_contacts enable row level security;
create policy "disparos_campaign_contacts_admin" on public.broadcast_campaign_contacts for all to authenticated
  using ((company_id = public.current_company_id() and public.is_company_admin()) or public.is_platform_admin())
  with check ((company_id = public.current_company_id() and public.is_company_admin()) or public.is_platform_admin());

-- 8. Fila de envio
create table if not exists public.broadcast_queue (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  campaign_id uuid not null references public.broadcast_campaigns(id) on delete cascade,
  instance_id uuid references public.whatsapp_connections(id) on delete set null,
  contact_id uuid not null references public.broadcast_contacts(id) on delete cascade,
  message_id uuid references public.broadcast_messages(id) on delete set null,
  rendered_content text,
  status public.broadcast_queue_status not null default 'PENDING',
  scheduled_at timestamptz not null default now(),
  sent_at timestamptz,
  attempts integer not null default 0,
  error_message text,
  provider_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, contact_id)
);
create index if not exists idx_broadcast_queue_pending on public.broadcast_queue(campaign_id, status, scheduled_at);
create index if not exists idx_broadcast_queue_company_sent on public.broadcast_queue(company_id, sent_at);
grant select, insert, update, delete on public.broadcast_queue to authenticated;
grant all on public.broadcast_queue to service_role;
alter table public.broadcast_queue enable row level security;
create policy "disparos_queue_admin" on public.broadcast_queue for all to authenticated
  using ((company_id = public.current_company_id() and public.is_company_admin()) or public.is_platform_admin())
  with check ((company_id = public.current_company_id() and public.is_company_admin()) or public.is_platform_admin());

-- 9. Auditoria do módulo
create table if not exists public.broadcast_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  campaign_id uuid references public.broadcast_campaigns(id) on delete set null,
  user_id uuid references public.profiles(id) on delete set null,
  user_name text,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_broadcast_logs_company on public.broadcast_logs(company_id, created_at desc);
grant select, insert on public.broadcast_logs to authenticated;
grant all on public.broadcast_logs to service_role;
alter table public.broadcast_logs enable row level security;
create policy "disparos_logs_read" on public.broadcast_logs for select to authenticated
  using ((company_id = public.current_company_id() and public.is_company_admin()) or public.is_platform_admin());
create policy "disparos_logs_insert" on public.broadcast_logs for insert to authenticated
  with check ((company_id = public.current_company_id() and public.is_company_admin()) or public.is_platform_admin());

-- 10. updated_at
drop trigger if exists trg_broadcast_settings_updated on public.broadcast_settings;
create trigger trg_broadcast_settings_updated before update on public.broadcast_settings
for each row execute function public.set_updated_at();
drop trigger if exists trg_broadcast_contacts_updated on public.broadcast_contacts;
create trigger trg_broadcast_contacts_updated before update on public.broadcast_contacts
for each row execute function public.set_updated_at();
drop trigger if exists trg_broadcast_messages_updated on public.broadcast_messages;
create trigger trg_broadcast_messages_updated before update on public.broadcast_messages
for each row execute function public.set_updated_at();
drop trigger if exists trg_broadcast_campaigns_updated on public.broadcast_campaigns;
create trigger trg_broadcast_campaigns_updated before update on public.broadcast_campaigns
for each row execute function public.set_updated_at();
drop trigger if exists trg_broadcast_queue_updated on public.broadcast_queue;
create trigger trg_broadcast_queue_updated before update on public.broadcast_queue
for each row execute function public.set_updated_at();

-- 11. Preenche a fila ao iniciar a campanha
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
  on conflict (campaign_id, contact_id) do nothing;

  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

-- Renderização das variáveis seguras
create or replace function public.broadcast_render(_content text, _name text)
returns text
language sql
immutable
set search_path = public
as $$
  select replace(
           replace(coalesce(_content, ''), '{{nome}}', coalesce(nullif(trim(_name), ''), 'cliente')),
           '{{primeiro_nome}}',
           coalesce(nullif(split_part(trim(coalesce(_name, '')), ' ', 1), ''), 'cliente')
         );
$$;

-- 12. Worker: reserva o próximo envio respeitando todos os limites
create or replace function public.broadcast_claim_next(_limit integer default 5)
returns table (
  queue_id uuid,
  company_id uuid,
  campaign_id uuid,
  connection_id uuid,
  contact_id uuid,
  phone text,
  content text
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  camp record;
  qrow record;
  crow record;
  settings record;
  local_now timestamp;
  local_date date;
  sent_today integer;
  sent_hour integer;
  sent_total integer;
  wait_seconds integer;
  claimed integer := 0;
begin
  for camp in
    select * from public.broadcast_campaigns
    where status in ('RUNNING', 'SCHEDULED', 'PAUSED')
    order by coalesce(next_send_at, now()) asc
    limit 30
  loop
    select * into settings from public.broadcast_settings s where s.company_id = camp.company_id;

    if settings is not null and settings.emergency_stop then
      if camp.status = 'RUNNING' then
        update public.broadcast_campaigns set status = 'PAUSED',
          pause_reason = 'Parada de emergência acionada pelo administrador.' where id = camp.id;
      end if;
      continue;
    end if;

    local_now := (now() at time zone coalesce(settings.timezone, 'America/Sao_Paulo'));
    local_date := local_now::date;

    -- Agendada: entra em execução na hora marcada
    if camp.status = 'SCHEDULED' then
      if camp.scheduled_at is not null and camp.scheduled_at > now() then continue; end if;
      update public.broadcast_campaigns
        set status = 'RUNNING', started_at = coalesce(started_at, now()), pause_reason = null
        where id = camp.id;
      camp.status := 'RUNNING';
    end if;

    -- Pausada: só retoma sozinha quando a pausa foi por janela de horário
    if camp.status = 'PAUSED' then
      if not camp.auto_resume or camp.pause_reason is distinct from 'Fora da janela de envio permitida.' then
        continue;
      end if;
      if local_now::time < camp.window_start or local_now::time >= camp.window_end then continue; end if;
      update public.broadcast_campaigns set status = 'RUNNING', pause_reason = null where id = camp.id;
      camp.status := 'RUNNING';
    end if;

    -- Janela de horário permitida
    if local_now::time < camp.window_start or local_now::time >= camp.window_end then
      update public.broadcast_campaigns set status = 'PAUSED',
        pause_reason = 'Fora da janela de envio permitida.' where id = camp.id;
      continue;
    end if;

    -- Ritmo
    if camp.next_send_at is not null and camp.next_send_at > now() then continue; end if;

    -- Limites
    select count(*) into sent_today from public.broadcast_queue q
      where q.company_id = camp.company_id and q.status = 'SENT'
        and (q.sent_at at time zone coalesce(settings.timezone, 'America/Sao_Paulo'))::date = local_date;
    if sent_today >= least(camp.daily_limit, coalesce(settings.daily_limit, camp.daily_limit)) then
      continue;
    end if;

    select count(*) into sent_hour from public.broadcast_queue q
      where q.company_id = camp.company_id and q.status = 'SENT' and q.sent_at > now() - interval '1 hour';
    if settings is not null and sent_hour >= settings.hourly_limit then continue; end if;

    if camp.campaign_limit is not null then
      select count(*) into sent_total from public.broadcast_queue q
        where q.campaign_id = camp.id and q.status = 'SENT';
      if sent_total >= camp.campaign_limit then
        update public.broadcast_campaigns set status = 'COMPLETED', finished_at = now() where id = camp.id;
        continue;
      end if;
    end if;

    -- Instância precisa estar conectada e ser de disparo
    if not exists (
      select 1 from public.whatsapp_connections w
      where w.id = camp.instance_id and w.connection_type = 'BROADCAST'
        and w.is_trunk = false and w.status = 'CONNECTED'
    ) then
      update public.broadcast_campaigns set status = 'PAUSED',
        pause_reason = 'A instância de disparo não está conectada.' where id = camp.id;
      continue;
    end if;

    select * into qrow from public.broadcast_queue q
      where q.campaign_id = camp.id and q.status = 'PENDING' and q.scheduled_at <= now()
      order by q.created_at asc
      limit 1
      for update skip locked;

    if qrow is null then
      if not exists (
        select 1 from public.broadcast_queue q
        where q.campaign_id = camp.id and q.status in ('PENDING', 'PROCESSING')
      ) then
        update public.broadcast_campaigns
          set status = 'COMPLETED', finished_at = now(), last_activity_at = now()
          where id = camp.id;
      end if;
      continue;
    end if;

    select * into crow from public.broadcast_contacts c where c.id = qrow.contact_id;
    if crow is null or crow.status <> 'ATIVO' or (camp.require_opt_in and not crow.opt_in) then
      update public.broadcast_queue set status = 'SKIPPED',
        error_message = 'Contato indisponível ou sem consentimento.' where id = qrow.id;
      continue;
    end if;

    update public.broadcast_queue
      set status = 'PROCESSING', attempts = attempts + 1
      where id = qrow.id;

    wait_seconds := greatest(
      ceil(60.0 / greatest(camp.messages_per_minute, 1))::int,
      camp.min_interval_seconds
    );
    wait_seconds := wait_seconds + floor(random() * greatest(camp.max_interval_seconds - wait_seconds, 0))::int;

    update public.broadcast_campaigns
      set next_send_at = now() + make_interval(secs => wait_seconds), last_activity_at = now()
      where id = camp.id;

    queue_id := qrow.id;
    company_id := camp.company_id;
    campaign_id := camp.id;
    connection_id := camp.instance_id;
    contact_id := crow.id;
    phone := crow.whatsapp;
    content := coalesce(qrow.rendered_content, '');
    return next;

    claimed := claimed + 1;
    if claimed >= _limit then return; end if;
  end loop;
  return;
end;
$$;

-- 13. Worker: registra o resultado do envio
create or replace function public.broadcast_finalize(
  _queue_id uuid,
  _ok boolean,
  _provider_message_id text default null,
  _error text default null
)
returns void
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
  select * into camp from public.broadcast_campaigns where id = qrow.campaign_id;

  if _ok then
    update public.broadcast_queue
      set status = 'SENT', sent_at = now(), provider_message_id = _provider_message_id, error_message = null
      where id = _queue_id;
    update public.broadcast_campaigns
      set consecutive_failures = 0, last_activity_at = now()
      where id = qrow.campaign_id;
  else
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
  end if;
end;
$$;

-- 14. Parada de emergência
create or replace function public.broadcast_emergency_stop()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  cid uuid := public.current_company_id();
  cancelled integer := 0;
begin
  if not public.is_company_admin() then
    raise exception 'Somente administradores podem parar os disparos.';
  end if;

  update public.broadcast_queue set status = 'CANCELLED', error_message = 'Parada de emergência.'
    where company_id = cid and status in ('PENDING', 'PROCESSING');
  get diagnostics cancelled = row_count;

  update public.broadcast_campaigns
    set status = 'PAUSED', pause_reason = 'Disparos interrompidos pelo administrador (parada de emergência).'
    where company_id = cid and status in ('RUNNING', 'SCHEDULED');

  insert into public.broadcast_settings (company_id, emergency_stop) values (cid, true)
  on conflict (company_id) do update set emergency_stop = true, updated_at = now();

  insert into public.broadcast_logs (company_id, user_id, action, metadata)
  values (cid, auth.uid(), 'EMERGENCY_STOP', jsonb_build_object('canceladas', cancelled));

  return cancelled;
end;
$$;

grant execute on function public.broadcast_emergency_stop() to authenticated;
grant execute on function public.broadcast_enqueue_campaign(uuid) to authenticated;
grant execute on function public.broadcast_render(text, text) to authenticated;

-- 15. Tempo real
alter table public.broadcast_campaigns replica identity full;
alter table public.broadcast_queue replica identity full;
alter table public.broadcast_contacts replica identity full;

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'broadcast_campaigns'
  ) then
    alter publication supabase_realtime add table public.broadcast_campaigns;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'broadcast_queue'
  ) then
    alter publication supabase_realtime add table public.broadcast_queue;
  end if;
end $$;