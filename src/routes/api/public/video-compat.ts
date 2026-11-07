import { createFileRoute } from "@tanstack/react-router";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const MEDIA_HOST_PARTS = [
  "momocdn.com", "365yg.com", "douyinvod.com", "bytecdn", "douyin", "aweme",
  "kwimgs.com", "yximgs.com", "kuaishou", "xhscdn.com", "bilivideo.com",
  "hdslb.com", "weibocdn", "sinaimg",
];

function allowedMediaUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const host = url.hostname.toLowerCase();
    if (!MEDIA_HOST_PARTS.some((part) => host === part || host.endsWith(`.${part}`) || host.includes(part))) return null;
    return url;
  } catch {
    return null;
  }
}

async function handle(request: Request) {
  const source = allowedMediaUrl(new URL(request.url).searchParams.get("url") || "");
  if (!source) return new Response("Invalid media url", { status: 400, headers: CORS });

  const headers = new Headers(CORS);
  headers.set("Content-Type", "video/mp4");
  headers.set("Cache-Control", "no-store");
  headers.set("Accept-Ranges", "none");
  if (request.method === "HEAD") return new Response(null, { status: 200, headers });

  const { spawn } = await import("node:child_process");
  const child = spawn("ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    "-user_agent", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1",
    "-i", source.toString(),
    "-map", "0:v:0", "-map", "0:a?",
    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "25", "-pix_fmt", "yuv420p", "-threads", "2",
    "-c:a", "aac", "-b:a", "96k",
    "-movflags", "frag_keyframe+empty_moov+default_base_moof",
    "-f", "mp4", "pipe:1",
  ], { stdio: ["ignore", "pipe", "pipe"] });

  let started = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      child.stdout.on("data", (chunk) => { started = true; controller.enqueue(new Uint8Array(chunk)); });
      child.stdout.on("end", () => controller.close());
      child.stdout.on("error", (error) => controller.error(error));
      child.on("error", (error) => controller.error(error));
      child.on("close", (code) => {
        if (code && !started) controller.error(new Error("Video conversion failed"));
      });
    },
    cancel() { child.kill("SIGTERM"); },
  });
  request.signal.addEventListener("abort", () => child.kill("SIGTERM"), { once: true });
  return new Response(body, { status: 200, headers });
}

export const Route = createFileRoute("/api/public/video-compat")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => handle(request),
      HEAD: async ({ request }) => handle(request),
    },
  },
});
