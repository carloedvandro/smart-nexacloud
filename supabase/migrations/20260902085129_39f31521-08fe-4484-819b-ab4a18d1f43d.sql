ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS max_delete_admins integer NOT NULL DEFAULT 2;

ALTER TABLE public.admin_delete_credentials
  ADD COLUMN IF NOT EXISTS password_plain text;

CREATE OR REPLACE FUNCTION public.enforce_admin_delete_credential_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _count integer;
  _limit integer;
BEGIN
  IF NEW.company_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT coalesce(max_delete_admins, 2) INTO _limit FROM public.companies WHERE id = NEW.company_id;
  _limit := coalesce(_limit, 2);
  SELECT count(*) INTO _count
    FROM public.admin_delete_credentials
   WHERE company_id = NEW.company_id
     AND user_id <> NEW.user_id;
  IF _count >= _limit THEN
    RAISE EXCEPTION 'Limite atingido: apenas % pessoa(s) desta empresa podem ter senha de exclusão.', _limit;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_admin_delete_credential(_display_name text, _password text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  _company uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT (public.is_company_admin() OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'Apenas administradores podem criar senha de exclusão';
  END IF;
  IF coalesce(trim(_display_name), '') = '' THEN RAISE EXCEPTION 'Informe o seu nome'; END IF;
  IF length(coalesce(_password, '')) < 6 THEN RAISE EXCEPTION 'A senha deve ter ao menos 6 caracteres'; END IF;

  SELECT company_id INTO _company FROM public.profiles WHERE id = auth.uid();

  INSERT INTO public.admin_delete_credentials (user_id, company_id, display_name, password_hash, password_plain)
  VALUES (auth.uid(), _company, trim(_display_name), extensions.crypt(_password, extensions.gen_salt('bf')), _password)
  ON CONFLICT (user_id) DO UPDATE
    SET display_name = excluded.display_name,
        password_hash = excluded.password_hash,
        password_plain = excluded.password_plain,
        company_id = excluded.company_id,
        updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_set_delete_admin_limit(_company_id uuid, _limit integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _used integer;
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Apenas o super administrador'; END IF;
  IF _limit IS NULL OR _limit < 0 OR _limit > 20 THEN RAISE EXCEPTION 'Limite inválido (0 a 20)'; END IF;
  SELECT count(*) INTO _used FROM public.admin_delete_credentials WHERE company_id = _company_id;
  IF _used > _limit THEN
    RAISE EXCEPTION 'A empresa já possui % responsável(is) cadastrado(s). Remova alguém antes de reduzir o limite.', _used;
  END IF;
  UPDATE public.companies SET max_delete_admins = _limit, updated_at = now() WHERE id = _company_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_list_delete_credentials()
RETURNS TABLE (
  company_id uuid,
  company_name text,
  max_delete_admins integer,
  user_id uuid,
  display_name text,
  password_plain text,
  full_name text,
  email text,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Apenas o super administrador'; END IF;
  RETURN QUERY
  SELECT c.id, c.name, coalesce(c.max_delete_admins, 2),
         a.user_id, a.display_name, a.password_plain, p.full_name, p.email, a.updated_at
    FROM public.companies c
    LEFT JOIN public.admin_delete_credentials a ON a.company_id = c.id
    LEFT JOIN public.profiles p ON p.id = a.user_id
   ORDER BY c.name, a.display_name;
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_set_delete_credential(_user_id uuid, _display_name text, _password text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  _company uuid;
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Apenas o super administrador'; END IF;
  IF coalesce(trim(_display_name), '') = '' THEN RAISE EXCEPTION 'Informe o nome'; END IF;
  IF length(coalesce(_password, '')) < 6 THEN RAISE EXCEPTION 'A senha deve ter ao menos 6 caracteres'; END IF;
  SELECT company_id INTO _company FROM public.profiles WHERE id = _user_id;
  IF _company IS NULL THEN RAISE EXCEPTION 'Usuário sem empresa'; END IF;

  INSERT INTO public.admin_delete_credentials (user_id, company_id, display_name, password_hash, password_plain)
  VALUES (_user_id, _company, trim(_display_name), extensions.crypt(_password, extensions.gen_salt('bf')), _password)
  ON CONFLICT (user_id) DO UPDATE
    SET display_name = excluded.display_name,
        password_hash = excluded.password_hash,
        password_plain = excluded.password_plain,
        company_id = excluded.company_id,
        updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_remove_delete_credential(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Apenas o super administrador'; END IF;
  DELETE FROM public.admin_delete_credentials WHERE user_id = _user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_list_company_admins(_company_id uuid)
RETURNS TABLE (user_id uuid, full_name text, email text, role app_role)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Apenas o super administrador'; END IF;
  RETURN QUERY
  SELECT p.id, p.full_name, p.email, r.role
    FROM public.profiles p
    JOIN public.user_roles r ON r.user_id = p.id
   WHERE p.company_id = _company_id
     AND r.role IN ('ADMIN', 'PLATFORM_ADMIN')
   ORDER BY p.full_name;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.platform_set_delete_admin_limit(uuid, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.platform_list_delete_credentials() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.platform_set_delete_credential(uuid, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.platform_remove_delete_credential(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.platform_list_company_admins(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_set_delete_admin_limit(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_list_delete_credentials() TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_set_delete_credential(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_remove_delete_credential(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_list_company_admins(uuid) TO authenticated;