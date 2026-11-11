import { createFileRoute } from "@tanstack/react-router";
import { readAlapiSyncKey, saveAlapiToken, verifyAlapiToken } from "@/lib/alapi-log.server";

// 浏览器书签调用：在 alapi.cn 任意页面点一下书签，就把当前登录态里的
// alapi_access_token 同步到本站。因为 alapi 每次打开控制台都会轮换 token，
// 这是让后台凭据保持有效最省事的方式。
//
// 鉴权靠 app_settings.alapi_sync_key（32 位随机串），不登录也能调用，
// 但密钥只在管理员后台可见；即便泄露，最坏结果也只是「ALAPI 日志看不了」。

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function handle(request: Request): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, message: "请求体非法" }, 400);
  }
  const token = String(body?.token || "").trim();
  const key = String(body?.key || "").trim();
  if (!token || !key) return json({ ok: false, message: "缺少 token 或 key" }, 400);

  const expected = await readAlapiSyncKey().catch(() => "");
  if (!expected || key !== expected) {
    return json({ ok: false, message: "同步密钥不正确，请回后台重新复制书签" }, 401);
  }

  const check = await verifyAlapiToken(token);
  if (!check.ok) return json({ ok: false, message: check.message }, 400);

  await saveAlapiToken(token);
  return json({ ok: true, message: "已同步到解析后台" });
}

export const Route = createFileRoute("/api/public/alapi-token")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => handle(request),
    },
  },
});
