/**
 * 官方支付对账（兜底确认）
 *
 * 官方支付宝「当面付」(alipay.trade.precreate) 没有 return_url，付完不会跳回浏览器；
 * 官方微信 Native 同样只靠异步通知。一旦 notify_url 被 CDN 拦截、签名校验失败或
 * 用户网络抖动丢失通知，订单就会一直停在 pending，用户付了钱却不到账、页面也不跳转。
 *
 * 这里提供「主动查单」：前端轮询订单状态时，服务端顺手向支付宝/微信查一次真实支付结果，
 * 查到已支付就直接落库 + 加次数，完全不依赖异步通知是否可达。
 * 只在 provider='official' 时生效，虎皮椒（xunhu）链路一行都不碰。
 */

type OrderRow = {
  order_no: string;
  user_id: string;
  credits: number;
  amount: number;
  channel: string;
  provider: string;
  status: string;
};

/** 同一订单的查单节流，避免 3 秒轮询把上游打爆（多实例部署时各自独立，可接受） */
const lastQueryAt = new Map<string, number>();
const QUERY_INTERVAL_MS = 4000;

export async function markOfficialOrderPaid(orderNo: string, tradeId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: updated, error } = await supabaseAdmin
    .from("payment_orders")
    .update({ status: "paid", paid_at: new Date().toISOString(), trade_order_id: tradeId || null })
    .eq("order_no", orderNo)
    .eq("status", "pending")
    .select("id,user_id,credits");
  if (error) throw new Error(error.message);
  if (!updated?.length) return false; // 已被异步通知处理过，幂等返回
  await supabaseAdmin.rpc("recharge_add_credits", {
    _user_id: updated[0].user_id,
    _delta: updated[0].credits,
  });
  // 拉新加码：被邀请人首次充值，额外奖励邀请人（失败不影响到账）
  const { grantInviteRechargeBonus } = await import("@/lib/invite-bonus.server");
  await grantInviteRechargeBonus(updated[0].user_id);
  console.log("[official-reconcile] order paid", { orderNo, tradeId });
  return true;
}

export type ReconcileResult = {
  checked: boolean;
  paid: boolean;
  reason: string;
};

/**
 * 主动查单并落库。只有 status=pending 的官方订单才会真正发起查询。
 * 任何异常都被吞掉（返回 checked=false），不能影响订单状态接口本身。
 */
export async function reconcileOfficialOrder(orderNo: string): Promise<ReconcileResult> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: order } = await supabaseAdmin
      .from("payment_orders")
      .select("order_no,user_id,credits,amount,channel,provider,status")
      .eq("order_no", orderNo)
      .maybeSingle() as { data: OrderRow | null };
    if (!order || order.status !== "pending" || order.provider !== "official") {
      return { checked: false, paid: false, reason: "skipped" };
    }

    const last = lastQueryAt.get(orderNo) || 0;
    if (Date.now() - last < QUERY_INTERVAL_MS) {
      return { checked: false, paid: false, reason: "throttled" };
    }
    lastQueryAt.set(orderNo, Date.now());

    const { data: cfg } = await supabaseAdmin
      .from("payment_config")
      .select("*")
      .eq("key", "default")
      .maybeSingle();
    if (!cfg) return { checked: false, paid: false, reason: "config missing" };

    const { queryOfficialAlipay, queryOfficialWechat } = await import("@/lib/official-payment.server");
    const result = order.channel === "alipay"
      ? await queryOfficialAlipay(cfg as any, orderNo)
      : await queryOfficialWechat(cfg as any, orderNo);

    if (!result.paid) {
      return { checked: true, paid: false, reason: result.reason };
    }
    // 金额必须完全一致（分），防止改价/串单
    if (Math.round(Number(order.amount)) !== Math.round(Number(result.amountCents))) {
      console.error("[official-reconcile] amount mismatch", { orderNo, expect: order.amount, got: result.amountCents });
      return { checked: true, paid: false, reason: "amount mismatch" };
    }
    const ok = await markOfficialOrderPaid(orderNo, result.tradeId);
    return { checked: true, paid: true, reason: ok ? "paid" : "already paid" };
  } catch (error: any) {
    console.error("[official-reconcile] failed", { orderNo, message: error?.message });
    return { checked: false, paid: false, reason: error?.message || "error" };
  }
}
