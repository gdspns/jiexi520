import { createFileRoute } from "@tanstack/react-router";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Range, Content-Type",
  "Access-Control-Expose-Headers":
    "Content-Length, Content-Range, Accept-Ranges, Content-Type, Content-Disposition",
};

function attachmentName(name: string | null, fallback: string) {
  const cleaned = (name || fallback).replace(/[\\/"\r\n]/g, "").trim().slice(0, 120) || fallback;
  const ascii = cleaned.replace(/[^\x20-\x7E]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(cleaned)}`;
}

function isSupportedSource(url: string) {
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
): { name: string; ua: string; extractor?: string }[] {
  if (platform === "TIKTOK") {
    return [
      { name: "tiktok-default", ua: UA_DESKTOP },
      { name: "tiktok-api-useast1a", ua: UA_DESKTOP, extractor: "tiktok:api_hostname=api22-normal-c-useast1a.tiktokv.com" },
      { name: "tiktok-api-useast2a", ua: UA_DESKTOP, extractor: "tiktok:api_hostname=api16-normal-c-useast2a.tiktokv.com" },
      { name: "tiktok-mobile-ua", ua: UA_MOBILE, extractor: "tiktok:app_name=trill;app_version=34.1.2;manifest_app_version=2023401020" },
      { name: "tiktok-webpage", ua: UA_DESKTOP, extractor: "tiktok:webpage_url_basename=video" },
    ];
  }
  if (platform === "YOUTUBE") {
    return [
      { name: "yt-default", ua: UA_DESKTOP },
      { name: "yt-android", ua: UA_MOBILE, extractor: "youtube:player_client=android" },
      { name: "yt-ios", ua: UA_MOBILE, extractor: "youtube:player_client=ios" },
      { name: "yt-web", ua: UA_DESKTOP, extractor: "youtube:player_client=web" },
      { name: "yt-tv", ua: UA_DESKTOP, extractor: "youtube:player_client=tv_embedded" },
    ];
  }
  if (platform === "INSTAGRAM") {
    return [
      { name: "ig-default", ua: UA_DESKTOP },
      { name: "ig-mobile", ua: UA_MOBILE },
    ];
  }
  if (platform === "FACEBOOK") {
    return [
      { name: "fb-default", ua: UA_DESKTOP },
      { name: "fb-mobile", ua: UA_MOBILE },
    ];
  }
  if (platform === "TWITTER") {
    return [
      { name: "tw-default", ua: UA_DESKTOP },
      { name: "tw-syndication", ua: UA_DESKTOP, extractor: "twitter:api=syndication" },
      { name: "tw-legacy", ua: UA_DESKTOP, extractor: "twitter:legacy_api=1" },
    ];
  }
  return [{ name: "default", ua: UA_DESKTOP }];
}

async function readProxySetting() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return "";
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data } = await sb.from("app_settings").select("value").eq("key", "api_proxy").maybeSingle();
    return typeof data?.value === "string" ? data.value : data?.value == null ? "" : String(data.value);
  } catch (err) {
    console.error("[api/media-stream] failed to read proxy setting", err);
    return "";
  }
}

async function handle(request: Request): Promise<Response> {
  const reqUrl = new URL(request.url);
  const target = (reqUrl.searchParams.get("url") || "").trim();
  const type = reqUrl.searchParams.get("type") === "audio" ? "audio" : "video";
  const shouldDownload = reqUrl.searchParams.get("download") === "1";
  const filename = reqUrl.searchParams.get("filename");
  if (!/^https?:\/\//i.test(target) || target.length > 1000 || !isSupportedSource(target)) {
    return new Response("Invalid url", { status: 400, headers: CORS });
  }

  const configuredPath = process.env.YOUTUBE_DL_PATH || "/usr/local/bin/yt-dlp";
  try {
    const fs = await import("node:fs");
    fs.accessSync(configuredPath, fs.constants.X_OK);
  } catch {
    return new Response("yt-dlp is unavailable", { status: 500, headers: CORS });
  }

  if (request.method === "HEAD") {
    const headers = new Headers(CORS);
    headers.set("Content-Type", type === "audio" ? "audio/mp4" : "video/mp4");
    headers.set("Cache-Control", "no-store");
    headers.set("Accept-Ranges", "none");
    if (shouldDownload) headers.set("Content-Disposition", attachmentName(filename, type === "audio" ? "audio.m4a" : "video.mp4"));
    return new Response(null, { status: 200, headers });
  }

  const { spawn } = await import("node:child_process");
  const proxy = await readProxySetting();
  const referer = pickRefererForSource(target);
  const format =
    type === "audio" ? "bestaudio[ext=m4a]/bestaudio/best[ext=mp4]/best" : "best[ext=mp4]/best";
  const UA_DESKTOP =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
  const UA_MOBILE =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
  const platform = platformKey(target);
  console.log(
    `[api/media-stream] parse start proxy=${proxy ? "on" : "off"} platform=${platform || "unknown"} type=${type}`,
  );
  const strategies = buildPlatformStrategies(platform, UA_DESKTOP, UA_MOBILE);
  const cookieArgSets = platform ? await buildCookieArgSets(platform) : [];
  const attempts = [
    ...strategies.map((strategy) => ({ ...strategy, extra: [] as string[] })),
    ...cookieArgSets.flatMap((cookieSet) =>
      strategies.map((strategy) => ({
        ...strategy,
        name: `${strategy.name}+${cookieSet.name}`,
        extra: cookieSet.extra,
      })),
    ),
  ];

  // 先用 --simulate 探测哪个策略能取到媒体，再用同样参数拉流，避免响应头已发送但拉流失败
  const { execFile } = await import("node:child_process");
  let chosen: typeof attempts[number] | null = null;
  let lastErr = "";
  let needsCookies = false;
  for (const s of attempts) {
    const probeArgs = [
      "-f", format,
      "--simulate", "--get-url",
      "--no-warnings", "--no-check-certificates",
      "--socket-timeout", "20",
      "--geo-bypass",
      "--add-header", `referer:${referer}`,
      "--add-header", `user-agent:${s.ua}`,
    ];
    if (s.extractor) probeArgs.push("--extractor-args", s.extractor);
    probeArgs.push(...s.extra);
    if (proxy) probeArgs.push("--proxy", proxy);
    probeArgs.push(target);
    try {
      await new Promise<void>((resolve, reject) => {
        execFile(
          configuredPath,
          probeArgs,
          { encoding: "utf8", timeout: 25_000, maxBuffer: 4 * 1024 * 1024,
            env: { ...process.env, PYTHONIOENCODING: "utf-8" } },
          (error, stdout, stderr) => {
            if (error) { lastErr = redactSensitive(stderr || error.message, proxy); reject(error); return; }
            if (!String(stdout || "").trim()) { lastErr = "empty url"; reject(new Error("empty")); return; }
            resolve();
          },
        );
      });
      chosen = s;
      break;
    } catch {
      if (isLoginCookieRequired(lastErr)) needsCookies = true;
      console.error(`[api/media-stream] strategy ${s.name} failed:`, lastErr.slice(0, 800));
    }
  }
  if (!chosen) {
    if (needsCookies && cookieArgSets.length === 0) {
      return new Response(`${platform || "Platform"} login cookies required`, { status: 502, headers: CORS });
    }
    console.error("[api/media-stream] all strategies failed", lastErr.slice(0, 800));
    return new Response("stream unavailable", { status: 502, headers: CORS });
  }

  const args = [
    "-f", format,
    "--no-warnings", "--no-check-certificates",
    "--socket-timeout", "30",
    "--retries", "3",
    "--geo-bypass",
    "--add-header", `referer:${referer}`,
    "--add-header", `user-agent:${chosen.ua}`,
  ];
  if (chosen.extractor) args.push("--extractor-args", chosen.extractor);
  args.push(...chosen.extra);
  if (proxy) args.push("--proxy", proxy);
  args.push("-o", "-", target);

  const child = spawn(configuredPath, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
    if (stderr.length > 2000) stderr = stderr.slice(-2000);
  });

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      child.stdout.on("data", (chunk) => controller.enqueue(new Uint8Array(chunk)));
      child.stdout.on("end", () => controller.close());
      child.stdout.on("error", (err) => controller.error(err));
      child.on("error", (err) => controller.error(err));
      child.on("close", (code) => {
        if (code && code !== 0) console.error("[api/media-stream] yt-dlp failed", stderr);
      });
    },
    cancel() {
      child.kill("SIGTERM");
    },
  });

  const headers = new Headers(CORS);
  headers.set("Content-Type", type === "audio" ? "audio/mp4" : "video/mp4");
  headers.set("Cache-Control", "no-store");
  headers.set("Accept-Ranges", "none");
  if (shouldDownload) headers.set("Content-Disposition", attachmentName(filename, type === "audio" ? "audio.m4a" : "video.mp4"));
  return new Response(body, { status: 200, headers });
}

export const Route = createFileRoute("/api/public/media-stream")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => handle(request),
      HEAD: async ({ request }) => handle(request),
    },
  },
});