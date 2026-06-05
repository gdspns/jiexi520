import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [{ data: profile }, { data: roles }] = await Promise.all([
    supabaseAdmin.from("profiles").select("email").eq("id", userId).maybeSingle(),
    supabaseAdmin.from("user_roles").select("role").eq("user_id", userId),
  ]);
  const isAdminEmail = profile?.email === "3075554556@qq.com";
  const hasAdminRole = roles?.some((r) => r.role === "admin") === true;
  if (!isAdminEmail && !hasAdminRole) throw new Error("无权限");
  return supabaseAdmin;
}

export const listUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const supabaseAdmin = await assertAdmin(userId);

    const { data: profiles, error } = await supabaseAdmin
      .from("profiles")
      .select("id, email, banned, credits, created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const { data: roles, error: rolesError } = await supabaseAdmin
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
    const { userId } = context;
    const supabaseAdmin = await assertAdmin(userId);
    if (data.userId === userId) throw new Error("不能封禁自己");

    const { error: aErr } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      ban_duration: data.banned ? "876000h" : "none",
    });
    if (aErr) throw new Error(aErr.message);

    const { error: pErr } = await supabaseAdmin
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
    const { userId } = context;
    const supabaseAdmin = await assertAdmin(userId);
    if (data.userId === userId) throw new Error("不能删除自己");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adjustCredits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ userId: z.string().uuid(), delta: z.number().int() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const supabaseAdmin = await assertAdmin(userId);
    const { data: current, error: readError } = await supabaseAdmin
      .from("profiles")
      .select("credits")
      .eq("id", data.userId)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!current) throw new Error("用户不存在");
    const nextCredits = Math.max(0, Number(current.credits ?? 0) + data.delta);
    const { error } = await supabaseAdmin
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