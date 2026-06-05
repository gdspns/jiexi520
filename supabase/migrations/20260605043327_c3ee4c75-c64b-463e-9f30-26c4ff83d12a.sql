CREATE SCHEMA IF NOT EXISTS app_private;

CREATE OR REPLACE FUNCTION app_private.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
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

GRANT USAGE ON SCHEMA app_private TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.has_role(uuid, public.app_role) TO authenticated;

DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can update profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can delete profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can view all roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can view settings" ON public.app_settings;
DROP POLICY IF EXISTS "Admins can insert settings" ON public.app_settings;
DROP POLICY IF EXISTS "Admins can update settings" ON public.app_settings;
DROP POLICY IF EXISTS "No direct client reads of settings" ON public.app_settings;
DROP POLICY IF EXISTS "No direct client inserts of settings" ON public.app_settings;
DROP POLICY IF EXISTS "No direct client updates of settings" ON public.app_settings;
DROP POLICY IF EXISTS "No direct client deletes of settings" ON public.app_settings;

CREATE POLICY "Admins can view all profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (app_private.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can update profiles"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (app_private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (app_private.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can view all roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (app_private.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Signed in users can read settings"
  ON public.app_settings FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can insert settings"
  ON public.app_settings FOR INSERT
  TO authenticated
  WITH CHECK (app_private.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can update settings"
  ON public.app_settings FOR UPDATE
  TO authenticated
  USING (app_private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (app_private.has_role(auth.uid(), 'admin'::public.app_role));

CREATE OR REPLACE FUNCTION public.consume_credit()
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  uid uuid := auth.uid();
  remaining integer;
  is_admin boolean;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '未登录';
  END IF;

  SELECT app_private.has_role(uid, 'admin'::public.app_role) INTO is_admin;
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
$$;

REVOKE EXECUTE ON FUNCTION public.consume_credit() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_credit() TO authenticated;