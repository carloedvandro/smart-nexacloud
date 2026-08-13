
CREATE POLICY "conversation_media_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'conversation-media'
    AND (storage.foldername(name))[1] = public.current_company_id()::text);
CREATE POLICY "conversation_media_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'conversation-media'
    AND (storage.foldername(name))[1] = public.current_company_id()::text);
CREATE POLICY "conversation_media_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'conversation-media'
    AND (storage.foldername(name))[1] = public.current_company_id()::text)
  WITH CHECK (bucket_id = 'conversation-media'
    AND (storage.foldername(name))[1] = public.current_company_id()::text);
CREATE POLICY "conversation_media_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'conversation-media'
    AND (storage.foldername(name))[1] = public.current_company_id()::text
    AND public.is_company_admin());
