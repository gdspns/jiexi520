/**
 * Same-origin token relay for the mini program's shared account.
 * The browser or mini program only talks to this application; the server
 * performs password and refresh-token exchanges with Supabase.
 */
import { createFileRoute } from "@tanstack/react-router";

const ALLOWED_EMAILS = new Set(["464221048@qq.com"]);

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function handle(request: Request): Promise<Response> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return json({ error: "服务端未配置 Supabase 环境变量" }, 500);
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: "请求体非法" }, 400);
  }

  const grant = body?.grant === "refresh_token" ? "refresh_token" : "password";
  if (grant === "password") {
    const email = String(body?.email || "").trim().toLowerCase();
    const password = String(body?.password || "");
    if (!ALLOWED_EMAILS.has(email)) {
      return json({ error: "账号不允许通过此入口登录" }, 403);
    }
    if (!password) return json({ error: "密码不能为空" }, 400);

    const upstream = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ email, password }),
    });
    const data: any = await upstream.json().catch(() => ({}));
    if (!upstream.ok || !data.access_token) {
      return json({ error: data.msg || data.error_description || data.error || "登录失败" }, 502);
    }
    return json({
      access_token: data.access_token,
      refresh_token: data.refresh_token || "",
      expires_in: data.expires_in || 3600,
      expires_at: data.expires_at || 0,
    });
  }

  const refreshToken = String(body?.refresh_token || "");
  if (!refreshToken) return json({ error: "refresh_token 不能为空" }, 400);

  const upstream = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  const data: any = await upstream.json().catch(() => ({}));
  if (!upstream.ok || !data.access_token) {
    return json({ error: "登录已过期，请重新登录" }, 502);
  }
  return json({
    access_token: data.access_token,
    refresh_token: data.refresh_token || refreshToken,
    expires_in: data.expires_in || 3600,
    expires_at: data.expires_at || 0,
  });
}

export const Route = createFileRoute("/api/public/auth-token")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => handle(request),
    },
  },
});
