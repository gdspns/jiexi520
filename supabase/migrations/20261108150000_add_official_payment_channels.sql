ALTER TABLE public.payment_config
  ADD COLUMN IF NOT EXISTS wechat_provider text NOT NULL DEFAULT 'xunhu' CHECK (wechat_provider IN ('xunhu', 'official')),
  ADD COLUMN IF NOT EXISTS official_wechat_app_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS official_wechat_mch_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS official_wechat_serial_no text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS official_wechat_private_key text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS official_wechat_api_v3_key text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS official_wechat_platform_public_key text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS alipay_provider text NOT NULL DEFAULT 'xunhu' CHECK (alipay_provider IN ('xunhu', 'official')),
  ADD COLUMN IF NOT EXISTS official_alipay_app_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS official_alipay_private_key text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS official_alipay_public_key text NOT NULL DEFAULT '';

ALTER TABLE public.payment_orders
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'xunhu' CHECK (provider IN ('xunhu', 'official'));
