import { createFileRoute } from "@tanstack/react-router";
import { verifySign, getCreds, type XunhupayConfig } from "@/lib/xunhupay.server";

export const Route = createFileRoute("/api/public/xunhupay-notify")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const contentType = request.headers.get("content-type") || "";
          let params: Record<string, any> = {};
          if (contentType.includes("application/json")) {
            params = await request.json();
          } else {
            const text = await request.text();
            const usp = new URLSearchParams(text);
            usp.forEach((v, k) => (params[k] = v));
          }

          const orderNo = String(params.trade_order_id || "");
          if (!orderNo) return new Response("missing trade_order_id", { status: 400 });

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: order, error: oErr } = await supabaseAdmin
            .from("payment_orders")
            .select("*")
            .eq("order_no", orderNo)
            .maybeSingle();
          if (oErr || !order) return new Response("order not found", { status: 404 });

          // 幂等
          if (order.status === "paid") return new Response("success");

          const { data: cfgRow } = await supabaseAdmin
            .from("payment_config")
            .select("*")
            .eq("key", "default")
            .maybeSingle();
          if (!cfgRow) return new Response("config missing", { status: 500 });
          const cfg = cfgRow as XunhupayConfig;
          const creds = getCreds(cfg, order.channel as "wechat" | "alipay");

          if (!verifySign(params, creds.appsecret)) {
            console.error("[xunhupay-notify] sign verify failed", { orderNo });
            return new Response("invalid sign", { status: 400 });
          }

          // 校验金额 (虎皮椒返回 total_fee 元字符串)
          const reportedYuan = Number(params.total_fee || 0);
          const expectedYuan = order.amount / 100;
          if (Math.abs(reportedYuan - expectedYuan) > 0.001) {
            console.error("[xunhupay-notify] amount mismatch", { orderNo, reportedYuan, expectedYuan });
            return new Response("amount mismatch", { status: 400 });
          }

          // 原子标记 paid (依赖 status='pending' 防止并发重复加分)
          const { data: upd, error: updErr } = await supabaseAdmin
            .from("payment_orders")
            .update({
              status: "paid",
              paid_at: new Date().toISOString(),
              trade_order_id: String(params.transaction_id || params.open_order_id || ""),
            })
            .eq("order_no", orderNo)
            .eq("status", "pending")
            .select("id,user_id,credits");
          if (updErr) {
            console.error("[xunhupay-notify] update failed", updErr);
            return new Response("db error", { status: 500 });
          }
          if (!upd || upd.length === 0) {
            // 已被其他 notify 处理
            return new Response("success");
          }

          // 加次数
          await supabaseAdmin.rpc("recharge_add_credits", {
            _user_id: order.user_id,
            _delta: order.credits,
          });

          return new Response("success");
        } catch (e: any) {
          console.error("[xunhupay-notify] error", e);
          return new Response("error", { status: 500 });
        }
      },
      GET: async () => new Response("xunhupay notify endpoint"),
    },
  },
});