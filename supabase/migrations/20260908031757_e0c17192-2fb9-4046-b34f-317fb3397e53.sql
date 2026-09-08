-- 1) Remove plaintext delete-credential password
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

  INSERT INTO public.admin_delete_credentials (user_id, company_id, display_name, password_hash)
  VALUES (_user_id, _company, trim(_display_name), extensions.crypt(_password, extensions.gen_salt('bf')))
  ON CONFLICT (user_id) DO UPDATE
    SET display_name = excluded.display_name,
        password_hash = excluded.password_hash,
        company_id = excluded.company_id,
        updated_at = now();
END;
$$;

DROP FUNCTION IF EXISTS public.platform_list_delete_credentials();
CREATE FUNCTION public.platform_list_delete_credentials()
RETURNS TABLE (
  company_id uuid,
  company_name text,
  max_delete_admins integer,
  user_id uuid,
  display_name text,
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
         a.user_id, a.display_name, p.full_name, p.email, a.updated_at
    FROM public.companies c
    LEFT JOIN public.admin_delete_credentials a ON a.company_id = c.id
    LEFT JOIN public.profiles p ON p.id = a.user_id
   ORDER BY c.name, a.display_name;
END;
$$;

ALTER TABLE public.admin_delete_credentials DROP COLUMN IF EXISTS password_plain;

-- 2) Prevent company tampering on own delete credential
DROP POLICY IF EXISTS "own credential write" ON public.admin_delete_credentials;
CREATE POLICY "own credential write" ON public.admin_delete_credentials
  FOR ALL TO authenticated
  USING (user_id = auth.uid() AND company_id IS NOT DISTINCT FROM public.current_company_id())
  WITH CHECK (user_id = auth.uid() AND company_id IS NOT DISTINCT FROM public.current_company_id());

-- 3) Prevent users from moving their profile to another company
DROP POLICY IF EXISTS "profiles_update_self" ON public.profiles;
CREATE POLICY "profiles_update_self" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid() AND company_id IS NOT DISTINCT FROM public.current_company_id());

-- 4) Lock down SECURITY DEFINER function execution
DO $do$
DECLARE
  r record;
  server_only text[] := ARRAY[
    'ingest_inbound_message','ingest_outbound_echo','claim_whatsapp_events','kick_whatsapp_worker',
    'create_outbound_message','finalize_outbound_message','update_message_delivery','set_message_transcription',
    'queue_register_response','set_instance_connection_state','post_message','ai_resume_conversation',
    'broadcast_claim_next','broadcast_finalize','broadcast_render','broadcast_enqueue_campaign',
    'handle_new_user','on_message_insert','set_updated_at','enforce_admin_delete_credential_limit',
    'enforce_broadcast_instance','enforce_company_license','enforce_connection_type','raise_license_limit',
    'assert_company_license','assert_company_member','dedup_leads_by_lid_phone','merge_leads',
    'upsert_lead','resolve_lead_identity','link_lead_identity','normalize_phone','log_impersonation',
    'accept_company_invites'
  ];
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, format('public.%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid)) AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
    IF NOT (r.proname = ANY(server_only)) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
    END IF;
    IF r.proname IN ('invite_link_info') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon', r.sig);
    END IF;
  END LOOP;
END
$do$;