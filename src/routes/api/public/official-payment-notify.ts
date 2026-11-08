import { createFileRoute } from "@tanstack/react-router";
import { decryptWechatResource, verifyAlipayCallback, verifyWechatCallback } from "@/lib/official-payment.server";

async function fulfill(orderNo: string, amountCents: number, tradeId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: order } = await supabaseAdmin.from("payment_orders").select("*").eq("order_no", orderNo).maybeSingle();
  if (!order) return new Response("order not found", { status: 404 });
  if (order.status === "paid") return new Response("success");
  if (order.provider !== "official" || Math.abs(Number(order.amount) - amountCents) > 0) return new Response("order mismatch", { status: 400 });
  const { data: updated, error } = await supabaseAdmin.from("payment_orders").update({ status: "paid", paid_at: new Date().toISOString(), trade_order_id: tradeId }).eq("order_no", orderNo).eq("status", "pending").select("id");
  if (error) return new Response("db error", { status: 500 });
  if (updated?.length) await supabaseAdmin.rpc("recharge_add_credits", { _user_id: order.user_id, _delta: order.credits });
  return new Response("success");
}

export const Route = createFileRoute("/api/public/official-payment-notify")({
  server: { handlers: { POST: async ({ request }) => {
    try {
      const channel = new URL(request.url).searchParams.get("channel");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: cfg } = await supabaseAdmin.from("payment_config").select("*").eq("key", "default").maybeSingle();
      if (!cfg) return new Response("config missing", { status: 500 });
      if (channel === "alipay") {
        const params: Record<string, string> = {}; new URLSearchParams(await request.text()).forEach((v, k) => params[k] = v);
        if (!verifyAlipayCallback(params, (cfg as any).official_alipay_public_key || "") || params.app_id !== (cfg as any).official_alipay_app_id || !["TRADE_SUCCESS", "TRADE_FINISHED"].includes(params.trade_status || "")) return new Response("failure", { status: 401 });
        return fulfill(params.out_trade_no || "", Math.round(Number(params.total_amount || 0) * 100), params.trade_no || "");
      }
      if (channel === "wechat") {
        const raw = await request.text();
        if (!verifyWechatCallback(raw, request.headers, (cfg as any).official_wechat_platform_public_key || "")) return Response.json({ code: "FAIL", message: "签名失败" }, { status: 401 });
        const tx = decryptWechatResource(JSON.parse(raw).resource, (cfg as any).official_wechat_api_v3_key || "");
        if (tx.trade_state !== "SUCCESS" || tx.mchid !== (cfg as any).official_wechat_mch_id || tx.appid !== (cfg as any).official_wechat_app_id) return Response.json({ code: "FAIL", message: "交易无效" }, { status: 400 });
        const result = await fulfill(tx.out_trade_no || "", Number(tx.amount?.total || 0), tx.transaction_id || "");
        return result.ok ? Response.json({ code: "SUCCESS", message: "成功" }) : result;
      }
      return new Response("invalid channel", { status: 400 });
    } catch (error) { console.error("[official-payment-notify]", error); return new Response("error", { status: 500 }); }
  }, GET: async () => new Response("official payment notify endpoint") } }
});
