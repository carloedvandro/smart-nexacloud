CREATE OR REPLACE FUNCTION public.company_list_delete_credentials()
RETURNS TABLE(user_id uuid, display_name text, full_name text, email text, updated_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _company uuid := public.current_company_id();
BEGIN
  IF _company IS NULL THEN
    RETURN;
  END IF;
  IF NOT (public.is_company_admin() OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'Acesso restrito aos administradores da empresa.';
  END IF;

  RETURN QUERY
  SELECT c.user_id, c.display_name, p.full_name, p.email, c.updated_at
  FROM public.admin_delete_credentials c
  JOIN public.profiles p ON p.id = c.user_id
  WHERE c.company_id = _company
  ORDER BY c.updated_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.company_list_delete_credentials() TO authenticated;