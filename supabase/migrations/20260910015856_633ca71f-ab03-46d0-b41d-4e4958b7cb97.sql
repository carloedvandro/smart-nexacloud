create table if not exists public.broadcast_contact_blocks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.broadcast_contact_blocks to authenticated;
grant all on public.broadcast_contact_blocks to service_role;

alter table public.broadcast_contact_blocks enable row level security;

create policy "disparos_blocks_admin" on public.broadcast_contact_blocks for all to authenticated
  using ((company_id = public.current_company_id() and public.is_company_admin()) or public.is_platform_admin())
  with check ((company_id = public.current_company_id() and public.is_company_admin()) or public.is_platform_admin());

create policy "disparos_blocks_operator" on public.broadcast_contact_blocks for all to authenticated
  using (company_id = public.current_company_id() and public.is_broadcast_operator())
  with check (company_id = public.current_company_id() and public.is_broadcast_operator());

drop trigger if exists trg_broadcast_blocks_updated on public.broadcast_contact_blocks;
create trigger trg_broadcast_blocks_updated before update on public.broadcast_contact_blocks
  for each row execute function public.set_updated_at();

create index if not exists idx_broadcast_blocks_company
  on public.broadcast_contact_blocks(company_id, created_by, created_at);

alter table public.broadcast_contacts
  add column if not exists block_id uuid references public.broadcast_contact_blocks(id) on delete cascade;

create index if not exists idx_broadcast_contacts_block on public.broadcast_contacts(block_id);

do $$
declare r record; bid uuid;
begin
  for r in
    select company_id, created_by, chunk, array_agg(id) as ids
    from (
      select id, company_id, created_by,
             ((row_number() over (partition by company_id, created_by order by created_at)) - 1) / 1000 as chunk
      from public.broadcast_contacts
      where block_id is null
    ) t
    group by company_id, created_by, chunk
  loop
    insert into public.broadcast_contact_blocks (company_id, created_by, name)
    values (r.company_id, r.created_by, 'Bloco ' || (r.chunk + 1))
    returning id into bid;
    update public.broadcast_contacts set block_id = bid where id = any(r.ids);
  end loop;
end $$;

alter table public.broadcast_contact_blocks replica identity full;