ALTER TABLE public.broadcast_messages ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE public.broadcast_messages
SET attachments = jsonb_build_array(jsonb_build_object(
  'path', media_url,
  'mime', coalesce(media_type, 'image/jpeg'),
  'filename', coalesce(media_filename, 'imagem.jpg'),
  'kind', CASE WHEN coalesce(media_type,'image/jpeg') LIKE 'image/%' THEN 'image' ELSE 'document' END
))
WHERE media_url IS NOT NULL AND attachments = '[]'::jsonb;