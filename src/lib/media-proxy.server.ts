import { parseRange, sliceStream } from "@/lib/media-range";

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

export const PROXY_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Range, Content-Type",
  "Access-Control-Expose-Headers":
    "Content-Length, Content-Range, Accept-Ranges, Content-Type, Content-Disposition",
};

/** 去掉文件名里会破坏响应头 / 磁盘名的字符，并强制 mp4 扩展名 */
export function toMp4Name(name: string | null | undefined, fallback = "video.mp4"): string {
  const base = String(name || "")
    .replace(/[\\/:*?"<>|\r\n]/g, "")
    .trim()
    .slice(0, 90);
  const safe = base || fallback;
  return /\.(mp4|m4v|mov)$/i.test(safe) ? safe : safe + ".mp4";
}

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif|bmp)$/i;

function attachmentName(name: string | null, fallback: string) {
  // 图片下载要保留原扩展名，不能被强制改成 .mp4
  const raw = String(name || "").replace(/[\\/"\r\n]/g, "").trim().slice(0, 120);
  const cleaned = raw && IMAGE_EXT.test(raw) ? raw : raw ? toMp4Name(raw, fallback) : fallback;
  let ascii = cleaned.replace(/[^\x20-\x7E]/g, "_");
  // 纯中文标题转 ASCII 会变成一整串下划线（____.mp4 / __-1.jpg），
  // 有些国内浏览器会忽略 filename*、只认这个 ASCII 名，存下来就是一堆下划线。
  // 剩下只有数字/下划线/短横线时也算"没有可读名"，换成 file-xxxx.jpg。
  if (!/[A-Za-z]/.test(ascii.replace(/\.[a-z0-9]+$/i, "").replace(/[\s_\-.\d]/g, ""))) {
    const ext = (cleaned.match(/\.([A-Za-z0-9]+)$/) || [, "mp4"])[1].toLowerCase();
    ascii = `file-${Date.now().toString(36)}.${ext}`;
  }
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(cleaned)}`;
}

export type ProxyOptions = {
  /** 强制走下载：Content-Disposition: attachment + 以 .mp4 结尾的文件名 */
  download?: boolean;
  filename?: string | null;
  /** 告诉代理"这是视频"，上游 content-type 不对时兜底成 video/mp4 */
  video?: boolean;
};

/**
 * 媒体代理：带 Referer/UA 拉上游，透传 Range，必要时自行切片。
 * 播放和下载共用同一套逻辑，避免下载链接与播放链接判不一致。
 */
export async function proxyMedia(request: Request, opts: ProxyOptions = {}): Promise<Response> {
  const reqUrl = new URL(request.url);
  const target = reqUrl.searchParams.get("url");
  const shouldDownload = opts.download === true || reqUrl.searchParams.get("download") === "1";
  const requestedType = opts.video === false ? null : reqUrl.searchParams.get("type") || "video";
  const filename = opts.filename ?? reqUrl.searchParams.get("filename");
  if (!target) {
    return new Response("Missing url", { status: 400, headers: PROXY_CORS });
  }

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return new Response("Invalid url", { status: 400, headers: PROXY_CORS });
  }
  if (!isSafeUrl(parsed)) {
    return new Response("Forbidden url", { status: 403, headers: PROXY_CORS });
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
  let expired = false;
  const method = request.method === "HEAD" ? "HEAD" : "GET";

  for (const attempt of attemptHeaders) {
    // 只给"等响应头"这一步设超时。视频流本身可能持续几分钟，
    // 绝不能用一个 AbortSignal.timeout 把整个 body 一起掐掉。
    for (let retry = 0; retry < 2 && !upstream; retry++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      try {
        const response = await fetch(parsed.toString(), {
          method,
          headers: attempt,
          redirect: "follow",
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (response.ok || response.status === 206 || response.status === 304) {
          upstream = response;
          break;
        }
        if (
          response.status === 401 ||
          response.status === 403 ||
          response.status === 404 ||
          response.status === 410
        ) {
          // 直链带时效，过期后就是这几个状态码，交给前端刷新换新链
          expired = true;
          lastError = `upstream ${response.status}`;
          await response.body?.cancel().catch(() => {});
          break;
        }
        upstream = response;
        break;
      } catch (err) {
        clearTimeout(timer);
        lastError = (err as Error).message;
        if (retry === 0) await new Promise((r) => setTimeout(r, 300));
      }
    }
    if (upstream) break;
  }

  if (!upstream) {
    const errHeaders = new Headers(PROXY_CORS);
    if (expired) {
      // X-Media-Expired 是给前端用的信号：这条直链已经失效，重新解析一次即可。
      errHeaders.set("X-Media-Expired", "1");
      errHeaders.set("Cache-Control", "no-store");
      return new Response("Media link expired", { status: 410, headers: errHeaders });
    }
    errHeaders.set("Cache-Control", "no-store");
    return new Response("Upstream fetch failed: " + (lastError || "unknown"), {
      status: 502,
      headers: errHeaders,
    });
  }

  const respHeaders = new Headers(PROXY_CORS);
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
  const isImage = requestedType === "image";
  if (requestedType === "video" && !currentType.toLowerCase().startsWith("video/")) {
    respHeaders.set("content-type", "video/mp4");
  }
  // 图片走 <img>，content-type 必须是真的图片类型，否则浏览器拒绝解码
  if (isImage && (!currentType || currentType === "application/octet-stream")) {
    const ext = (parsed.pathname.split(".").pop() || "").toLowerCase();
    respHeaders.set(
      "content-type",
      ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "gif" ? "image/gif" : "image/jpeg",
    );
  }

  // 上游忽略 Range、回了整包 200：我们自己切出请求的那一段回 206。
  // 否则每次 seek 都从 0 字节重新下载，长视频必然卡死。
  const wanted = parseRange(range);
  const upstreamTotal = Number(upstream.headers.get("content-length") || 0);
  if (wanted && upstream.status === 200 && upstreamTotal > 0) {
    const start = Math.min(wanted.start, Math.max(0, upstreamTotal - 1));
    const end = wanted.end === null ? upstreamTotal - 1 : Math.min(wanted.end, upstreamTotal - 1);
    const length = end - start + 1;
    const sliced = new Headers(respHeaders);
    sliced.delete("content-length");
    sliced.delete("content-range");
    sliced.set("content-length", String(length));
    sliced.set("content-range", `bytes ${start}-${end}/${upstreamTotal}`);
    sliced.set("accept-ranges", "bytes");
    // 允许浏览器缓存已下载的分片：手机上每次 seek 都重新下一遍，
    // 移动网络根本追不上，表现就是「拖着拖着就卡死」。
    sliced.set("Cache-Control", "public, max-age=600");
    if (shouldDownload)
      sliced.set("Content-Disposition", attachmentName(filename, isImage ? "image.jpg" : "video.mp4"));
    return new Response(sliceStream(upstream.body, start, end), {
      status: 206,
      statusText: "Partial Content",
      headers: sliced,
    });
  }

  // iOS Safari 只有在明确声明分段支持时才会出时长/允许拖动；
  // 上游 206 一定支持分段，缺省补上 bytes。
  if (upstream.status === 206 && !respHeaders.has("accept-ranges")) {
    respHeaders.set("accept-ranges", "bytes");
  }
  if (shouldDownload) {
    respHeaders.set("Content-Disposition", attachmentName(filename, isImage ? "image.jpg" : "video.mp4"));
    respHeaders.set("Cache-Control", "no-store");
    // 下载链接本身就是个 .mp4，国内浏览器（UC/QQ/百度）主要靠
    // 类型 + 后缀判断"这是视频文件"，不是网页，才肯交给下载器。
    if (!isImage && !respHeaders.get("content-type")?.toLowerCase().startsWith("video/")) {
      respHeaders.set("content-type", "video/mp4");
    }
  } else {
    // 播放走浏览器缓存：每次 seek 都从 0 重下，在移动网络上必然卡死。
    // URL 里已经带了完整的 CDN 直链，直链一变 URL 就变，不会读到脏数据。
    respHeaders.set("Cache-Control", "public, max-age=600");
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  });
}
