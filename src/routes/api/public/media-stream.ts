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
    // 线上日志里成功的一直是 yt-android（web/visionOS 客户端已经不再给合并音视频的格式，
    // 只回 video only，`best[ext=mp4]` 必然报 Requested format is not available）。
    // 把它放第一位，冷启动首次解析能省掉 10~15 秒的无效探测。
    return [
      { name: "yt-android", ua: UA_MOBILE, extractor: "youtube:player_client=android" },
      { name: "yt-ios", ua: UA_MOBILE, extractor: "youtube:player_client=ios" },
      { name: "yt-tv", ua: UA_DESKTOP, extractor: "youtube:player_client=tv_embedded" },
      { name: "yt-default", ua: UA_DESKTOP },
      { name: "yt-web", ua: UA_DESKTOP, extractor: "youtube:player_client=web" },
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

// ---- 后台代理配置：带 30 秒缓存，避免每个分段请求都打一次 Supabase ----
let proxyCache: { value: string; at: number } | null = null;

async function readProxySetting(): Promise<string> {
  if (proxyCache && Date.now() - proxyCache.at < 30_000) return proxyCache.value;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return "";
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data } = await sb.from("app_settings").select("value").eq("key", "api_proxy").maybeSingle();
    const value = typeof data?.value === "string" ? data.value : data?.value == null ? "" : String(data.value);
    proxyCache = { value, at: Date.now() };
    return value;
  } catch (err) {
    console.error("[api/media-stream] failed to read proxy setting", err);
    return proxyCache?.value || "";
  }
}

function normalizeProxy(raw: string): URL | null {
  const text = (raw || "").trim();
  if (!text) return null;
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
    const u = new URL(withScheme);
    // 只有 http(s) 代理能用 CONNECT 隧道；socks5 交给 yt-dlp 自己走
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname) return null;
    return u;
  } catch {
    return null;
  }
}

// ---- 自建 CONNECT 隧道 ----
// 之前这里是 `await import("undici")` + ProxyAgent，但容器里 node_modules 只留了 tslib，
// 动态导入的裸模块名不会被 Nitro 重写，运行时必然 ERR_MODULE_NOT_FOUND，异常被 catch 吞掉，
// 于是 CDN 直链一直是「直连」出去的。而 YouTube/IG 的 googlevideo 直链带 ip=<代理IP>，
// 用服务器自己的 IP 去拉会被 403。这里改用 node 原生 CONNECT 隧道，不依赖任何第三方包。
const tunnelAgents = new Map<string, unknown>();

async function getTunnelAgent(proxyUrl: URL, secure: boolean, hostname: string, port: number): Promise<any> {
  const key = `${proxyUrl.href}|${secure ? "https" : "http"}|${hostname}:${port}`;
  const cached = tunnelAgents.get(key);
  if (cached) return cached;

  const httpMod: any = await import("node:http");
  const httpsMod: any = await import("node:https");
  const tlsMod: any = await import("node:tls");
  const proxySecure = proxyUrl.protocol === "https:";
  const proxyPort = Number(proxyUrl.port || (proxySecure ? 443 : 80));
  const auth = proxyUrl.username
    ? "Basic " +
      Buffer.from(
        `${decodeURIComponent(proxyUrl.username)}:${decodeURIComponent(proxyUrl.password)}`,
      ).toString("base64")
    : "";

  const openTunnel = () =>
    new Promise<any>((resolve, reject) => {
      const mod = proxySecure ? httpsMod : httpMod;
      const req = mod.request({
        host: proxyUrl.hostname,
        port: proxyPort,
        method: "CONNECT",
        path: `${hostname}:${port}`,
        headers: {
          Host: `${hostname}:${port}`,
          ...(auth ? { "Proxy-Authorization": auth } : {}),
        },
        timeout: 15_000,
        ...(proxySecure ? { servername: proxyUrl.hostname, rejectUnauthorized: false } : {}),
      });
      req.on("connect", (res: any, socket: any) => {
        if (res.statusCode !== 200) {
          socket.destroy();
          reject(new Error(`proxy CONNECT ${res.statusCode}`));
          return;
        }
        if (!secure) {
          resolve(socket);
          return;
        }
        const tlsSocket = tlsMod.connect({ socket, servername: hostname });
        tlsSocket.once("secureConnect", () => resolve(tlsSocket));
        tlsSocket.once("error", reject);
      });
      req.on("timeout", () => req.destroy(new Error("proxy connect timeout")));
      req.on("error", reject);
      req.end();
    });

  const AgentCtor = secure ? httpsMod.Agent : httpMod.Agent;
  // 不复用连接：代理给的是 CONNECT 隧道，长连接被代理侧掐断时不会通知前端，
  // 表现就是「读到一半卡住」。每个分段都新建隧道，代价约 0.6s，换稳定。
  const agent: any = new AgentCtor({ keepAlive: false, maxSockets: 8 });
  // 必须用回调形式：Agent 会把返回值当成 socket，返回 Promise 会导致连接错乱
  agent.createConnection = (_opts: unknown, cb: (err: Error | null, socket?: unknown) => void) => {
    openTunnel().then(
      (socket) => cb(null, socket),
      (err) => cb(err as Error),
    );
  };

  if (tunnelAgents.size > 64) tunnelAgents.clear();
  tunnelAgents.set(key, agent);
  return agent;
}

async function fetchViaTunnel(
  directUrl: string,
  headers: Record<string, string>,
  proxy: string,
  signal?: AbortSignal,
  depth = 0,
): Promise<Response> {
  const proxyUrl = normalizeProxy(proxy);
  if (!proxyUrl) throw new Error("proxy scheme not supported by tunnel");
  const target = new URL(directUrl);
  const secure = target.protocol === "https:";
  const port = Number(target.port || (secure ? 443 : 80));
  const agent = await getTunnelAgent(proxyUrl, secure, target.hostname, port);
  const mod: any = secure ? await import("node:https") : await import("node:http");

  return new Promise<Response>((resolve, reject) => {
    const req = mod.request(
      {
        host: target.hostname,
        port,
        path: target.pathname + target.search,
        method: "GET",
        headers,
        agent,
      },
      async (upstream: any) => {
        try {
          const status = upstream.statusCode || 200;
          const location = upstream.headers?.location;
          // googlevideo / TikTok 的 CDN 经常先用 302 把你指到另一台边缘机。
          // node 的 http.request 不会自动跟随，以前这里直接当「坏状态」处理，
          // 结果是退回 yt-dlp 管道：能播但不能拖、而且慢一倍。
          // 手动跟 3 跳以内，跳转目标重新建隧道（可能换域名）。
          if (status >= 300 && status < 400 && location && depth < 3) {
            try { upstream.resume(); } catch (e) {}
            let next = location;
            try { next = new URL(location, directUrl).toString(); } catch (e) {}
            resolve(await fetchViaTunnel(next, headers, proxy, signal, depth + 1));
            return;
          }
          const h = new Headers();
          for (const [k, v] of Object.entries(upstream.headers || {})) {
            if (v == null) continue;
            h.set(k, Array.isArray(v) ? v.join(", ") : String(v));
          }
          const { Readable } = await import("node:stream");
          const body = Readable.toWeb(upstream) as unknown as ReadableStream<Uint8Array>;
          resolve(new Response(body, { status, headers: h }));
        } catch (err) {
          reject(err as Error);
        }
      },
    );
    req.on("error", reject);
    // 上游沉默 15 秒就断开，客户端能立刻换线路重试，而不是干等到 40 秒超时
    req.setTimeout(15_000, () => req.destroy(new Error("upstream idle timeout")));
    if (signal) {
      if (signal.aborted) req.destroy();
      else signal.addEventListener("abort", () => req.destroy(), { once: true });
    }
    req.end();
  });
}

// ---- CDN 直链缓存 ----
// 手机端保存是 2MB 分段下载，每次请求都重跑一遍 yt-dlp 探测要 8~25 秒，一条 30MB 视频
// 会被拖到几分钟。这里按「类型+代理+原始链接」缓存解析结果，时效 8 分钟。
type DirectEntry = { directUrl: string; ua: string; extractor?: string; extra: string[]; expires: number };
const directCache = new Map<string, DirectEntry>();
const DIRECT_TTL_MS = 8 * 60 * 1000;

function readDirectCache(key: string): DirectEntry | null {
  const hit = directCache.get(key);
  if (!hit) return null;
  if (hit.expires <= Date.now()) {
    directCache.delete(key);
    return null;
  }
  return hit;
}

function writeDirectCache(key: string, entry: Omit<DirectEntry, "expires">) {
  if (directCache.size > 200) {
    for (const [k, v] of directCache) if (v.expires <= Date.now()) directCache.delete(k);
    if (directCache.size > 200) directCache.clear();
  }
  directCache.set(key, { ...entry, expires: Date.now() + DIRECT_TTL_MS });
}

// 记住每个平台上次成功的策略，下次优先试，避免每次先跑一遍注定失败的策略
const strategyHints = new Map<string, string>();

// 同一个链接的并发探测合并：手机端 <video> 一次播放会并发发好几个 Range 请求，
// 预热请求也可能同时在路上。以前每个请求各跑一遍 yt-dlp（12~20 秒），
// 既慢又互相拖累；现在只跑一次，其余请求等同一个结果。
type ProbeResult = { entry: DirectEntry | null; lastErr: string; needsCookies: boolean };
const inflightProbes = new Map<string, Promise<ProbeResult>>();

// 落盘缓存：TikTok / IG 这类只能靠 yt-dlp 自己下载的平台，下载一次后按文件提供 Range，
// 播放、拖动、手机端 2MB 分段保存都命中同一份文件。
type BufferedFile = { path: string; size: number; contentType: string; expires: number };
const bufferedFiles = new Map<string, BufferedFile>();
const downloadTasks = new Map<string, Promise<BufferedFile>>();

// —— 落盘下载的资源上限。容器内存 768MB、根分区 63G（/tmp 就在 overlay 上，不是 tmpfs，
//    所以下载不占内存）。真正要防的是两件事：
//    ① 并发：同时几路 yt-dlp + ffmpeg（libx264 720p 峰值 200~300MB）会把 768MB 撑爆，
//       进程被 OOMKill 会连累所有正在播放的请求；
//    ② 磁盘：一条长视频可能就是几个 G，没人清理迟早把根分区写满。
const MEDIA_CACHE_DIR = process.env.MEDIA_CACHE_DIR || "/tmp/media-cache";
const CACHE_TTL_MS = 20 * 60_000;
const CACHE_SWEEP_AGE_MS = 25 * 60_000;
const MAX_CACHE_BYTES = Number(process.env.MEDIA_CACHE_MAX_MB || 1536) * 1024 * 1024;
const MAX_CACHE_FILES = Number(process.env.MEDIA_CACHE_MAX_FILES || 60);
const MAX_VIDEO_BYTES = Number(process.env.MEDIA_MAX_VIDEO_MB || 200) * 1024 * 1024;
const MAX_AUDIO_BYTES = Number(process.env.MEDIA_MAX_AUDIO_MB || 40) * 1024 * 1024;
const MAX_CONCURRENT_DOWNLOADS = Number(process.env.MEDIA_MAX_CONCURRENT || 2);
const MIN_FREE_BYTES = Number(process.env.MEDIA_MIN_FREE_MB || 2048) * 1024 * 1024;

function failWith(status: number, message: string): Error {
  const err = new Error(message) as Error & { statusCode?: number };
  err.statusCode = status;
  return err;
}

let activeDownloads = 0;
const downloadWaiters: Array<() => void> = [];

function newDownloadToken(): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeDownloads = Math.max(0, activeDownloads - 1);
    const next = downloadWaiters.shift();
    if (next) next();
  };
}

// 拿不到槽位就排队（最多等 20 秒）。手机端播放器会并发发好几个 Range 请求，
// 排队比直接 503 体验好；但排太久还不如让人重试，所以有超时。
async function acquireDownloadSlot(timeoutMs = 20_000): Promise<() => void> {
  if (activeDownloads < MAX_CONCURRENT_DOWNLOADS) {
    activeDownloads += 1;
    return newDownloadToken();
  }
  return new Promise<() => void>((resolve, reject) => {
    let settled = false;
    const grant = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      activeDownloads += 1;
      resolve(newDownloadToken());
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const i = downloadWaiters.indexOf(grant);
      if (i >= 0) downloadWaiters.splice(i, 1);
      reject(failWith(503, "busy"));
    }, timeoutMs);
    downloadWaiters.push(grant);
  });
}

// 清理缓存目录：先删超过 25 分钟没动过的，再按「总量 / 文件数」预算从最旧的删。
// 返回当前占用，顺带把 bufferedFiles 里指向已删文件的条目摘掉。
async function sweepCache(verbose = false): Promise<{ bytes: number; files: number; freedBytes: number }> {
  const fsMod = await import("node:fs/promises");
  const pathMod = await import("node:path");
  const entries: Array<{ path: string; size: number; mtime: number }> = [];
  try {
    await fsMod.mkdir(MEDIA_CACHE_DIR, { recursive: true });
    for (const name of await fsMod.readdir(MEDIA_CACHE_DIR)) {
      const full = pathMod.join(MEDIA_CACHE_DIR, name);
      const st = await fsMod.stat(full).catch(() => null);
      if (!st || !st.isFile()) continue;
      entries.push({ path: full, size: st.size, mtime: st.mtimeMs });
    }
  } catch {
    return { bytes: 0, files: 0, freedBytes: 0 };
  }

  const now = Date.now();
  const keep: typeof entries = [];
  let freed = 0;
  let removedCount = 0;
  for (const e of entries) {
    if (now - e.mtime > CACHE_SWEEP_AGE_MS) {
      await fsMod.unlink(e.path).catch(() => {});
      freed += e.size;
      removedCount += 1;
    } else {
      keep.push(e);
    }
  }

  keep.sort((a, b) => a.mtime - b.mtime); // 最旧在前
  let total = keep.reduce((sum, e) => sum + e.size, 0);
  while ((total > MAX_CACHE_BYTES || keep.length > MAX_CACHE_FILES) && keep.length) {
    const victim = keep.shift()!;
    await fsMod.unlink(victim.path).catch(() => {});
    total -= victim.size;
    freed += victim.size;
    removedCount += 1;
  }

  if (removedCount) {
    const alive = new Set(keep.map((e) => e.path));
    for (const [key, info] of bufferedFiles) {
      if (!alive.has(info.path)) bufferedFiles.delete(key);
    }
  }

  if (verbose || removedCount) {
    console.log(
      `[api/media-stream] cache sweep removed=${removedCount} freed=${(freed / 1048576).toFixed(1)}MB ` +
        `left=${(total / 1048576).toFixed(1)}MB files=${keep.length} active=${activeDownloads}`,
    );
  }
  return { bytes: total, files: keep.length, freedBytes: freed };
}

// 定时兜底清理：只有「有人下载」时才清的话，最后一个用户看完，文件会一直躺在磁盘里。
const SWEEP_TIMER_KEY = Symbol.for("jiexi520.mediaCacheSweepTimer");
const timerHost = globalThis as unknown as Record<symbol, unknown>;
if (!timerHost[SWEEP_TIMER_KEY]) {
  const timer = setInterval(() => { void sweepCache(true); }, 10 * 60_000);
  try { (timer as unknown as { unref?: () => void }).unref?.(); } catch {}
  timerHost[SWEEP_TIMER_KEY] = timer;
}

// 下载前确认还有空间：先看可用空间，不够就先清一遍缓存，仍不够就别下（宁可不播，也别写满根分区）。
async function ensureDiskSpace(): Promise<boolean> {
  const fsMod = await import("node:fs/promises");
  const read = async () => {
    const st = await fsMod.statfs(MEDIA_CACHE_DIR).catch(() => null);
    if (!st) return Number.POSITIVE_INFINITY;
    return Number(st.bavail) * Number(st.bsize);
  };
  if ((await read()) >= MIN_FREE_BYTES) return true;
  await sweepCache(true);
  return (await read()) >= MIN_FREE_BYTES;
}

async function writeParseLog(row: {
  platform: string;
  type: string;
  proxy_on: boolean;
  url: string;
  status: string;
  message?: string;
}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    await sb.from("parse_logs").insert({
      platform: row.platform || "",
      type: row.type || "",
      proxy_on: row.proxy_on,
      url: (row.url || "").slice(0, 500),
      status: row.status,
      message: (row.message || "").slice(0, 1000),
    });
  } catch (err) {
    console.error("[api/media-stream] failed to write parse_log", err);
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
    headers.set("Accept-Ranges", "bytes");
    if (shouldDownload) headers.set("Content-Disposition", attachmentName(filename, type === "audio" ? "audio.m4a" : "video.mp4"));
    return new Response(null, { status: 200, headers });
  }

  const { spawn } = await import("node:child_process");
  const proxy = await readProxySetting();
  const tunnelReady = Boolean(normalizeProxy(proxy));
  const referer = pickRefererForSource(target);
  const format =
    type === "audio" ? "bestaudio[ext=m4a]/bestaudio/best[ext=mp4]/best" : "best[ext=mp4]/best";
  const UA_DESKTOP =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
  const UA_MOBILE =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
  const platform = platformKey(target);
  const cacheKey = `${type}|${proxy}|${target}`;

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
  const hint = strategyHints.get(platform || "default");
  if (hint) {
    const idx = attempts.findIndex((a) => a.name === hint);
    if (idx > 0) attempts.unshift(...attempts.splice(idx, 1));
  }

  const { execFile } = await import("node:child_process");

  // 先用 --simulate 探测哪个策略能取到媒体（并拿到 CDN 直链）
  async function probeDirectOnce(): Promise<ProbeResult> {
    console.log(
      `[api/media-stream] parse start proxy=${proxy ? (tunnelReady ? "on" : "unsupported-scheme") : "off"} platform=${platform || "unknown"} type=${type}`,
    );
    void writeParseLog({
      platform: platform || "unknown",
      type,
      proxy_on: !!proxy,
      url: target,
      status: "start",
      message: "",
    });
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
        const found = await new Promise<string>((resolve, reject) => {
          execFile(
            configuredPath,
            probeArgs,
            { encoding: "utf8", timeout: 25_000, maxBuffer: 4 * 1024 * 1024,
              env: { ...process.env, PYTHONIOENCODING: "utf-8" } },
            (error, stdout, stderr) => {
              if (error) { lastErr = redactSensitive(stderr || error.message, proxy); reject(error); return; }
              const url = String(stdout || "")
                .split(/\r?\n/)
                .map((l) => l.trim())
                .find((l) => /^https?:\/\//i.test(l));
              if (!url) { lastErr = "empty url"; reject(new Error("empty")); return; }
              resolve(url);
            },
          );
        });
        strategyHints.set(platform || "default", s.name);
        void writeParseLog({
          platform: platform || "unknown",
          type,
          proxy_on: !!proxy,
          url: target,
          status: "ok",
          message: s.name,
        });
        return {
          entry: { directUrl: found, ua: s.ua, extractor: s.extractor, extra: s.extra, expires: 0 },
          lastErr,
          needsCookies,
        };
      } catch {
        if (isLoginCookieRequired(lastErr)) needsCookies = true;
        console.error(`[api/media-stream] strategy ${s.name} failed:`, lastErr.slice(0, 800));
      }
    }
    return { entry: null, lastErr, needsCookies };
  }

  function probeDirect(): Promise<ProbeResult> {
    const running = inflightProbes.get(cacheKey);
    if (running) {
      console.log("[api/media-stream] join inflight probe", type, platform || "unknown");
      return running;
    }
    const tracked: Promise<ProbeResult> = probeDirectOnce().finally(() => {
      if (inflightProbes.get(cacheKey) === tracked) inflightProbes.delete(cacheKey);
    });
    inflightProbes.set(cacheKey, tracked);
    return tracked;
  }

  // TikTok / Instagram 的 CDN 只认 yt-dlp 自己那次请求（链接里带签名，且依赖提取时的
  // 会话 Cookie），用我们另开的连接去拉一律 403。这类平台不再浪费 15 秒去探测注定失败的
  // 直链，直接走「yt-dlp 落盘 → 按文件提供 Range」。
  const bufferedPlatform = platform === "TIKTOK" || platform === "INSTAGRAM";

  let entry: DirectEntry | null = bufferedPlatform
    ? { directUrl: "", ua: attempts[0].ua, extractor: attempts[0].extractor, extra: attempts[0].extra, expires: 0 }
    : readDirectCache(cacheKey);
  let lastErr = "";
  let needsCookies = false;

  if (!bufferedPlatform && !entry) {
    const probed = await probeDirect();
    entry = probed.entry;
    lastErr = probed.lastErr;
    needsCookies = probed.needsCookies;
    if (entry) writeDirectCache(cacheKey, entry);
  }

  if (!entry) {
    if (needsCookies && cookieArgSets.length === 0) {
      void writeParseLog({
        platform: platform || "unknown",
        type,
        proxy_on: !!proxy,
        url: target,
        status: "need_cookies",
        message: lastErr.slice(0, 800),
      });
      return new Response(`${platform || "Platform"} login cookies required`, { status: 502, headers: CORS });
    }
    console.error("[api/media-stream] all strategies failed", lastErr.slice(0, 800));
    void writeParseLog({
      platform: platform || "unknown",
      type,
      proxy_on: !!proxy,
      url: target,
      status: "failed",
      message: lastErr.slice(0, 800),
    });
    return new Response("stream unavailable", { status: 502, headers: CORS });
  }

  const MIME: Record<string, string> = {
    mp4: "video/mp4",
    m4v: "video/mp4",
    m4a: "audio/mp4",
    webm: "video/webm",
    weba: "audio/webm",
    mkv: "video/x-matroska",
    mov: "video/quicktime",
    mp3: "audio/mpeg",
    ogg: "audio/ogg",
    opus: "audio/ogg",
  };

  async function runFfmpeg(args: string[], timeoutMs: number): Promise<void> {
    const bin = process.env.FFMPEG_PATH || "/usr/bin/ffmpeg";
    await new Promise<void>((resolve, reject) => {
      const child = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
        if (stderr.length > 2000) stderr = stderr.slice(-2000);
      });
      const timer = setTimeout(() => {
        try { child.kill("SIGTERM"); } catch {}
        reject(new Error("ffmpeg timeout"));
      }, timeoutMs);
      child.on("error", (err) => { clearTimeout(timer); reject(err); });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-400)}`));
      });
    });
  }

  async function probeCodec(file: string): Promise<{ codec: string; height: number } | null> {
    const bin = process.env.FFPROBE_PATH || "/usr/bin/ffprobe";
    return new Promise((resolve) => {
      const child = spawn(bin, [
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=codec_name,height",
        "-of", "json",
        file,
      ], { stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      const timer = setTimeout(() => { try { child.kill("SIGTERM"); } catch {} resolve(null); }, 15_000);
      child.stdout.on("data", (chunk) => { out += chunk.toString("utf8"); });
      child.on("error", () => { clearTimeout(timer); resolve(null); });
      child.on("close", () => {
        clearTimeout(timer);
        try {
          const stream = JSON.parse(out)?.streams?.[0];
          resolve(stream ? { codec: String(stream.codec_name || ""), height: Number(stream.height) || 0 } : null);
        } catch { resolve(null); }
      });
    });
  }

  // 返回转码后的文件路径；不需要转码返回 null
  async function transcodeIfNeeded(file: string, base: string): Promise<string | null> {
    const pathMod = await import("node:path");
    if (type === "audio") {
      const probe = await probeCodec(file);
      // 容器里是音频轨，ffprobe 拿不到 v:0，用 -select_streams a:0 再探一次没意义，
      // 直接用扩展名判断：m4a/mp3 已经是通用格式。
      const ext = pathMod.extname(file).slice(1).toLowerCase();
      if (ext === "m4a" || ext === "mp3") return null;
      const out = `${base}.aac.m4a`;
      try {
        await runFfmpeg(["-y", "-hide_banner", "-loglevel", "error", "-i", file,
          "-vn", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", out], 120_000);
        return out;
      } catch (err) {
        console.error("[api/media-stream] audio transcode failed", (err as Error)?.message);
        return null;
      }
    }

    const probe = await probeCodec(file);
    const codec = probe?.codec || "";
    // 浏览器通吃的编码：H.264 / VP9 / AV1。HEVC、H.266 一律转码。
    if (codec === "h264" || codec === "vp9" || codec === "av1" || codec === "vp8") return null;
    const out = `${base}.h264.mp4`;
    const args = ["-y", "-hide_banner", "-loglevel", "error", "-i", file, "-c:v", "libx264",
      "-preset", "veryfast", "-crf", "24", "-pix_fmt", "yuv420p"];
    if (probe && probe.height > 720) args.push("-vf", "scale=-2:720");
    args.push("-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", out);
    try {
      console.log(`[api/media-stream] transcode ${codec || "unknown"} → h264`);
      await runFfmpeg(args, 170_000);
      return out;
    } catch (err) {
      console.error("[api/media-stream] transcode failed", (err as Error)?.message);
      return null;
    }
  }

  // —— 文件缓冲：yt-dlp 自己下载（它带对了 Cookie / 签名），落盘后再按文件提供 Range。
  //    以前这里把 yt-dlp 的 stdout 直接丢给播放器：没有 Content-Length、
  //    Accept-Ranges: none，手机浏览器（尤其 iOS）直接播不了，也不能拖进度。
  async function downloadBuffered(): Promise<{ path: string; size: number; contentType: string; expires: number }> {
    const cached = bufferedFiles.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      const fsCheck = await import("node:fs/promises");
      const st = await fsCheck.stat(cached.path).catch(() => null);
      if (st && st.size === cached.size) return cached;
      bufferedFiles.delete(cacheKey);
    }
    const running = downloadTasks.get(cacheKey);
    if (running) return running;

    const maxBytes = type === "audio" ? MAX_AUDIO_BYTES : MAX_VIDEO_BYTES;
    // 下载个 720p 就够了：再高也要转成 720 给浏览器播，先拉 1080/4K 只是多花磁盘和时间。
    const bufferedFormat =
      type === "audio"
        ? format
        : "bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/b[height<=720]/best[ext=mp4]/best";

    const task = (async () => {
      const release = await acquireDownloadSlot();
      try {
        return await runBufferedDownload();
      } finally {
        release();
      }
    })().finally(() => {
      downloadTasks.delete(cacheKey);
    });

    async function runBufferedDownload(): Promise<BufferedFile> {
      const fsMod = await import("node:fs/promises");
      const pathMod = await import("node:path");
      const { createHash } = await import("node:crypto");
      const dir = MEDIA_CACHE_DIR;
      await fsMod.mkdir(dir, { recursive: true });

      if (!(await ensureDiskSpace())) {
        throw failWith(503, `disk space low (<${Math.round(MIN_FREE_BYTES / 1048576)}MB free)`);
      }
      // 进来先按预算清一遍，避免上一波文件把这一波挤爆
      await sweepCache();

      const base = pathMod.join(dir, createHash("sha1").update(cacheKey).digest("hex").slice(0, 20));
      const dlArgs = [
        "-f", bufferedFormat,
        "--no-warnings", "--no-check-certificates",
        "--socket-timeout", "30",
        "--retries", "3",
        "--geo-bypass",
        // yt-dlp 拿到元数据就知道大小，超限直接不下（省带宽也省磁盘）；
        // 元数据没给大小的，下完再用 stat 兜一层。
        "--max-filesize", `${Math.max(1, Math.floor(maxBytes / 1048576))}M`,
        "--add-header", `referer:${referer}`,
        "--add-header", `user-agent:${entry!.ua}`,
      ];
      if (entry!.extractor) dlArgs.push("--extractor-args", entry!.extractor);
      dlArgs.push(...entry!.extra);
      if (proxy) dlArgs.push("--proxy", proxy);
      dlArgs.push("-o", `${base}.%(ext)s`, target);

      await new Promise<void>((resolve, reject) => {
        const child = spawn(configuredPath, dlArgs, {
          stdio: ["ignore", "ignore", "pipe"],
          env: { ...process.env, PYTHONIOENCODING: "utf-8" },
        });
        let stderr = "";
        child.stderr.on("data", (chunk) => {
          stderr += chunk.toString("utf8");
          if (stderr.length > 4000) stderr = stderr.slice(-4000);
        });
        const timer = setTimeout(() => {
          try { child.kill("SIGTERM"); } catch {}
          reject(new Error("download timeout"));
        }, 170_000);
        child.on("error", (err) => { clearTimeout(timer); reject(err); });
        child.on("close", (code) => {
          clearTimeout(timer);
          if (code === 0) resolve();
          else reject(new Error(redactSensitive(stderr, proxy) || `yt-dlp exit ${code}`));
        });
      });

      const prefix = pathMod.basename(base) + ".";
      const produced = (await fsMod.readdir(dir)).filter((f) => f.startsWith(prefix));
      if (!produced.length) throw new Error("download produced no file");
      let file = pathMod.join(dir, produced[0]);
      let st = await fsMod.stat(file);
      if (!st.size) throw new Error("empty media file");
      if (st.size > maxBytes) {
        await fsMod.unlink(file).catch(() => {});
        throw failWith(413, `media too large (${(st.size / 1048576).toFixed(0)}MB > ${Math.floor(maxBytes / 1048576)}MB)`);
      }

      // —— 编码兼容：TikTok 现在默认给 HEVC(H.265)。iOS 能解，安卓 Chrome 和
      //    不少桌面浏览器直接黑屏，用户看到的就是「加载出来了但播不了」。
      //    这里用 ffmpeg 现场转成 H.264/AAC（+faststart，边下边播），转完缓存复用。
      const transcoded = await transcodeIfNeeded(file, base);
      if (transcoded) {
        await fsMod.unlink(file).catch(() => {});
        file = transcoded;
        st = await fsMod.stat(file);
      }

      if (st.size > maxBytes) {
        await fsMod.unlink(file).catch(() => {});
        throw failWith(413, `media too large after transcode (${(st.size / 1048576).toFixed(0)}MB)`);
      }

      const ext = pathMod.extname(file).slice(1).toLowerCase();
      const info: BufferedFile = {
        path: file,
        size: st.size,
        contentType: MIME[ext] || (type === "audio" ? "audio/mp4" : "video/mp4"),
        expires: Date.now() + CACHE_TTL_MS,
      };
      // 表本身也别无限长：超出就摘最旧的（文件由 sweepCache 负责）
      if (bufferedFiles.size >= MAX_CACHE_FILES * 2) {
        const oldest = [...bufferedFiles.entries()].sort((a, b) => a[1].expires - b[1].expires)[0];
        if (oldest) bufferedFiles.delete(oldest[0]);
      }
      bufferedFiles.set(cacheKey, info);
      console.log(
        `[api/media-stream] buffered platform=${platform || "unknown"} type=${type} size=${(st.size / 1048576).toFixed(1)}MB active=${activeDownloads}`,
      );
      // 下完再清一次，把这一轮之前的旧文件按预算收掉
      void sweepCache();
      return info;
    }

    downloadTasks.set(cacheKey, task);
    return task;
  }

  async function serveBuffered(
    info: { path: string; size: number; contentType: string },
    rangeHeader: string | null,
  ): Promise<Response> {
    const headers = new Headers(CORS);
    headers.set("Content-Type", info.contentType);
    headers.set("Accept-Ranges", "bytes");
    headers.set("Cache-Control", "no-store");
    if (shouldDownload) {
      headers.set("Content-Disposition", attachmentName(filename, type === "audio" ? "audio.m4a" : "video.mp4"));
    }
    let start = 0;
    let end = info.size - 1;
    let status = 200;
    if (rangeHeader) {
      const m = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
      if (!m || (m[1] === "" && m[2] === "")) {
        headers.set("Content-Range", `bytes */${info.size}`);
        return new Response(null, { status: 416, headers });
      }
      if (m[1] === "") {
        const suffix = Number(m[2]) || 0;
        start = Math.max(0, info.size - suffix);
      } else {
        start = Number(m[1]);
        if (m[2]) end = Math.min(Number(m[2]), info.size - 1);
      }
      if (!Number.isFinite(start) || start >= info.size || start > end) {
        headers.set("Content-Range", `bytes */${info.size}`);
        return new Response(null, { status: 416, headers });
      }
      status = 206;
      headers.set("Content-Range", `bytes ${start}-${end}/${info.size}`);
    }
    headers.set("Content-Length", String(end - start + 1));
    const fsMod = await import("node:fs");
    const nodeStream = await import("node:stream");
    const body = nodeStream.Readable.toWeb(
      fsMod.createReadStream(info.path, { start, end }),
    ) as unknown as ReadableStream<Uint8Array>;
    return new Response(body, { status, headers });
  }

  // —— Range 直转：直接把播放器/下载器的 Range 请求转发到 CDN 直链。
  //    透传 Content-Length / Content-Range 并声明 Accept-Ranges: bytes，
  //    手机端与小程序 <video> 才能拿到时长、拖动进度。
  //    配了后台代理就走 CONNECT 隧道（CDN 直链与代理出口 IP 绑定，直连会被 403）。
  if (request.method === "GET") {
    if (bufferedPlatform) {
      try {
        const info = await downloadBuffered();
        return await serveBuffered(info, request.headers.get("range"));
      } catch (err) {
        const status = (err as { statusCode?: number })?.statusCode || 502;
        console.error(
          `[api/media-stream] buffered download failed status=${status}`,
          redactSensitive((err as Error)?.message, proxy),
        );
        const headers = new Headers(CORS);
        if (status === 503) headers.set("Retry-After", "15");
        return new Response(status === 503 ? "server busy, retry later" : "stream unavailable", { status, headers });
      }
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const fwdHeaders: Record<string, string> = {
          "user-agent": entry.ua,
          referer: referer,
        };
        const range = request.headers.get("range");
        if (range) fwdHeaders["range"] = range;
        const upstream = tunnelReady
          ? await fetchViaTunnel(entry.directUrl, fwdHeaders, proxy, request.signal)
          : await fetch(entry.directUrl, { headers: fwdHeaders, redirect: "follow" });
        if (upstream.ok || upstream.status === 206) {
          const headers = new Headers(CORS);
          const ct = upstream.headers.get("content-type") || "";
          headers.set(
            "Content-Type",
            ct.startsWith("video/") || ct.startsWith("audio/") ? ct : type === "audio" ? "audio/mp4" : "video/mp4",
          );
          headers.set("Cache-Control", "no-store");
          const cl = upstream.headers.get("content-length");
          if (cl) headers.set("Content-Length", cl);
          const cr = upstream.headers.get("content-range");
          if (cr) headers.set("Content-Range", cr);
          headers.set("Accept-Ranges", "bytes");
          if (shouldDownload) {
            headers.set("Content-Disposition", attachmentName(filename, type === "audio" ? "audio.m4a" : "video.mp4"));
          }
          console.log(
            `[api/media-stream] direct forward ok status=${upstream.status} proxy=${tunnelReady ? "on" : "off"} attempt=${attempt + 1}`,
          );
          return new Response(upstream.body, { status: upstream.status, headers });
        }
        console.error(
          `[api/media-stream] direct forward bad status ${upstream.status} proxy=${tunnelReady ? "on" : "off"}`,
        );
        await upstream.body?.cancel().catch(() => {});
        if (upstream.status === 403 || upstream.status === 404 || upstream.status === 410) {
          directCache.delete(cacheKey);
          if (attempt === 0 && !bufferedPlatform) {
            const again = await probeDirect();
            if (again.entry) {
              entry = again.entry;
              writeDirectCache(cacheKey, again.entry);
              continue;
            }
          }
        }
        break;
      } catch (err) {
        console.error(
          `[api/media-stream] direct forward failed proxy=${tunnelReady ? "on" : "off"}`,
          (err as Error)?.message || err,
        );
        directCache.delete(cacheKey);
        break;
      }
    }
    console.error("[api/media-stream] → fallback to buffered download");
    try {
      const info = await downloadBuffered();
      return await serveBuffered(info, request.headers.get("range"));
    } catch (err) {
      const status = (err as { statusCode?: number })?.statusCode || 502;
      console.error(
        `[api/media-stream] buffered download failed status=${status}`,
        redactSensitive((err as Error)?.message, proxy),
      );
      if (status === 503 || status === 413) {
        const headers = new Headers(CORS);
        if (status === 503) headers.set("Retry-After", "15");
        return new Response(
          status === 503 ? "server busy, retry later" : "media too large",
          { status, headers },
        );
      }
    }
  }

  // 最后的兜底：直接把 yt-dlp 的 stdout 交给播放器（没有长度、不能拖动，聊胜于无）
  const args = [
    "-f", format,
    "--no-warnings", "--no-check-certificates",
    "--socket-timeout", "30",
    "--retries", "3",
    "--geo-bypass",
    "--add-header", `referer:${referer}`,
    "--add-header", `user-agent:${entry.ua}`,
  ];
  if (entry.extractor) args.push("--extractor-args", entry.extractor);
  args.push(...entry.extra);
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
