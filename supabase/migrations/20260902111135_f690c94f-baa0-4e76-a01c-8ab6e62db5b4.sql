CREATE TABLE public.admin_delete_credential_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  target_user_id uuid,
  actor_user_id uuid,
  actor_name text,
  action text NOT NULL,
  previous_display_name text,
  new_display_name text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.admin_delete_credential_logs TO authenticated;
GRANT ALL ON public.admin_delete_credential_logs TO service_role;
ALTER TABLE public.admin_delete_credential_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read credential logs" ON public.admin_delete_credential_logs
  FOR SELECT TO authenticated
  USING (public.is_platform_admin() OR (public.is_company_admin() AND company_id = public.current_company_id()));

CREATE INDEX idx_admin_delete_credential_logs_company
  ON public.admin_delete_credential_logs (company_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.set_admin_delete_credential(_display_name text, _password text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  _company uuid;
  _existing text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT (public.is_company_admin() OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'Apenas administradores podem criar senha de exclusão';
  END IF;
  IF coalesce(trim(_display_name), '') = '' THEN RAISE EXCEPTION 'Informe o seu nome'; END IF;
  IF length(coalesce(_password, '')) < 6 THEN RAISE EXCEPTION 'A senha deve ter ao menos 6 caracteres'; END IF;

  SELECT company_id INTO _company FROM public.profiles WHERE id = auth.uid();
  SELECT display_name INTO _existing FROM public.admin_delete_credentials WHERE user_id = auth.uid();

  INSERT INTO public.admin_delete_credentials (user_id, company_id, display_name, password_hash)
  VALUES (auth.uid(), _company, trim(_display_name), extensions.crypt(_password, extensions.gen_salt('bf')))
  ON CONFLICT (user_id) DO UPDATE
    SET display_name = excluded.display_name,
        password_hash = excluded.password_hash,
        company_id = excluded.company_id,
        updated_at = now();

  INSERT INTO public.admin_delete_credential_logs
    (company_id, target_user_id, actor_user_id, actor_name, action, previous_display_name, new_display_name)
  VALUES (
    _company, auth.uid(), auth.uid(),
    coalesce(_existing, trim(_display_name)),
    CASE WHEN _existing IS NULL THEN 'CREATED' ELSE 'PASSWORD_UPDATED' END,
    _existing, trim(_display_name)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.rename_admin_delete_credential(_new_display_name text, _password text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  _row public.admin_delete_credentials%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF coalesce(trim(_new_display_name), '') = '' THEN RAISE EXCEPTION 'Informe o novo nome'; END IF;

  SELECT * INTO _row FROM public.admin_delete_credentials WHERE user_id = auth.uid();
  IF _row.user_id IS NULL THEN RAISE EXCEPTION 'Você não possui senha de exclusão cadastrada'; END IF;

  IF _row.password_hash <> extensions.crypt(coalesce(_password, ''), _row.password_hash) THEN
    RAISE EXCEPTION 'Senha de exclusão incorreta';
  END IF;

  IF trim(_new_display_name) = _row.display_name THEN
    RETURN;
  END IF;

  UPDATE public.admin_delete_credentials
    SET display_name = trim(_new_display_name), updated_at = now()
    WHERE user_id = auth.uid();

  INSERT INTO public.admin_delete_credential_logs
    (company_id, target_user_id, actor_user_id, actor_name, action, previous_display_name, new_display_name)
  VALUES (_row.company_id, auth.uid(), auth.uid(), _row.display_name, 'RENAMED', _row.display_name, trim(_new_display_name));
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_admin_delete_credential(_password text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  _row public.admin_delete_credentials%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;

  SELECT * INTO _row FROM public.admin_delete_credentials WHERE user_id = auth.uid();
  IF _row.user_id IS NULL THEN RAISE EXCEPTION 'Você não possui senha de exclusão cadastrada'; END IF;

  IF _row.password_hash <> extensions.crypt(coalesce(_password, ''), _row.password_hash) THEN
    RAISE EXCEPTION 'Senha de exclusão incorreta';
  END IF;

  DELETE FROM public.admin_delete_credentials WHERE user_id = auth.uid();

  INSERT INTO public.admin_delete_credential_logs
    (company_id, target_user_id, actor_user_id, actor_name, action, previous_display_name, new_display_name)
  VALUES (_row.company_id, auth.uid(), auth.uid(), _row.display_name, 'REMOVED', _row.display_name, NULL);
END;
$$;

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
DECLARE
  _company uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT (public.is_company_admin() OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'Apenas administradores podem ver este histórico';
  END IF;

  SELECT company_id INTO _company FROM public.profiles WHERE id = auth.uid();

  RETURN QUERY
  SELECT l.id, l.action, l.actor_name, l.previous_display_name, l.new_display_name,
         p.full_name, p.email, l.created_at
  FROM public.admin_delete_credential_logs l
  LEFT JOIN public.profiles p ON p.id = l.target_user_id
  WHERE l.company_id = _company OR public.is_platform_admin()
  ORDER BY l.created_at DESC
  LIMIT 200;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rename_admin_delete_credential(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_admin_delete_credential(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.company_list_delete_credential_logs() TO authenticated;