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

  const { spawn } = await import("node:child_process");
  const args = [
    target,
    "--no-warnings",
    "--no-check-certificates",
    "--socket-timeout",
    "30",
    "--add-header",
    "referer:https://www.tiktok.com/",
    "--add-header",
    "user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "-o",
    "-",
  ];
  args.splice(1, 0, "-f", type === "audio" ? "bestaudio/best" : "best[ext=mp4]/best");

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
  headers.set("Content-Type", type === "audio" ? "audio/mpeg" : "video/mp4");
  headers.set("Cache-Control", "no-store");
  headers.set("Accept-Ranges", "none");
  if (request.method === "HEAD") return new Response(null, { status: 200, headers });
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