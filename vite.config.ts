// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// 部署目标：
//   - 默认（自建服务器 / Zeabur / Docker）→ node-server，产物为 .output/server/index.mjs
//   - DEPLOY_TARGET=cloudflare | lovable → 保留平台默认的 Cloudflare Worker 构建
// 之前只有 DEPLOY_TARGET=zeabur 才生成 .output，自己在服务器上跑 `bun run build`
// 时 nitro 插件被整个跳过，随后 `node .output/server/index.mjs` 找不到文件 → 部署失败。
const deployTarget = process.env.DEPLOY_TARGET;
const useNodePreset = deployTarget !== "cloudflare" && deployTarget !== "lovable";

export default defineConfig({
  nitro: useNodePreset
    ? {
        preset: "node-server",
      }
    : undefined,
  vite: {
    resolve: {
      // React 19 的 react-dom/server.node.js 里用的是 require("crypto") / require("stream")。
      // Vite 7 在 nitro 这个构建环境里会把它当 npm 包去解析，直接抛
      //   [commonjs--resolver] Failed to resolve entry for package "crypto"
      // 并中断整个构建（本地和 Linux 都会复现）。指到 node: 前缀的内置模块即可。
      alias: {
        crypto: "node:crypto",
        stream: "node:stream",
        util: "node:util",
        buffer: "node:buffer",
        events: "node:events",
        string_decoder: "node:string_decoder",
      },
    },
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
