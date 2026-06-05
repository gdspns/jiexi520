import { createFileRoute } from "@tanstack/react-router";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const Route = createFileRoute("/api/recharge/status")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => {
        const authHeader = request.headers.get("authorization") || "";
        const token = authHeader.replace(/^Bearer\s+/i, "");
        if (!token) return json({ error: "未登录" }, 401);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: userRes, error: userErr } = await supabaseAdmin.auth.getUser(token);
        if (userErr || !userRes.user) return json({ error: "登录已过期" }, 401);

        const url = new URL(request.url);
        const orderNo = url.searchParams.get("order_no");
        if (!orderNo) return json({ error: "缺少 order_no" }, 400);

        const { data: order, error } = await supabaseAdmin
          .from("payment_orders")
          .select("order_no,status,credits,amount,channel,expires_at,paid_at,product_name,qr_url,wap_url")
          .eq("order_no", orderNo)
          .eq("user_id", userRes.user.id)
          .maybeSingle();
        if (error) return json({ error: error.message }, 500);
        if (!order) return json({ error: "订单不存在" }, 404);

        // 超时自动标记
        if (order.status === "pending" && new Date(order.expires_at).getTime() < Date.now()) {
          await supabaseAdmin
            .from("payment_orders")
            .update({ status: "expired" })
            .eq("order_no", orderNo)
            .eq("status", "pending");
          order.status = "expired";
        }

        // 同时返回最新次数
        const { data: prof } = await supabaseAdmin
          .from("profiles")
          .select("credits")
          .eq("id", userRes.user.id)
          .maybeSingle();

        return json({ order, credits: prof?.credits ?? 0 });
      },
    },
  },
});