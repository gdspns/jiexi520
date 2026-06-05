import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createXunhupayOrder, type Channel, type XunhupayConfig } from "@/lib/xunhupay.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function genOrderNo() {
  const t = Date.now().toString();
  const r = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `LV${t}${r}`;
}

const Schema = z.object({
  product_id: z.string().uuid(),
  channel: z.enum(["wechat", "alipay"]),
});

export const Route = createFileRoute("/api/recharge/create")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        try {
          const authHeader = request.headers.get("authorization") || "";
          const token = authHeader.replace(/^Bearer\s+/i, "");
          if (!token) return json({ error: "未登录" }, 401);

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: userRes, error: userErr } = await supabaseAdmin.auth.getUser(token);
          if (userErr || !userRes.user) return json({ error: "登录已过期" }, 401);
          const user = userRes.user;

          // 检查封禁
          const { data: profile } = await supabaseAdmin
            .from("profiles")
            .select("banned")
            .eq("id", user.id)
            .maybeSingle();
          if (profile?.banned) return json({ error: "账号已被封禁" }, 403);

          const body = await request.json().catch(() => ({}));
          const parsed = Schema.safeParse(body);
          if (!parsed.success) return json({ error: "参数错误" }, 400);
          const { product_id, channel } = parsed.data;

          const { data: product, error: pErr } = await supabaseAdmin
            .from("recharge_products")
            .select("*")
            .eq("id", product_id)
            .eq("enabled", true)
            .maybeSingle();
          if (pErr) return json({ error: pErr.message }, 500);
          if (!product) return json({ error: "商品不存在或已下架" }, 404);

          const { data: cfgRow, error: cErr } = await supabaseAdmin
            .from("payment_config")
            .select("*")
            .eq("key", "default")
            .maybeSingle();
          if (cErr || !cfgRow) return json({ error: "支付未配置，请联系管理员" }, 500);
          const cfg = cfgRow as XunhupayConfig;

          const amount = product.discount_price ?? product.price;
          if (amount <= 0) return json({ error: "商品金额非法" }, 400);

          const orderNo = genOrderNo();
          const expiresAt = new Date(Date.now() + 20 * 60 * 1000).toISOString();

          // 计算 notify/return URL
          const url = new URL(request.url);
          const origin = `${url.protocol}//${url.host}`;
          const notifyUrl = `${origin}/api/public/xunhupay-notify`;
          const returnUrl = `${origin}/?recharge=${orderNo}`;

          const clientIp =
            request.headers.get("cf-connecting-ip") ||
            request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
            "";

          let upstream;
          try {
            upstream = await createXunhupayOrder({
              cfg,
              channel: channel as Channel,
              orderNo,
              amountCents: amount,
              title: product.name,
              notifyUrl,
              returnUrl,
              clientIp,
            });
          } catch (e: any) {
            return json({ error: e?.message || "下单失败" }, 502);
          }

          const { error: insErr } = await supabaseAdmin.from("payment_orders").insert({
            order_no: orderNo,
            user_id: user.id,
            product_id: product.id,
            product_name: product.name,
            credits: product.credits,
            amount,
            channel,
            status: "pending",
            qr_url: upstream.qr_url,
            wap_url: upstream.wap_url,
            expires_at: expiresAt,
          });
          if (insErr) return json({ error: insErr.message }, 500);

          return json({
            order_no: orderNo,
            qr_url: upstream.qr_url,
            wap_url: upstream.wap_url,
            expires_at: expiresAt,
            amount,
            credits: product.credits,
            product_name: product.name,
            channel,
          });
        } catch (e: any) {
          return json({ error: e?.message || "服务器错误" }, 500);
        }
      },
    },
  },
});