DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can update profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can view all roles" ON public.user_roles;
DROP POLICY IF EXISTS "Users can view own roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can insert settings" ON public.app_settings;
DROP POLICY IF EXISTS "Admins can update settings" ON public.app_settings;
DROP POLICY IF EXISTS "Signed in users can read settings" ON public.app_settings;

CREATE POLICY "Admins can view all profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING ((auth.jwt() ->> 'email') = '3075554556@qq.com');

CREATE POLICY "Users can view own profile"
ON public.profiles
FOR SELECT
TO authenticated
USING (auth.uid() = id);

CREATE POLICY "Admins can update profiles"
ON public.profiles
FOR UPDATE
TO authenticated
USING ((auth.jwt() ->> 'email') = '3075554556@qq.com')
WITH CHECK ((auth.jwt() ->> 'email') = '3075554556@qq.com');

CREATE POLICY "Users can update own profile"
ON public.profiles
FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

CREATE POLICY "Admins can view all roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING ((auth.jwt() ->> 'email') = '3075554556@qq.com');

CREATE POLICY "Users can view own roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Signed in users can read settings"
ON public.app_settings
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Admins can insert settings"
ON public.app_settings
FOR INSERT
TO authenticated
WITH CHECK ((auth.jwt() ->> 'email') = '3075554556@qq.com');

CREATE POLICY "Admins can update settings"
ON public.app_settings
FOR UPDATE
TO authenticated
USING ((auth.jwt() ->> 'email') = '3075554556@qq.com')
WITH CHECK ((auth.jwt() ->> 'email') = '3075554556@qq.com');

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  ) OR EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = _user_id
      AND email = '3075554556@qq.com'
      AND _role = 'admin'::public.app_role
  )
$$;

CREATE OR REPLACE FUNCTION app_private.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id, _role)
$$;

CREATE OR REPLACE FUNCTION public.consume_credit()
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  uid uuid := auth.uid();
  remaining integer;
  is_admin boolean;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '未登录';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = uid AND email = '3075554556@qq.com'
  ) INTO is_admin;

  IF is_admin THEN
    SELECT credits INTO remaining FROM public.profiles WHERE id = uid;
    RETURN COALESCE(remaining, 9999);
  END IF;

  UPDATE public.profiles
     SET credits = credits - 1
   WHERE id = uid AND credits > 0
   RETURNING credits INTO remaining;

  IF remaining IS NULL THEN
    RAISE EXCEPTION '次数不足';
  END IF;
  RETURN remaining;
END;
$function$;

REVOKE EXECUTE ON FUNCTION app_private.has_role(uuid, public.app_role) FROM authenticated;
REVOKE EXECUTE ON FUNCTION app_private.has_role(uuid, public.app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION app_private.has_role(uuid, public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_credit() TO authenticated;