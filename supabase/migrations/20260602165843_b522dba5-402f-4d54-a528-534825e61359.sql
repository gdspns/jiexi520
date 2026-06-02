
CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view settings" ON public.app_settings
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can insert settings" ON public.app_settings
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can update settings" ON public.app_settings
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

INSERT INTO public.app_settings (key, value) VALUES ('signup_bonus_credits', '10'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 更新新用户触发器：从 app_settings 读取赠送次数
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
