ALTER TABLE public.whatsapp_connections
  ADD COLUMN IF NOT EXISTS is_trunk boolean NOT NULL DEFAULT false;

UPDATE public.whatsapp_connections c
   SET is_trunk = true
 WHERE c.instance_number = 1
   AND NOT EXISTS (
     SELECT 1 FROM public.whatsapp_connections o
      WHERE o.company_id = c.company_id AND o.is_trunk
   );

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_connections_one_trunk_per_company
  ON public.whatsapp_connections (company_id) WHERE is_trunk;

-- Provisionamento: a primeira instância da empresa nasce como tronco
CREATE OR REPLACE FUNCTION public.provision_whatsapp_instance(
  _company_id uuid,
  _instance_key text,
  _name text DEFAULT NULL,
  _instance_number integer DEFAULT NULL,
  _api_host text DEFAULT NULL,
  _api_key text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid; _num integer; _label text; _company_name text; _trunk boolean;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'somente o administrador da plataforma pode provisionar instâncias';
  END IF;
  IF coalesce(btrim(_instance_key),'') = '' THEN RAISE EXCEPTION 'instance_key obrigatória'; END IF;

  SELECT name INTO _company_name FROM public.companies WHERE id = _company_id;
  IF _company_name IS NULL THEN RAISE EXCEPTION 'empresa inexistente'; END IF;

  _num := COALESCE(_instance_number,
           (SELECT COALESCE(MAX(instance_number), 0) + 1
              FROM public.whatsapp_connections WHERE company_id = _company_id));
  _label := COALESCE(NULLIF(btrim(_name), ''), _company_name || ' — Instância ' || _num);

  _trunk := NOT EXISTS (SELECT 1 FROM public.whatsapp_connections
                         WHERE company_id = _company_id AND is_trunk);

  INSERT INTO public.whatsapp_connections
    (company_id, name, instance_number, provider, instance_id, status, provisioned_by, provisioned_at, is_trunk)
  VALUES (_company_id, _label, _num, 'mega', NULL, 'AVAILABLE', auth.uid(), now(), _trunk)
  RETURNING id INTO _id;

  INSERT INTO public.whatsapp_credentials (connection_id, company_id, instance_key, api_host, api_key)
  VALUES (_id, _company_id, btrim(_instance_key), NULLIF(btrim(coalesce(_api_host,'')),''),
          NULLIF(btrim(coalesce(_api_key,'')),''));

  INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (_company_id, auth.uid(), 'PROVISION_WHATSAPP_INSTANCE', 'whatsapp_connection', _id,
          jsonb_build_object('name', _label, 'instance_number', _num, 'is_trunk', _trunk));

  RETURN _id;
END; $$;

-- Definição do tronco pelo administrador da empresa
CREATE OR REPLACE FUNCTION public.set_trunk_whatsapp_instance(_connection_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _company uuid := public.current_company_id();
BEGIN
  PERFORM public.assert_company_member(_company);
  IF NOT public.is_company_admin() THEN RAISE EXCEPTION 'somente administradores'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.whatsapp_connections
                  WHERE id = _connection_id AND company_id = _company) THEN
    RAISE EXCEPTION 'instância inexistente';
  END IF;

  UPDATE public.whatsapp_connections SET is_trunk = false
   WHERE company_id = _company AND is_trunk AND id <> _connection_id;
  UPDATE public.whatsapp_connections SET is_trunk = true WHERE id = _connection_id;

  INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (_company, auth.uid(), 'SET_TRUNK_WHATSAPP_INSTANCE', 'whatsapp_connection', _connection_id, '{}'::jsonb);
END; $$;
REVOKE ALL ON FUNCTION public.set_trunk_whatsapp_instance(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_trunk_whatsapp_instance(uuid) TO authenticated, service_role;