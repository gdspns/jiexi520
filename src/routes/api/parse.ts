import { createFileRoute } from "@tanstack/react-router";

const DEFAULT_ENDPOINT = "https://v3.alapi.cn/api/video/url";
const DEFAULT_TOKEN = "jerv9kslg8kiuxute89fizcl06m5e1";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function isOverseas(url: string): boolean {
  const u = url.toLowerCase();
  return (
    u.includes("tiktok.com") ||
    u.includes("youtube.com") ||
    u.includes("youtu.be") ||
    u.includes("instagram.com") ||
    u.includes("facebook.com") ||
    u.includes("twitter.com") ||
    u.includes("x.com") ||
    u.includes("vimeo.com")
  );
}

function determinePlatform(url: string): string {
  const u = url.toLowerCase();
  if (u.includes("douyin.com")) return "抖音";
  if (u.includes("xiaohongshu.com") || u.includes("xhslink.com")) return "小红书";
  if (u.includes("kuaishou.com")) return "快手";
  if (u.includes("bilibili.com") || u.includes("b23.tv")) return "B站";
  if (u.includes("tiktok.com")) return "TikTok";
  if (u.includes("youtube.com") || u.includes("youtu.be")) return "YouTube";
  if (u.includes("instagram.com")) return "Instagram";
  return "通用";
}

function streamUrl(url: string, type: "audio" | "video") {
  return `/api/public/media-stream?type=${type}&url=${encodeURIComponent(url)}`;
}

async function parseDomestic(url: string, endpoint: string, token: string) {
  const form = new FormData();
  form.append("token", token);
  form.append("url", url);
  const res = await fetch(endpoint, { method: "POST", body: form });
  if (!res.ok) throw new Error(`上游接口错误 ${res.status}`);
  const data: any = await res.json();
  if (data.code !== 200 || !data.data) throw new Error(data.msg || "解析失败");
  const d = data.data;
  const music = d.music_url || d.audio_url || d.video_url;
  if (!music) throw new Error("无有效媒体链接");
  return {
    title: d.title || "提取的文件",
    cover: d.cover || "",
    music_url: music,
    video_url: d.video_url || "",
    original_url: url,
    platform: determinePlatform(url),
  };
}

async function parseOverseas(url: string, proxy: string) {
  const configuredPath = process.env.YOUTUBE_DL_PATH || "/usr/local/bin/yt-dlp";
  try {
    const fs = await import("node:fs");
    fs.accessSync(configuredPath, fs.constants.X_OK);
  } catch (e: any) {
    throw new Error(
      `海外解析引擎 (yt-dlp) 不可用或不可执行：${configuredPath}。请确认 Zeabur 使用 Dockerfile 构建。`,
    );
  }

  try {
    const { execFile } = await import("node:child_process");
    const args = [
      url,
      "--dump-single-json",
      "--no-warnings",
      "--no-check-certificates",
      "--prefer-free-formats",
      "--socket-timeout",
      "30",
      "--add-header",
      "referer:https://www.tiktok.com/",
      "--add-header",
      "user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    ];
    if (proxy) args.push("--proxy", proxy);

    const { stdout } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      execFile(
        configuredPath,
        args,
        {
          encoding: "utf8",
          timeout: 55_000,
          maxBuffer: 20 * 1024 * 1024,
          env: { ...process.env, PYTHONIOENCODING: "utf-8" },
        },
        (error, stdout, stderr) => {
          if (error) {
            reject(Object.assign(error, { stdout, stderr }));
            return;
          }
          resolve({ stdout: String(stdout || ""), stderr: String(stderr || "") });
        },
      );
    });

    const info: any = JSON.parse(stdout);
    return {
      title: info.title || "提取的文件",
      cover: info.thumbnail || "",
      // TikTok/overseas CDN links are often signed to the server request and
      // cannot be played by the browser directly. Use a same-origin stream that
      // regenerates and pipes the media with yt-dlp for playback/download.
      music_url: streamUrl(url, "audio"),
      video_url: streamUrl(url, "video"),
      original_url: url,
      platform: determinePlatform(url),
    };
  } catch (e: any) {
    const raw = e?.stderr || e?.message || String(e);
    const safe = proxy ? String(raw).replaceAll(proxy, "[proxy]") : String(raw);
    throw new Error("海外解析失败：" + safe.slice(0, 1200));
  }
}

async function handle(request: Request): Promise<Response> {
  const auth = request.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return json({ error: "未登录" }, 401);
  const accessToken = m[1];

  const { createClient } = await import("@supabase/supabase-js");
  const userSb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await userSb.auth.getUser(accessToken);
  if (userErr || !userData.user) return json({ error: "登录无效" }, 401);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: "请求体非法" }, 400);
  }
  const url: string = (body?.url || "").toString().trim();
  if (!/^https?:\/\//i.test(url)) return json({ error: "URL 非法" }, 400);
  if (url.length > 1000) return json({ error: "URL 过长" }, 400);

  // 读取配置
  const { data: cfgRows, error: cfgError } = await userSb
    .from("app_settings")
    .select("key,value")
    .in("key", ["api_endpoint", "api_token", "api_proxy"]);
  if (cfgError) {
    console.error("[api/parse] failed to read app_settings", cfgError);
  }
  const cfgMap = new Map((cfgRows ?? []).map((r: any) => [r.key, r.value]));
  const normStr = (v: any, d: string) => (typeof v === "string" ? v : v == null ? d : String(v));
  const endpoint = normStr(cfgMap.get("api_endpoint"), DEFAULT_ENDPOINT);
  const apiToken = normStr(cfgMap.get("api_token"), DEFAULT_TOKEN);
  const proxy = normStr(cfgMap.get("api_proxy"), "");

  // 执行解析
  let result: any;
  try {
    if (isOverseas(url)) {
      result = await parseOverseas(url, proxy);
    } else {
      result = await parseDomestic(url, endpoint, apiToken);
    }
  } catch (e: any) {
    console.error("[api/parse] parse failed", {
      platform: determinePlatform(url),
      isOverseas: isOverseas(url),
      hasProxy: Boolean(proxy),
      message: e?.message || String(e),
    });
    return json({ error: e?.message || "解析失败" }, 502);
  }

  // 解析成功后扣除积分（管理员不扣）
  const { data: remaining, error: consumeErr } = await userSb.rpc("consume_credit");
  if (consumeErr) {
    return json({ error: consumeErr.message || "扣减积分失败" }, 402);
  }

  return json({ ...result, credits_remaining: remaining });
}

export const Route = createFileRoute("/api/parse")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => handle(request),
    },
  },
});