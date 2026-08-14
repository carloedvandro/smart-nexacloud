REVOKE EXECUTE ON FUNCTION public.accept_company_invites(uuid, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_company_invite() FROM anon;
REVOKE EXECUTE ON FUNCTION public.platform_invite_company_member(uuid, text, public.app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.platform_set_member_role(uuid, uuid, public.app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.platform_remove_company_member(uuid, uuid) FROM anon;