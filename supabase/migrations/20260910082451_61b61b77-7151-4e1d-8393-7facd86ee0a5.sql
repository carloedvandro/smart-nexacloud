ALTER TABLE public.broadcast_contacts ADD COLUMN IF NOT EXISTS seq bigserial;
CREATE INDEX IF NOT EXISTS broadcast_contacts_block_seq_idx ON public.broadcast_contacts (block_id, seq);
CREATE INDEX IF NOT EXISTS broadcast_contacts_company_seq_idx ON public.broadcast_contacts (company_id, seq);