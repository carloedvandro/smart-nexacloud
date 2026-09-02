REVOKE EXECUTE ON FUNCTION public.set_admin_delete_credential(text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.verify_admin_delete_credential(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_admin_delete_credential(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_admin_delete_credential(text, text) TO authenticated;