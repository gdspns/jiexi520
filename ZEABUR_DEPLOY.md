# Zeabur 部署说明

本项目是 TanStack Start SSR 应用，不是普通静态站点。部署到 Zeabur 时请使用仓库根目录，并优先使用根目录的 `Dockerfile` 构建。Dockerfile 已固定为 Node.js 20，避免 Zeabur 默认使用 Node.js 24。

- Build Command: `DEPLOY_TARGET=zeabur bun run build`
- Start Command: `node dist/server/index.mjs`

如果 Zeabur 仍然显示 Node.js 24，说明它没有读取到最新仓库根目录的 `Dockerfile`，请确认已提交并推送 `Dockerfile`、`.dockerignore`、`zbpack.json` 后重新部署，必要时在 Zeabur 里清理缓存/重新创建服务。

首页文件保留在 `public/index.html`。构建时它会被复制到网站根路径 `/index.html`，应用根路径 `/` 会服务端重定向到 `/index.html`，不需要把它移动到仓库根目录。