INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'PLATFORM_ADMIN'::public.app_role
FROM auth.users u
WHERE lower(u.email) = 'carloedvandro@gmail.com'
ON CONFLICT (user_id, role) DO NOTHING;