
-- 1) 给 profiles 添加剩余次数字段
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS credits INTEGER NOT NULL DEFAULT 10;

-- 2) 更新新用户触发器：新用户默认 10 次（管理员 9999 次）
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, email, credits)
  VALUES (NEW.id, NEW.email, CASE WHEN NEW.email = '3075554556@qq.com' THEN 9999 ELSE 10 END)
  ON CONFLICT (id) DO NOTHING;

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

-- 3) 原子扣减次数：仅本人调用；管理员不扣减
CREATE OR REPLACE FUNCTION public.consume_credit()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  uid uuid := auth.uid();
  remaining INTEGER;
  is_admin boolean;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '未登录';
  END IF;

  SELECT public.has_role(uid, 'admin'::app_role) INTO is_admin;
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

-- 4) 管理员调整指定用户次数（delta 正负均可），返回新值
CREATE OR REPLACE FUNCTION public.admin_adjust_credits(_user_id uuid, _delta integer)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  uid uuid := auth.uid();
  new_val INTEGER;
BEGIN
  IF NOT public.has_role(uid, 'admin'::app_role) THEN
    RAISE EXCEPTION '无权限';
  END IF;

  UPDATE public.profiles
     SET credits = GREATEST(0, credits + _delta)
   WHERE id = _user_id
   RETURNING credits INTO new_val;

  IF new_val IS NULL THEN
    RAISE EXCEPTION '用户不存在';
  END IF;
  RETURN new_val;
END;
$$;

-- 5) 允许本人读取自己的次数（已有 SELECT own profile 策略已覆盖，无需更改）
