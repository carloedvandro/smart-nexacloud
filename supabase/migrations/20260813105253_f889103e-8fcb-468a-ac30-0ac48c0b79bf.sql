
CREATE OR REPLACE FUNCTION public.bootstrap_company(_name text, _legal_name text DEFAULT NULL, _document text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _existing uuid;
  _company_id uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF coalesce(btrim(_name), '') = '' THEN RAISE EXCEPTION 'company name is required'; END IF;

  SELECT company_id INTO _existing FROM public.profiles WHERE id = _uid FOR UPDATE;
  IF _existing IS NOT NULL THEN RAISE EXCEPTION 'user already belongs to a company'; END IF;

  INSERT INTO public.companies (name, legal_name, document)
  VALUES (btrim(_name), _legal_name, _document)
  RETURNING id INTO _company_id;

  UPDATE public.profiles SET company_id = _company_id WHERE id = _uid;

  INSERT INTO public.user_roles (user_id, company_id, role)
  VALUES (_uid, _company_id, 'ADMIN')
  ON CONFLICT (user_id, role) DO UPDATE SET company_id = EXCLUDED.company_id;

  INSERT INTO public.queue_settings (company_id) VALUES (_company_id);

  INSERT INTO public.business_hours (company_id, weekday, start_time, end_time, is_active)
  SELECT _company_id, d, '08:00', '18:00', d BETWEEN 1 AND 5 FROM generate_series(0,6) AS d;

  INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id)
  VALUES (_company_id, _uid, 'CREATE_COMPANY', 'company', _company_id);

  RETURN _company_id;
END;
$$;

REVOKE ALL ON FUNCTION public.bootstrap_company(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bootstrap_company(text, text, text) TO authenticated, service_role;
