CREATE TABLE IF NOT EXISTS public.parse_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL DEFAULT '',
  type text NOT NULL DEFAULT '',
  proxy_on boolean NOT NULL DEFAULT false,
  url text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'start',
  message text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS parse_logs_created_at_idx ON public.parse_logs (created_at DESC);
GRANT SELECT ON public.parse_logs TO authenticated;
GRANT ALL ON public.parse_logs TO service_role;
ALTER TABLE public.parse_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read parse_logs" ON public.parse_logs
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.role = 'admin')
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.email = '3075554556@qq.com')
  );