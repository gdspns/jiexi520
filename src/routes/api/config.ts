import { createFileRoute } from "@tanstack/react-router";

const DEFAULT_ENDPOINT = "https://v3.alapi.cn/api/video/url";
const DEFAULT_TOKEN = "jerv9kslg8kiuxute89fizcl06m5e1";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

async function handle(request: Request): Promise<Response> {
  const auth = request.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) {
    return new Response(JSON.stringify({ error: "未登录" }), {
      status: 401,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
  const token = m[1];

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
  if (userErr || !userData.user) {
    return new Response(JSON.stringify({ error: "登录无效" }), {
      status: 401,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const { data, error } = await supabaseAdmin
    .from("app_settings")
    .select("key,value")
    .in("key", ["api_endpoint", "api_token"]);
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
  const map = new Map((data ?? []).map((r: any) => [r.key, r.value]));
  const norm = (v: any, d: string) =>
    typeof v === "string" ? v : v == null ? d : String(v);
  return new Response(
    JSON.stringify({
      endpoint: norm(map.get("api_endpoint"), DEFAULT_ENDPOINT),
      token: norm(map.get("api_token"), DEFAULT_TOKEN),
    }),
    {
      status: 200,
      headers: {
        ...CORS,
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    },
  );
}

export const Route = createFileRoute("/api/config")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => handle(request),
    },
  },
});