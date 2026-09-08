drop policy if exists "disparos_contacts_operator" on public.broadcast_contacts;
drop policy if exists "disparos_messages_operator" on public.broadcast_messages;

create policy "disparos_contacts_operator" on public.broadcast_contacts for all to authenticated
  using (company_id = public.current_company_id() and public.is_broadcast_operator())
  with check (company_id = public.current_company_id() and public.is_broadcast_operator());

create policy "disparos_messages_operator" on public.broadcast_messages for all to authenticated
  using (company_id = public.current_company_id() and public.is_broadcast_operator())
  with check (company_id = public.current_company_id() and public.is_broadcast_operator());