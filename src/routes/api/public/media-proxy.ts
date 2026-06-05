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
  if (h.includes("xhscdn") || h.includes("xiaohongshu") || h.includes("xhs"))
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
    "Content-Length, Content-Range, Accept-Ranges, Content-Type",
};

async function handle(request: Request): Promise<Response> {
  const reqUrl = new URL(request.url);
  const target = reqUrl.searchParams.get("url");
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

  let upstream: Response;
  try {
    upstream = await fetch(parsed.toString(), {
      method: request.method === "HEAD" ? "HEAD" : "GET",
      headers,
      redirect: "follow",
    });
  } catch (err) {
    return new Response("Upstream fetch failed: " + (err as Error).message, {
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
  respHeaders.set("Cache-Control", "public, max-age=3600");

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