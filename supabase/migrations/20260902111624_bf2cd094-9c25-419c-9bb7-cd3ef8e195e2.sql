CREATE OR REPLACE FUNCTION public.company_list_delete_credential_logs()
RETURNS TABLE (
  id uuid,
  action text,
  actor_name text,
  previous_display_name text,
  new_display_name text,
  full_name text,
  email text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  _company uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT (public.is_company_admin() OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'Apenas administradores podem ver este histórico';
  END IF;

  SELECT p.company_id INTO _company FROM public.profiles p WHERE p.id = auth.uid();

  RETURN QUERY
  SELECT l.id, l.action, l.actor_name, l.previous_display_name, l.new_display_name,
         pr.full_name, pr.email, l.created_at
  FROM public.admin_delete_credential_logs l
  LEFT JOIN public.profiles pr ON pr.id = l.target_user_id
  WHERE l.company_id = _company OR public.is_platform_admin()
  ORDER BY l.created_at DESC
  LIMIT 200;
END;
$$;

GRANT EXECUTE ON FUNCTION public.company_list_delete_credential_logs() TO authenticated;