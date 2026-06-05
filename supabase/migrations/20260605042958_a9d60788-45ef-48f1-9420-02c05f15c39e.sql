CREATE POLICY "No direct client reads of settings"
  ON public.app_settings
  FOR SELECT
  TO authenticated
  USING (false);

CREATE POLICY "No direct client inserts of settings"
  ON public.app_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (false);

CREATE POLICY "No direct client updates of settings"
  ON public.app_settings
  FOR UPDATE
  TO authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY "No direct client deletes of settings"
  ON public.app_settings
  FOR DELETE
  TO authenticated
  USING (false);