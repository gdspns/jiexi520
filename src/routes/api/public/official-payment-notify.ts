import { createFileRoute } from "@tanstack/react-router";

/**
 * 官方支付异步通知（支付宝 / 微信 v3 共用）
 *
 * 注意：这只是「到账」的其中一条路径。即使这里收不到通知（CDN 拦截、签名不匹配、
 * 公网不可达等），订单状态接口里的主动查单也会在几秒内把订单补成已支付。
 */
async function fulfill(orderNo: string, amountCents: number, tradeId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: order } = await supabaseAdmin.from("payment_orders").select("*").eq("order_no", orderNo).maybeSingle();
  if (!order) return new Response("order not found", { status: 404 });
  if (order.status === "paid") return new Response("success");
  if (order.provider !== "official") {
    console.error("[official-payment-notify] provider mismatch", { orderNo, provider: order.provider });
    return new Response("order mismatch", { status: 400 });
  }
  if (Math.round(Number(order.amount)) !== Math.round(amountCents)) {
    console.error("[official-payment-notify] amount mismatch", { orderNo, expect: order.amount, got: amountCents });
    return new Response("order mismatch", { status: 400 });
  }
  const { markOfficialOrderPaid } = await import("@/lib/official-reconcile.server");
  try {
    await markOfficialOrderPaid(orderNo, tradeId);
  } catch (error: any) {
    console.error("[official-payment-notify] mark paid failed", { orderNo, message: error?.message });
    return new Response("db error", { status: 500 });
  }
  return new Response("success");
}

export const Route = createFileRoute("/api/public/official-payment-notify")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { decryptWechatResource, verifyAlipayCallback, verifyWechatCallback } = await import("@/lib/official-payment.server");
          const { data: cfg } = await supabaseAdmin.from("payment_config").select("*").eq("key", "default").maybeSingle();
          if (!cfg) return new Response("config missing", { status: 500 });

          const raw = await request.text();
          // channel 优先取 URL 参数；某些网关会截断 query，这里按报文特征兜底识别
          let channel = new URL(request.url).searchParams.get("channel");
          const looksLikeWechat = raw.trim().startsWith("{") && raw.includes("\"resource\"");
          if (!channel) channel = looksLikeWechat ? "wechat" : "alipay";

          if (channel === "alipay") {
            const params: Record<string, string> = {};
            new URLSearchParams(raw).forEach((v, k) => (params[k] = v));
            const publicKey = (cfg as any).official_alipay_public_key || "";
            const verified = verifyAlipayCallback(params, publicKey);
            if (!verified) {
              console.error("[official-payment-notify] alipay sign verify failed", {
                orderNo: params.out_trade_no,
                signType: params.sign_type,
                hasPublicKey: Boolean(publicKey),
                appIdMatch: params.app_id === (cfg as any).official_alipay_app_id,
              });
              return new Response("failure", { status: 401 });
            }
            if (params.app_id !== (cfg as any).official_alipay_app_id) {
              console.error("[official-payment-notify] alipay app_id mismatch", { got: params.app_id });
              return new Response("failure", { status: 401 });
            }
            if (!["TRADE_SUCCESS", "TRADE_FINISHED"].includes(params.trade_status || "")) {
              return new Response("success"); // 非成功状态直接确认，避免无意义重试
            }
            return fulfill(params.out_trade_no || "", Math.round(Number(params.total_amount || 0) * 100), params.trade_no || "");
          }

          if (channel === "wechat") {
            const publicKey = (cfg as any).official_wechat_platform_public_key || "";
            if (!verifyWechatCallback(raw, request.headers, publicKey)) {
              console.error("[official-payment-notify] wechat sign verify failed", { hasPublicKey: Boolean(publicKey) });
              return Response.json({ code: "FAIL", message: "签名失败" }, { status: 401 });
            }
            const tx = decryptWechatResource(JSON.parse(raw).resource, (cfg as any).official_wechat_api_v3_key || "");
            // 退款/其他事件不带 out_trade_no，直接确认收到，避免微信持续重推 24 小时
            if (!tx.out_trade_no) return Response.json({ code: "SUCCESS", message: "成功" });
            if (tx.trade_state !== "SUCCESS" || tx.mchid !== (cfg as any).official_wechat_mch_id || tx.appid !== (cfg as any).official_wechat_app_id) {
              console.error("[official-payment-notify] wechat trade invalid", { orderNo: tx.out_trade_no, state: tx.trade_state });
              return Response.json({ code: "FAIL", message: "交易无效" }, { status: 400 });
            }
            const result = await fulfill(tx.out_trade_no || "", Number(tx.amount?.total || 0), tx.transaction_id || "");
            return result.ok ? Response.json({ code: "SUCCESS", message: "成功" }) : result;
          }

          return new Response("invalid channel", { status: 400 });
        } catch (error) {
          console.error("[official-payment-notify]", error);
          return new Response("error", { status: 500 });
        }
      },
      GET: async () => new Response("official payment notify endpoint"),
    },
  },
});
