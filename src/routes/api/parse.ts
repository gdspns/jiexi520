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

function pickRefererForSource(url: string): string {
  const u = url.toLowerCase();
  if (u.includes("tiktok.com")) return "https://www.tiktok.com/";
  if (u.includes("youtube.com") || u.includes("youtu.be")) return "https://www.youtube.com/";
  if (u.includes("instagram.com")) return "https://www.instagram.com/";
  if (u.includes("facebook.com")) return "https://www.facebook.com/";
  if (u.includes("twitter.com") || u.includes("x.com")) return "https://twitter.com/";
  if (u.includes("vimeo.com")) return "https://vimeo.com/";
  return "https://www.google.com/";
}

function isLoginCookieRequired(message: string): boolean {
  return /log in for access|cookies? for the authentication|requires authentication|login required|not comfortable/i.test(
    message,
  );
}

function platformKey(url: string): "TIKTOK" | "YOUTUBE" | "INSTAGRAM" | "FACEBOOK" | "TWITTER" | "VIMEO" | "" {
  const u = url.toLowerCase();
  if (u.includes("tiktok.com")) return "TIKTOK";
  if (u.includes("youtube.com") || u.includes("youtu.be")) return "YOUTUBE";
  if (u.includes("instagram.com")) return "INSTAGRAM";
  if (u.includes("facebook.com") || u.includes("fb.watch")) return "FACEBOOK";
  if (u.includes("twitter.com") || u.includes("x.com")) return "TWITTER";
  if (u.includes("vimeo.com")) return "VIMEO";
  return "";
}

async function buildCookieArgSets(prefix: string): Promise<{ name: string; extra: string[] }[]> {
  const sets: { name: string; extra: string[] }[] = [];
  if (!prefix) return sets;
  const cookieFile = process.env[`${prefix}_COOKIES_FILE`] || process.env.YTDLP_COOKIES_FILE;
  const cookieHeader = process.env[`${prefix}_COOKIE_HEADER`] || process.env[`${prefix}_COOKIES_HEADER`];
  const cookieText = process.env[`${prefix}_COOKIES`];
  const cookieB64 = process.env[`${prefix}_COOKIES_B64`];

  if (cookieFile) sets.push({ name: "cookies-file", extra: ["--cookies", cookieFile] });
  if (cookieHeader) sets.push({ name: "cookie-header", extra: ["--add-header", `cookie:${cookieHeader}`] });
  if (cookieText || cookieB64) {
    const content = cookieB64
      ? Buffer.from(cookieB64, "base64").toString("utf8")
      : String(cookieText || "").replace(/\\n/g, "\n");
    const fs = await import("node:fs/promises");
    const path = `/tmp/${prefix.toLowerCase()}-cookies.txt`;
    await fs.writeFile(path, content, { mode: 0o600 });
    sets.push({ name: "cookies-secret", extra: ["--cookies", path] });
  }
  return sets;
}

function redactSensitive(input: unknown, proxy = "") {
  let text = String(input || "");
  if (proxy) text = text.replaceAll(proxy, "[proxy]");
  for (const p of ["TIKTOK", "YOUTUBE", "INSTAGRAM", "FACEBOOK", "TWITTER", "VIMEO"]) {
    const h = process.env[`${p}_COOKIE_HEADER`] || process.env[`${p}_COOKIES_HEADER`];
    if (h) text = text.replaceAll(h, `[${p.toLowerCase()}-cookie]`);
  }
  return text;
}

function buildPlatformStrategies(
  platform: ReturnType<typeof platformKey>,
  UA_DESKTOP: string,
  UA_MOBILE: string,
): { name: string; extra: string[] }[] {
  if (platform === "TIKTOK") {
    return [
      { name: "tiktok-default", extra: ["--add-header", `user-agent:${UA_DESKTOP}`] },
      { name: "tiktok-api-useast1a", extra: ["--add-header", `user-agent:${UA_DESKTOP}`, "--extractor-args", "tiktok:api_hostname=api22-normal-c-useast1a.tiktokv.com"] },
      { name: "tiktok-api-useast2a", extra: ["--add-header", `user-agent:${UA_DESKTOP}`, "--extractor-args", "tiktok:api_hostname=api16-normal-c-useast2a.tiktokv.com"] },
      { name: "tiktok-mobile-ua", extra: ["--add-header", `user-agent:${UA_MOBILE}`, "--extractor-args", "tiktok:app_name=trill;app_version=34.1.2;manifest_app_version=2023401020"] },
      { name: "tiktok-webpage", extra: ["--add-header", `user-agent:${UA_DESKTOP}`, "--extractor-args", "tiktok:webpage_url_basename=video"] },
    ];
  }
  if (platform === "YOUTUBE") {
    return [
      { name: "yt-default", extra: ["--add-header", `user-agent:${UA_DESKTOP}`] },
      { name: "yt-android", extra: ["--add-header", `user-agent:${UA_MOBILE}`, "--extractor-args", "youtube:player_client=android"] },
      { name: "yt-ios", extra: ["--add-header", `user-agent:${UA_MOBILE}`, "--extractor-args", "youtube:player_client=ios"] },
      { name: "yt-web", extra: ["--add-header", `user-agent:${UA_DESKTOP}`, "--extractor-args", "youtube:player_client=web"] },
      { name: "yt-tv", extra: ["--add-header", `user-agent:${UA_DESKTOP}`, "--extractor-args", "youtube:player_client=tv_embedded"] },
    ];
  }
  if (platform === "INSTAGRAM") {
    return [
      { name: "ig-default", extra: ["--add-header", `user-agent:${UA_DESKTOP}`] },
      { name: "ig-mobile", extra: ["--add-header", `user-agent:${UA_MOBILE}`] },
    ];
  }
  if (platform === "FACEBOOK") {
    return [
      { name: "fb-default", extra: ["--add-header", `user-agent:${UA_DESKTOP}`] },
      { name: "fb-mobile", extra: ["--add-header", `user-agent:${UA_MOBILE}`] },
    ];
  }
  if (platform === "TWITTER") {
    return [
      { name: "tw-default", extra: ["--add-header", `user-agent:${UA_DESKTOP}`] },
      { name: "tw-syndication", extra: ["--add-header", `user-agent:${UA_DESKTOP}`, "--extractor-args", "twitter:api=syndication"] },
      { name: "tw-legacy", extra: ["--add-header", `user-agent:${UA_DESKTOP}`, "--extractor-args", "twitter:legacy_api=1"] },
    ];
  }
  return [{ name: "default", extra: ["--add-header", `user-agent:${UA_DESKTOP}`] }];
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

  const { execFile } = await import("node:child_process");
  const referer = pickRefererForSource(url);
  const UA_DESKTOP =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
  const UA_MOBILE =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
  const platform = platformKey(url);

  const baseArgs = [
    "--dump-single-json",
    "--no-warnings",
    "--no-check-certificates",
    "--prefer-free-formats",
    "--socket-timeout",
    "30",
    "--retries",
    "3",
    "--geo-bypass",
    "--add-header",
    `referer:${referer}`,
  ];

  // 多策略：不同平台 / 不同视频对 extractor 的偏好不一样，按顺序重试
  const strategies = buildPlatformStrategies(platform, UA_DESKTOP, UA_MOBILE);
  const cookieArgSets = platform ? await buildCookieArgSets(platform) : [];
  const attempts = [
    ...strategies.map((strategy) => ({ name: strategy.name, extra: strategy.extra })),
    ...cookieArgSets.flatMap((cookieSet) =>
      strategies.map((strategy) => ({
        name: `${strategy.name}+${cookieSet.name}`,
        extra: [...strategy.extra, ...cookieSet.extra],
      })),
    ),
  ];

  const errors: string[] = [];
  let needsCookies = false;
  for (const strat of attempts) {
    const args = [url, ...baseArgs, ...strat.extra];
    if (proxy) args.push("--proxy", proxy);
    try {
      const { stdout } = await new Promise<{ stdout: string; stderr: string }>(
        (resolve, reject) => {
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
        },
      );
      const info: any = JSON.parse(stdout);
      return {
        title: info.title || "提取的文件",
        cover: info.thumbnail || "",
        music_url: streamUrl(url, "audio"),
        video_url: streamUrl(url, "video"),
        original_url: url,
        platform: determinePlatform(url),
      };
    } catch (e: any) {
      const raw = e?.stderr || e?.message || String(e);
      const safe = redactSensitive(raw, proxy);
      if (isLoginCookieRequired(safe)) needsCookies = true;
      console.error(`[api/parse] strategy ${strat.name} failed:`, safe.slice(0, 800));
      errors.push(`[${strat.name}] ${safe.slice(0, 400)}`);
    }
  }
  if (needsCookies && cookieArgSets.length === 0) {
    throw new Error(
      `该 ${platform || "海外"} 视频需要登录 Cookie 才能解析。请在 Zeabur 环境变量添加 ${platform}_COOKIES_B64 (推荐) 或 ${platform}_COOKIES / ${platform}_COOKIE_HEADER 后重启。`,
    );
  }
  throw new Error("海外解析失败（已尝试 " + attempts.length + " 种策略）：" + errors.join(" || ").slice(0, 1500));
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