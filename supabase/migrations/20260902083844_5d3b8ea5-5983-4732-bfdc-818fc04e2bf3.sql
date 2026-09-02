CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE public.admin_delete_credentials (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_delete_credentials TO authenticated;
GRANT ALL ON public.admin_delete_credentials TO service_role;
ALTER TABLE public.admin_delete_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own credential select" ON public.admin_delete_credentials
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "own credential write" ON public.admin_delete_credentials
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TRIGGER admin_delete_credentials_set_updated_at
  BEFORE UPDATE ON public.admin_delete_credentials
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.conversation_deletion_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  lead_id uuid,
  lead_name text,
  lead_phone text,
  channel text,
  messages_deleted integer NOT NULL DEFAULT 0,
  deleted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  deleted_by_name text,
  confirmed_name text,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.conversation_deletion_logs TO authenticated;
GRANT ALL ON public.conversation_deletion_logs TO service_role;
ALTER TABLE public.conversation_deletion_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read deletion logs" ON public.conversation_deletion_logs
  FOR SELECT TO authenticated
  USING (public.is_platform_admin() OR (public.is_company_admin() AND company_id = public.current_company_id()));

CREATE INDEX idx_conversation_deletion_logs_company ON public.conversation_deletion_logs (company_id, created_at DESC);

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

  INSERT INTO public.admin_delete_credentials (user_id, company_id, display_name, password_hash)
  VALUES (auth.uid(), _company, trim(_display_name), extensions.crypt(_password, extensions.gen_salt('bf')))
  ON CONFLICT (user_id) DO UPDATE
    SET display_name = excluded.display_name,
        password_hash = excluded.password_hash,
        company_id = excluded.company_id,
        updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_admin_delete_credential(_display_name text, _password text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  _row public.admin_delete_credentials;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  SELECT * INTO _row FROM public.admin_delete_credentials WHERE user_id = auth.uid();
  IF _row IS NULL THEN RETURN false; END IF;
  IF lower(trim(coalesce(_display_name, ''))) <> lower(_row.display_name) THEN RETURN false; END IF;
  RETURN _row.password_hash = extensions.crypt(coalesce(_password, ''), _row.password_hash);
END;
$$;
