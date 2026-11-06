INSERT INTO public.app_settings (key, value)
VALUES ('api_enabled', to_jsonb(true))
ON CONFLICT (key) DO NOTHING;
