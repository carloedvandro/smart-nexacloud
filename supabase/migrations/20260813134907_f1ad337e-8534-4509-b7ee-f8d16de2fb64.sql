-- 1) Novos estados de instância e novo papel de plataforma
ALTER TYPE public.whatsapp_connection_status ADD VALUE IF NOT EXISTS 'AVAILABLE';
ALTER TYPE public.whatsapp_connection_status ADD VALUE IF NOT EXISTS 'BLOCKED';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'PLATFORM_ADMIN';

-- 2) Instância = recurso contratado
ALTER TABLE public.whatsapp_connections
  ADD COLUMN IF NOT EXISTS instance_number integer,
  ADD COLUMN IF NOT EXISTS provisioned_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS provisioned_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS assigned_by uuid REFERENCES public.profiles(id);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_connections_company_number_key
  ON public.whatsapp_connections (company_id, instance_number)
  WHERE instance_number IS NOT NULL;

-- 3) Histórico de vinculações (nunca apagado)
CREATE TABLE IF NOT EXISTS public.whatsapp_instance_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.whatsapp_connections(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(id),
  user_name text,
  phone_number text,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  assigned_by uuid REFERENCES public.profiles(id),
  released_by uuid REFERENCES public.profiles(id),
  release_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.whatsapp_instance_assignments TO authenticated;
GRANT ALL ON public.whatsapp_instance_assignments TO service_role;
ALTER TABLE public.whatsapp_instance_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company members read instance history" ON public.whatsapp_instance_assignments;
CREATE POLICY "company members read instance history" ON public.whatsapp_instance_assignments
  FOR SELECT TO authenticated USING (company_id = public.current_company_id());
CREATE INDEX IF NOT EXISTS wa_instance_assignments_conn_idx
  ON public.whatsapp_instance_assignments (connection_id, started_at DESC);

-- 4) Administrador da plataforma
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
     WHERE user_id = auth.uid() AND role::text = 'PLATFORM_ADMIN'
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;

-- 5) Políticas: empresa lê suas instâncias; ninguém cria/apaga direto pelo cliente
DROP POLICY IF EXISTS "company members read connections" ON public.whatsapp_connections;
CREATE POLICY "company members read connections" ON public.whatsapp_connections
  FOR SELECT TO authenticated
  USING (company_id = public.current_company_id() OR public.is_platform_admin());
