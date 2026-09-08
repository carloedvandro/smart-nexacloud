alter table public.broadcast_contacts drop constraint if exists broadcast_contacts_company_id_whatsapp_key;
create unique index if not exists broadcast_contacts_company_owner_whatsapp_key
  on public.broadcast_contacts (company_id, created_by, whatsapp);
create index if not exists idx_broadcast_contacts_whatsapp on public.broadcast_contacts (company_id, whatsapp);