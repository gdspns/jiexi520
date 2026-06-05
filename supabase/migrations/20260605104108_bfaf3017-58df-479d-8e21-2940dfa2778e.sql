
-- payment_config (single row, key='default')
CREATE TABLE public.payment_config (
  key text PRIMARY KEY DEFAULT 'default',
  wechat_appid text NOT NULL DEFAULT '',
  wechat_appsecret text NOT NULL DEFAULT '',
  wechat_enabled boolean NOT NULL DEFAULT false,
  alipay_appid text NOT NULL DEFAULT '',
  alipay_appsecret text NOT NULL DEFAULT '',
  alipay_enabled boolean NOT NULL DEFAULT false,
  api_endpoint text NOT NULL DEFAULT 'https://api.xunhupay.com/payment/do.html',
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.payment_config TO authenticated;
GRANT ALL ON public.payment_config TO service_role;
ALTER TABLE public.payment_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin read payment_config" ON public.payment_config FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "admin write payment_config" ON public.payment_config FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

INSERT INTO public.payment_config (key) VALUES ('default') ON CONFLICT DO NOTHING;

-- recharge_products
CREATE TABLE public.recharge_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  price integer NOT NULL CHECK (price >= 0),          -- in cents
  credits integer NOT NULL CHECK (credits >= 0),
  discount_price integer CHECK (discount_price IS NULL OR discount_price >= 0),
  enabled boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recharge_products TO authenticated;
GRANT ALL ON public.recharge_products TO service_role;
ALTER TABLE public.recharge_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users read enabled products" ON public.recharge_products FOR SELECT TO authenticated
  USING (enabled = true OR public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "admin write products" ON public.recharge_products FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_recharge_products_updated
  BEFORE UPDATE ON public.recharge_products
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- payment_orders
CREATE TABLE public.payment_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no text NOT NULL UNIQUE,
  user_id uuid NOT NULL,
  product_id uuid REFERENCES public.recharge_products(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  credits integer NOT NULL,
  amount integer NOT NULL,                           -- cents
  channel text NOT NULL CHECK (channel IN ('wechat','alipay')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','expired','failed')),
  qr_url text,
  wap_url text,
  trade_order_id text,
  paid_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_payment_orders_user ON public.payment_orders(user_id, created_at DESC);
GRANT SELECT ON public.payment_orders TO authenticated;
GRANT ALL ON public.payment_orders TO service_role;
ALTER TABLE public.payment_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users read own orders" ON public.payment_orders FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- credit recharge helper (service_role bypasses RLS, but we keep an atomic fn)
CREATE OR REPLACE FUNCTION public.recharge_add_credits(_user_id uuid, _delta integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE new_val integer;
BEGIN
  UPDATE public.profiles SET credits = credits + _delta
   WHERE id = _user_id
   RETURNING credits INTO new_val;
  RETURN new_val;
END;
$$;
