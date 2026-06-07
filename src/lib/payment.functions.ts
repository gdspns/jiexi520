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

export const getPaymentConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("payment_config")
      .select("*")
      .eq("key", "default")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data || {
      wechat_appid: "", wechat_appsecret: "", wechat_enabled: false,
      alipay_appid: "", alipay_appsecret: "", alipay_enabled: false,
      api_endpoint: "https://api.xunhupay.com/payment/do.html",
      notify_base_url: "",
    };
  });

export const setPaymentConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      wechat_appid: z.string().trim().max(64),
      wechat_appsecret: z.string().trim().max(128),
      wechat_enabled: z.boolean(),
      alipay_appid: z.string().trim().max(64),
      alipay_appsecret: z.string().trim().max(128),
      alipay_enabled: z.boolean(),
      api_endpoint: z.string().trim().url().max(300),
      notify_base_url: z.string().trim().max(300).refine(
        (v) => v === "" || /^https?:\/\//i.test(v),
        "回调域名必须以 http(s):// 开头或留空",
      ),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("payment_config")
      .upsert({ key: "default", ...data, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listProductsAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("recharge_products")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return data || [];
  });

export const upsertProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      id: z.string().uuid().optional(),
      name: z.string().trim().min(1).max(80),
      price: z.number().int().min(0).max(100000000),
      credits: z.number().int().min(0).max(1000000),
      discount_price: z.number().int().min(0).max(100000000).nullable().optional(),
      enabled: z.boolean(),
      sort_order: z.number().int().min(0).max(10000).default(0),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const payload: any = {
      name: data.name,
      price: data.price,
      credits: data.credits,
      discount_price: data.discount_price ?? null,
      enabled: data.enabled,
      sort_order: data.sort_order ?? 0,
    };
    if (data.id) {
      const { error } = await supabaseAdmin
        .from("recharge_products")
        .update(payload)
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: row, error } = await supabaseAdmin
      .from("recharge_products")
      .insert(payload)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const deleteProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("recharge_products")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listOrdersAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("payment_orders")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return data || [];
  });

export const deleteOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("payment_orders")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });