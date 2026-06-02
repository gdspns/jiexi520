import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "音影无损 - 视频转MP3提取器 (Pro)" },
      { name: "description", content: "纯前端视频转 MP3 提取器" },
    ],
  }),
  component: Index,
});

function Index() {
  if (typeof window !== "undefined") {
    window.location.replace("/app.html");
  }
  return (
    <div style={{ minHeight: "100vh", background: "#0f172a" }} />
  );
}
