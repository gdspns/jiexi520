import { createFileRoute } from "@tanstack/react-router";
import { proxyMedia, PROXY_CORS } from "@/lib/media-proxy.server";

function decodeName(raw: string | null | undefined, fallback = "video.mp4"): string {
  const value = String(raw || fallback);
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function handle(request: Request, pathName: string): Promise<Response> {
  // path 里的名字只用来给浏览器一个 .mp4 后缀；真实文件名优先取 query，
  // 这样短路径 + 中文长标题可以同时满足。
  const queryName = new URL(request.url).searchParams.get("filename");
  return proxyMedia(request, {
    download: true,
    filename: decodeName(queryName || pathName),
    video: true,
  });
}

/**
 * 下载专用路径：/api/public/dl/<文件名>.mp4?url=<CDN 直链>&filename=<真实文件名>
 *
 * 为什么要单独一条路由，而不是继续用 ?download=1：
 * UC / QQ / 百度这些国内浏览器判断"这是不是可下载文件"主要看 URL 后缀，
 * 没有 .mp4 后缀时它们会把链接当网页打开（或直接拒绝下载）。
 * 这里把后缀写进 path，响应仍是 attachment + video/mp4。
 */
export const Route = createFileRoute("/api/public/dl/$name")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: PROXY_CORS }),
      GET: async ({ request, params }) => handle(request, params.name),
      HEAD: async ({ request, params }) => handle(request, params.name),
    },
  },
});
