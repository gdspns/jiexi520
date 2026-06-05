DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can view all roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can view settings" ON public.app_settings;
DROP POLICY IF EXISTS "Admins can insert settings" ON public.app_settings;
DROP POLICY IF EXISTS "Admins can update settings" ON public.app_settings;

CREATE OR REPLACE FUNCTION public.consume_credit_for_user(_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  remaining integer;
  is_admin boolean;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION '未登录';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = 'admin'::public.app_role
  ) OR EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = _user_id AND email = '3075554556@qq.com'
  ) INTO is_admin;

  IF is_admin THEN
    SELECT credits INTO remaining FROM public.profiles WHERE id = _user_id;
    RETURN COALESCE(remaining, 9999);
  END IF;

  UPDATE public.profiles
     SET credits = credits - 1
   WHERE id = _user_id AND credits > 0
   RETURNING credits INTO remaining;

  IF remaining IS NULL THEN
    RAISE EXCEPTION '次数不足';
  END IF;

  RETURN remaining;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.consume_credit_for_user(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_credit_for_user(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO service_role;

REVOKE EXECUTE ON FUNCTION public.admin_adjust_credits(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_credits(uuid, integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.consume_credit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_credit() TO service_role;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;