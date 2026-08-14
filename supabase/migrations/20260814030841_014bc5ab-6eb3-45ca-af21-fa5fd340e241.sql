DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles r
    JOIN auth.users u ON u.id = r.user_id
    WHERE lower(u.email) = 'carloedvandro@gmail.com' AND r.role = 'PLATFORM_ADMIN'
  ) THEN
    RAISE EXCEPTION 'PLATFORM_ADMIN nao aplicado';
  END IF;
END $$;