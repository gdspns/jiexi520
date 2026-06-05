import { createFileRoute } from "@tanstack/react-router";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const Route = createFileRoute("/api/recharge/products")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("recharge_products")
          .select("id,name,price,credits,discount_price,sort_order")
          .eq("enabled", true)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true });
        if (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { ...CORS, "Content-Type": "application/json" },
          });
        }
        // 同时返回启用的支付渠道
        const { data: cfg } = await supabaseAdmin
          .from("payment_config")
          .select("wechat_enabled,alipay_enabled")
          .eq("key", "default")
          .maybeSingle();
        return new Response(
          JSON.stringify({
            products: data || [],
            channels: {
              wechat: !!cfg?.wechat_enabled,
              alipay: !!cfg?.alipay_enabled,
            },
          }),
          { status: 200, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } },
        );
      },
    },
  },
});