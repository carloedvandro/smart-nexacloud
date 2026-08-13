DELETE FROM public.lead_memory a USING public.lead_memory b
 WHERE a.lead_id = b.lead_id AND a.key = b.key AND a.ctid < b.ctid;

CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_memory_lead_key
  ON public.lead_memory(lead_id, key);

ALTER TABLE public.lead_memory
  ADD CONSTRAINT uq_lead_memory_lead_key UNIQUE USING INDEX uq_lead_memory_lead_key;

REVOKE EXECUTE ON FUNCTION public.normalize_phone(text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.assert_company_member(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.upsert_lead(text,text,text,text,text,lead_source,uuid,jsonb) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_or_create_conversation(uuid,text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.post_message(uuid,sender_type,text,message_type,text,text,text,text,jsonb) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.assign_conversation(uuid,uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.set_conversation_status(uuid,conversation_status) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.mark_conversation_read(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.upsert_lead_memory(uuid,text,text,sender_type,numeric) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.set_conversation_summary(uuid,text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.set_lead_status(uuid,lead_status) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.assign_lead(uuid,uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.bootstrap_company(text,text,text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.current_company_id() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_company_admin() FROM anon, public;

GRANT EXECUTE ON FUNCTION public.normalize_phone(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_lead(text,text,text,text,text,lead_source,uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_conversation(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_message(uuid,sender_type,text,message_type,text,text,text,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_conversation(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_conversation_status(uuid,conversation_status) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_lead_memory(uuid,text,text,sender_type,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_conversation_summary(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_lead_status(uuid,lead_status) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_lead(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_company(text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_company_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_company_admin() TO authenticated;