import { createFileRoute } from "@tanstack/react-router";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Range, Content-Type",
  "Access-Control-Expose-Headers":
    "Content-Length, Content-Range, Accept-Ranges, Content-Type, Content-Disposition",
};

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

async function buildTikTokCookieArgSets(): Promise<{ name: string; extra: string[] }[]> {
  const sets: { name: string; extra: string[] }[] = [];
  const cookieFile = process.env.TIKTOK_COOKIES_FILE || process.env.YTDLP_COOKIES_FILE;
  const cookieHeader = process.env.TIKTOK_COOKIE_HEADER || process.env.TIKTOK_COOKIES_HEADER;
  const cookieText = process.env.TIKTOK_COOKIES;
  const cookieB64 = process.env.TIKTOK_COOKIES_B64;

  if (cookieFile) sets.push({ name: "cookies-file", extra: ["--cookies", cookieFile] });
  if (cookieHeader) sets.push({ name: "cookie-header", extra: ["--add-header", `cookie:${cookieHeader}`] });
  if (cookieText || cookieB64) {
    const content = cookieB64
      ? Buffer.from(cookieB64, "base64").toString("utf8")
      : String(cookieText || "").replace(/\\n/g, "\n");
    const fs = await import("node:fs/promises");
    const path = "/tmp/tiktok-cookies.txt";
    await fs.writeFile(path, content, { mode: 0o600 });
    sets.push({ name: "cookies-secret", extra: ["--cookies", path] });
  }
  return sets;
}

function redactSensitive(input: unknown, proxy = "") {
  let text = String(input || "");
  if (proxy) text = text.replaceAll(proxy, "[proxy]");
  const cookieHeader = process.env.TIKTOK_COOKIE_HEADER || process.env.TIKTOK_COOKIES_HEADER;
  if (cookieHeader) text = text.replaceAll(cookieHeader, "[tiktok-cookie]");
  return text;
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
  const isTikTok = /tiktok\.com/i.test(target);

  // 与 parse.ts 保持一致的多策略，确保解析成功的链接也能成功流式下载
  const strategies: { ua: string; extractor?: string }[] = isTikTok
    ? [
        { ua: UA_DESKTOP },
        { ua: UA_DESKTOP, extractor: "tiktok:api_hostname=api22-normal-c-useast1a.tiktokv.com" },
        { ua: UA_DESKTOP, extractor: "tiktok:api_hostname=api16-normal-c-useast2a.tiktokv.com" },
        { ua: UA_MOBILE, extractor: "tiktok:app_name=trill;app_version=34.1.2;manifest_app_version=2023401020" },
        { ua: UA_DESKTOP, extractor: "tiktok:webpage_url_basename=video" },
      ]
    : [{ ua: UA_DESKTOP }];

  // 先用 --simulate 探测哪个策略能取到媒体，再用同样参数拉流，避免响应头已发送但拉流失败
  const { execFile } = await import("node:child_process");
  let chosen: typeof strategies[number] | null = null;
  let lastErr = "";
  for (const s of strategies) {
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
            if (error) { lastErr = String(stderr || error.message); reject(error); return; }
            if (!String(stdout || "").trim()) { lastErr = "empty url"; reject(new Error("empty")); return; }
            resolve();
          },
        );
      });
      chosen = s;
      break;
    } catch {
      // try next
    }
  }
  if (!chosen) {
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