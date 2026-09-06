ALTER TABLE public.broadcast_messages
  ADD COLUMN IF NOT EXISTS media_url text,
  ADD COLUMN IF NOT EXISTS media_type text,
  ADD COLUMN IF NOT EXISTS media_filename text;

ALTER TABLE public.broadcast_messages ALTER COLUMN content DROP NOT NULL;
ALTER TABLE public.broadcast_messages ALTER COLUMN content SET DEFAULT '';