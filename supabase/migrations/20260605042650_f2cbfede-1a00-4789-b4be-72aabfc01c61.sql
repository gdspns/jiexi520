CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
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

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  bonus INTEGER;
BEGIN
  SELECT COALESCE((value)::text::int, 10) INTO bonus
    FROM public.app_settings WHERE key = 'signup_bonus_credits';
  IF bonus IS NULL THEN bonus := 10; END IF;

  INSERT INTO public.profiles (id, email, credits)
  VALUES (NEW.id, NEW.email, CASE WHEN NEW.email = '3075554556@qq.com' THEN 9999 ELSE bonus END)
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        credits = CASE
          WHEN EXCLUDED.email = '3075554556@qq.com' THEN GREATEST(public.profiles.credits, 9999)
          ELSE public.profiles.credits
        END;

  IF NEW.email = '3075554556@qq.com' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin')
    ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user')
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;

INSERT INTO public.profiles (id, email, credits)
SELECT id, email, 9999
FROM auth.users
WHERE email = '3075554556@qq.com'
ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      credits = GREATEST(public.profiles.credits, 9999);

INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role
FROM auth.users
WHERE email = '3075554556@qq.com'
ON CONFLICT DO NOTHING;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;