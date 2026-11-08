import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(supabase: any, userId: string) {
  const [{ data: profile }, { data: roles }, authResult] = await Promise.all([
    supabase.from("profiles").select("email").eq("id", userId).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", userId),
    supabase.auth.getUser().catch(() => ({ data: null })),
  ]);
  const authEmail = authResult?.data?.user?.email;
  const isAdminEmail = authEmail === "3075554556@qq.com" || profile?.email === "3075554556@qq.com";
  const hasAdminRole = roles?.some((r: any) => r.role === "admin") === true;
  if (!isAdminEmail && !hasAdminRole) throw new Error("无权限");
}

export const listUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const { data: profiles, error } = await supabase
      .from("profiles")
      .select("id, email, banned, credits, created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const { data: roles, error: rolesError } = await supabase
      .from("user_roles")
      .select("user_id, role");
    if (rolesError) throw new Error(rolesError.message);

    const roleMap = new Map<string, string[]>();
    roles?.forEach((r) => {
      const arr = roleMap.get(r.user_id) || [];
      arr.push(r.role);
      roleMap.set(r.user_id, arr);
    });

    return profiles.map((p) => {
      return {
        id: p.id,
        email: p.email,
        banned: p.banned,
        credits: p.credits ?? 0,
        created_at: p.created_at,
        last_sign_in_at: null,
        roles: roleMap.get(p.id) || [],
      };
    });
  });

export const setBanned = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ userId: z.string().uuid(), banned: z.boolean() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    if (data.userId === userId) throw new Error("不能封禁自己");
    const { error: pErr } = await supabase
      .from("profiles")
      .update({ banned: data.banned })
      .eq("id", data.userId);
    if (pErr) throw new Error(pErr.message);

    return { ok: true };
  });

export const deleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ userId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    if (data.userId === userId) throw new Error("不能删除自己");
    // 数据库函数内部校验管理员身份，并删除 auth.users 与关联业务数据
    const { error } = await (supabase as any).rpc("admin_delete_user", {
      target_user_id: data.userId,
    });
    if (!error) return { ok: true };
    // 兜底：数据库函数不可用时改用服务端密钥的 auth.admin 接口删除
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { error: adminError } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
      if (adminError) throw new Error(adminError.message);
      return { ok: true };
    } catch (e: any) {
      throw new Error(String(error.message || e?.message || "删除失败，请稍后重试"));
    }
  });

export const adjustCredits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ userId: z.string().uuid(), delta: z.number().int() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { data: current, error: readError } = await supabase
      .from("profiles")
      .select("credits")
      .eq("id", data.userId)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!current) throw new Error("用户不存在");
    const nextCredits = Math.max(0, Number(current.credits ?? 0) + data.delta);
    const { error } = await supabase
      .from("profiles")
      .update({ credits: nextCredits })
      .eq("id", data.userId);
    if (error) throw new Error(error.message);
    return { credits: nextCredits };
  });

export const getSignupBonus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "signup_bonus_credits")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { value: Number(data?.value ?? 10) };
  });

export const setSignupBonus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ value: z.number().int().min(0).max(100000) }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key: "signup_bonus_credits", value: data.value as any, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    return { value: data.value };
  });

const DEFAULT_API_ENDPOINT = "https://v3.alapi.cn/api/video/url";
const DEFAULT_API_TOKEN = "jerv9kslg8kiuxute89fizcl06m5e1";
const DEFAULT_API_PROXY = "";

export const getApiConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { data, error } = await supabase
      .from("app_settings")
      .select("key,value")
      .in("key", ["api_endpoint", "api_token", "api_proxy"]);
    if (error) throw new Error(error.message);
    const map = new Map((data ?? []).map((r: any) => [r.key, r.value]));
    const norm = (v: any, d: string) =>
      typeof v === "string" ? v : v == null ? d : String(v);
    return {
      endpoint: norm(map.get("api_endpoint"), DEFAULT_API_ENDPOINT),
      token: norm(map.get("api_token"), DEFAULT_API_TOKEN),
      proxy: norm(map.get("api_proxy"), DEFAULT_API_PROXY),
      defaults: {
        endpoint: DEFAULT_API_ENDPOINT,
        token: DEFAULT_API_TOKEN,
        proxy: DEFAULT_API_PROXY,
      },
    };
  });

export const setApiConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        endpoint: z.string().trim().url().max(500),
        token: z.string().trim().max(500),
        proxy: z.string().trim().max(500).default(""),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const now = new Date().toISOString();
    const { error } = await supabase.from("app_settings").upsert([
      { key: "api_endpoint", value: data.endpoint as any, updated_at: now },
      { key: "api_token", value: data.token as any, updated_at: now },
      { key: "api_proxy", value: data.proxy as any, updated_at: now },
    ]);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listParseLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { data, error } = await supabase
      .from("parse_logs")
      .select("id, platform, type, proxy_on, url, status, message, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return data || [];
  });

// ============ 拉新邀请 ============

export type InviteReportRow = {
  inviter_id: string;
  inviter_email: string | null;
  invite_code: string | null;
  invitee_count: number;
  credits_granted: number;
  credits_to_invitees: number;
  recharge_credits: number;
  recharge_count: number;
  last_invited_at: string | null;
  invitees: Array<{
    email: string | null;
    created_at: string;
    inviter_credits: number;
    invitee_credits: number;
    first_recharge_credits?: number;
    first_recharge_at?: string | null;
  }>;
};

export const getInviteReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { data, error } = await (supabase as any).rpc("admin_invite_report");
    if (error) throw new Error(error.message);
    return ((data as InviteReportRow[]) || []);
  });

export const getInviteConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { data, error } = await supabase
      .from("app_settings")
      .select("key,value")
      .in("key", ["invite_reward_inviter", "invite_reward_invitee", "invite_daily_limit", "invite_reward_recharge"]);
    if (error) throw new Error(error.message);
    const map = new Map<string, number>();
    (data ?? []).forEach((r: any) => map.set(r.key, Number(r.value)));
    const pick = (k: string, d: number) => (Number.isFinite(map.get(k)) ? (map.get(k) as number) : d);
    return {
      inviter: pick("invite_reward_inviter", 3),
      invitee: pick("invite_reward_invitee", 2),
      dailyLimit: pick("invite_daily_limit", 20),
      recharge: pick("invite_reward_recharge", 50),
    };
  });

export const setInviteRewards = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        inviter: z.number().int().min(0).max(100000),
        invitee: z.number().int().min(0).max(100000),
        dailyLimit: z.number().int().min(1).max(10000),
        recharge: z.number().int().min(0).max(100000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { error } = await (supabase as any).rpc("admin_set_invite_rewards", {
      p_inviter: data.inviter,
      p_invitee: data.invitee,
      p_daily_limit: data.dailyLimit,
      p_recharge: data.recharge,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });