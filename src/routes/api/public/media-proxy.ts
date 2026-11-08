import { createFileRoute } from "@tanstack/react-router";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function pickReferer(host: string): string | null {
  const h = host.toLowerCase();
  if (
    h.includes("douyin") ||
    h.includes("aweme") ||
    h.includes("bytecdn") ||
    h.includes("ixigua") ||
    h.includes("bytedance") ||
    h.includes("tiktokcdn") ||
    h.includes("douyinpic") ||
    h.includes("douyinvod")
  )
    return "https://www.douyin.com/";
  if (
    h.includes("xhscdn") ||
    h.includes("xiaohongshu") ||
    h.includes("xhs") ||
    h.includes("momocdn")
  )
    return "https://www.xiaohongshu.com/";
  if (h.includes("kuaishou") || h.includes("kwimgs") || h.includes("yximgs"))
    return "https://www.kuaishou.com/";
  if (h.includes("bilivideo") || h.includes("bilibili") || h.includes("hdslb"))
    return "https://www.bilibili.com/";
  if (h.includes("weibocdn") || h.includes("weibo") || h.includes("sinaimg"))
    return "https://weibo.com/";
  if (
    h.includes("tiktok") ||
    h.includes("tiktokcdn-") ||
    h.includes("muscdn") ||
    h.includes("musical.ly") ||
    h.includes("byteoversea")
  )
    return "https://www.tiktok.com/";
  if (
    h.includes("youtube") ||
    h.includes("youtu.be") ||
    h.includes("googlevideo") ||
    h.includes("ytimg")
  )
    return "https://www.youtube.com/";
  if (h.includes("cdninstagram") || h.includes("instagram") || h.includes("fbcdn"))
    return "https://www.instagram.com/";
  if (h.includes("facebook") || h.includes("fbsbx"))
    return "https://www.facebook.com/";
  if (h.includes("twitter") || h.includes("twimg") || h.includes("x.com"))
    return "https://twitter.com/";
  if (h.includes("vimeo") || h.includes("vimeocdn"))
    return "https://vimeo.com/";
  return null;
}

function isSafeUrl(u: URL): boolean {
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  )
    return false;
  // block obvious private IPv4
  if (/^127\./.test(host)) return false;
  if (/^10\./.test(host)) return false;
  if (/^192\.168\./.test(host)) return false;
  if (/^169\.254\./.test(host)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
  return true;
}

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

async function handle(request: Request): Promise<Response> {
  const reqUrl = new URL(request.url);
  const target = reqUrl.searchParams.get("url");
  const shouldDownload = reqUrl.searchParams.get("download") === "1";
  const requestedType = reqUrl.searchParams.get("type");
  const filename = reqUrl.searchParams.get("filename");
  if (!target) {
    return new Response("Missing url", { status: 400, headers: CORS });
  }

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return new Response("Invalid url", { status: 400, headers: CORS });
  }
  if (!isSafeUrl(parsed)) {
    return new Response("Forbidden url", { status: 403, headers: CORS });
  }

  const headers: Record<string, string> = {
    "User-Agent": UA,
    Accept: "*/*",
  };
  const ref = pickReferer(parsed.hostname);
  if (ref) {
    headers["Referer"] = ref;
    try {
      headers["Origin"] = new URL(ref).origin;
    } catch {}
  }
  const range = request.headers.get("range");
  if (range) headers["Range"] = range;

  // 各家 CDN 的防盗链策略不一致：有的必须带 Referer，有的带了反而 403。
  // 先按推断的 Referer 请求，遇到 401/403 再用纯 UA 重试一次。
  const attemptHeaders: Record<string, string>[] = [headers];
  if (ref) {
    const bare: Record<string, string> = { "User-Agent": UA, Accept: "*/*" };
    if (range) bare["Range"] = range;
    attemptHeaders.push(bare);
  }

  let upstream: Response | null = null;
  let lastError = "";
  for (const attempt of attemptHeaders) {
    try {
      const response = await fetch(parsed.toString(), {
        method: request.method === "HEAD" ? "HEAD" : "GET",
        headers: attempt,
        redirect: "follow",
      });
      if (response.ok || response.status === 206 || response.status === 304) {
        upstream = response;
        break;
      }
      if (response.status !== 401 && response.status !== 403) {
        upstream = response;
        break;
      }
      lastError = `upstream ${response.status}`;
      await response.body?.cancel().catch(() => {});
    } catch (err) {
      lastError = (err as Error).message;
    }
  }

  if (!upstream) {
    return new Response("Upstream fetch failed: " + (lastError || "unknown"), {
      status: 502,
      headers: CORS,
    });
  }

  const respHeaders = new Headers(CORS);
  const passthrough = [
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
    "last-modified",
    "etag",
  ];
  for (const k of passthrough) {
    const v = upstream.headers.get(k);
    if (v) respHeaders.set(k, v);
  }
  if (!respHeaders.has("content-type")) {
    respHeaders.set("content-type", "application/octet-stream");
  }
  const currentType = respHeaders.get("content-type") || "";
  if (requestedType === "video" && !currentType.toLowerCase().startsWith("video/")) {
    respHeaders.set("content-type", "video/mp4");
  }
  // iOS Safari 只有在明确声明分段支持时才会出时长/允许拖动；
  // 上游 206 一定支持分段，缺省补上 bytes。
  if (upstream.status === 206 && !respHeaders.has("accept-ranges")) {
    respHeaders.set("accept-ranges", "bytes");
  }
  // 分段请求但上游返回 200（源站不支持 Range）：保持原样，播放器会自行整包读取。
  if (shouldDownload) {
    respHeaders.set("Content-Disposition", attachmentName(filename, "download"));
    respHeaders.set("Cache-Control", "no-store");
  } else {
    respHeaders.set("Cache-Control", "public, max-age=3600");
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  });
}

export const Route = createFileRoute("/api/public/media-proxy")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => handle(request),
      HEAD: async ({ request }) => handle(request),
    },
  },
});
