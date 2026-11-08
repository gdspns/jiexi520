import { createFileRoute } from "@tanstack/react-router";
import { proxyMedia, PROXY_CORS } from "@/lib/media-proxy.server";

export const Route = createFileRoute("/api/public/media-proxy")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: PROXY_CORS }),
      GET: async ({ request }) => proxyMedia(request),
      HEAD: async ({ request }) => proxyMedia(request),
    },
  },
});
