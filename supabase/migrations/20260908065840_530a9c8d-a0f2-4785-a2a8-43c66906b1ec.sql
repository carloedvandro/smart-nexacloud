create table if not exists public.broadcast_access (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  connection_id uuid not null references public.whatsapp_connections(id) on delete cascade,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, connection_id)
);

grant select, insert, update, delete on public.broadcast_access to authenticated;
grant all on public.broadcast_access to service_role;

alter table public.broadcast_access enable row level security;

create policy "broadcast_access_admin" on public.broadcast_access for all to authenticated
  using ((company_id = public.current_company_id() and public.is_company_admin()) or public.is_platform_admin())
  with check ((company_id = public.current_company_id() and public.is_company_admin()) or public.is_platform_admin());

create policy "broadcast_access_self_read" on public.broadcast_access for select to authenticated
  using (user_id = auth.uid());

create trigger broadcast_access_updated_at
  before update on public.broadcast_access
  for each row execute function public.set_updated_at();

create or replace function public.is_broadcast_operator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.broadcast_access a
    where a.user_id = auth.uid()
      and a.company_id = public.current_company_id()
  );
$$;

revoke all on function public.is_broadcast_operator() from public, anon;
grant execute on function public.is_broadcast_operator() to authenticated, service_role;

create or replace function public.can_use_broadcast_instance(_connection_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_company_admin() or public.is_platform_admin() or exists (
    select 1 from public.broadcast_access a
    where a.user_id = auth.uid()
      and a.connection_id = _connection_id
      and a.company_id = public.current_company_id()
  );
$$;

revoke all on function public.can_use_broadcast_instance(uuid) from public, anon;
grant execute on function public.can_use_broadcast_instance(uuid) to authenticated, service_role;

-- Operadores: só enxergam e mexem no que eles mesmos criaram.
create policy "disparos_contacts_operator" on public.broadcast_contacts for all to authenticated
  using (company_id = public.current_company_id() and created_by = auth.uid() and public.is_broadcast_operator())
  with check (company_id = public.current_company_id() and created_by = auth.uid() and public.is_broadcast_operator());

create policy "disparos_messages_operator" on public.broadcast_messages for all to authenticated
  using (company_id = public.current_company_id() and created_by = auth.uid() and public.is_broadcast_operator())
  with check (company_id = public.current_company_id() and created_by = auth.uid() and public.is_broadcast_operator());

create policy "disparos_campaigns_operator" on public.broadcast_campaigns for all to authenticated
  using (
    company_id = public.current_company_id() and created_by = auth.uid()
    and public.is_broadcast_operator()
  )
  with check (
    company_id = public.current_company_id() and created_by = auth.uid()
    and public.is_broadcast_operator()
    and public.can_use_broadcast_instance(instance_id)
  );

create policy "disparos_campaign_contacts_operator" on public.broadcast_campaign_contacts for all to authenticated
  using (
    company_id = public.current_company_id() and public.is_broadcast_operator()
    and exists (select 1 from public.broadcast_campaigns c where c.id = campaign_id and c.created_by = auth.uid())
  )
  with check (
    company_id = public.current_company_id() and public.is_broadcast_operator()
    and exists (select 1 from public.broadcast_campaigns c where c.id = campaign_id and c.created_by = auth.uid())
  );

create policy "disparos_queue_operator" on public.broadcast_queue for all to authenticated
  using (
    company_id = public.current_company_id() and public.is_broadcast_operator()
    and exists (select 1 from public.broadcast_campaigns c where c.id = campaign_id and c.created_by = auth.uid())
  )
  with check (
    company_id = public.current_company_id() and public.is_broadcast_operator()
    and exists (select 1 from public.broadcast_campaigns c where c.id = campaign_id and c.created_by = auth.uid())
  );

create policy "disparos_logs_operator_read" on public.broadcast_logs for select to authenticated
  using (company_id = public.current_company_id() and user_id = auth.uid() and public.is_broadcast_operator());

create policy "disparos_logs_operator_insert" on public.broadcast_logs for insert to authenticated
  with check (company_id = public.current_company_id() and user_id = auth.uid() and public.is_broadcast_operator());

create policy "disparos_settings_operator_read" on public.broadcast_settings for select to authenticated
  using (company_id = public.current_company_id() and public.is_broadcast_operator());

create policy "whatsapp_connections_broadcast_operator_read" on public.whatsapp_connections for select to authenticated
  using (
    company_id = public.current_company_id()
    and connection_type = 'BROADCAST'
    and exists (
      select 1 from public.broadcast_access a
      where a.user_id = auth.uid() and a.connection_id = whatsapp_connections.id
    )
  );