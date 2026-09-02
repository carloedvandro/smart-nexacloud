CREATE UNIQUE INDEX IF NOT EXISTS admin_delete_credentials_company_name_uidx
  ON public.admin_delete_credentials (company_id, lower(display_name));

CREATE OR REPLACE FUNCTION public.enforce_admin_delete_credential_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _count integer;
BEGIN
  IF NEW.company_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT count(*) INTO _count
    FROM public.admin_delete_credentials
   WHERE company_id = NEW.company_id
     AND user_id <> NEW.user_id;
  IF _count >= 2 THEN
    RAISE EXCEPTION 'Limite atingido: apenas 2 pessoas por empresa podem ter senha de exclusão. Remova uma antes de cadastrar outra.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_delete_credential_limit ON public.admin_delete_credentials;
CREATE TRIGGER trg_admin_delete_credential_limit
BEFORE INSERT OR UPDATE ON public.admin_delete_credentials
FOR EACH ROW EXECUTE FUNCTION public.enforce_admin_delete_credential_limit();