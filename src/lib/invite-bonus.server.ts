/**
 * 拉新增值奖励：被邀请人「首次充值」成功后，给邀请人补发 N 次。
 *
 * 只允许在服务端（service_role）支付到账链路里调用；幂等由数据库函数
 * public.invite_recharge_bonus 保证（同一被邀请人只会成功一次）。
 * 任何失败都必须被吞掉，绝不能影响用户自己充值的到账。
 */
export async function grantInviteRechargeBonus(userId: string | null | undefined) {
  if (!userId) return null;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("invite_recharge_bonus", {
      p_user_id: userId,
    });
    if (error) {
      console.error("[invite-bonus] rpc failed", { userId, message: error.message });
      return null;
    }
    const result = (data || null) as { ok?: boolean; credits?: number; reason?: string } | null;
    if (result?.ok) {
      console.log("[invite-bonus] granted", { userId, credits: result.credits });
    }
    return result;
  } catch (error: any) {
    console.error("[invite-bonus] error", { userId, message: error?.message });
    return null;
  }
}
