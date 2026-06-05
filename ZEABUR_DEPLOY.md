# Zeabur 部署说明

本项目是 TanStack Start SSR 应用，不是普通静态站点。部署到 Zeabur 时请使用仓库根目录，并优先使用根目录的 `Dockerfile` 构建。Dockerfile 已固定为 Node.js 20，避免 Zeabur 默认使用 Node.js 24。

- Build Command: `DEPLOY_TARGET=zeabur bun run build`
- Start Command: `node dist/server/index.mjs`

如果 Zeabur 仍然显示 Node.js 24，说明它没有读取到最新仓库根目录的 `Dockerfile`，请确认已提交并推送 `Dockerfile`、`.dockerignore`、`zbpack.json` 后重新部署，必要时在 Zeabur 里清理缓存/重新创建服务。

首页文件保留在 `public/index.html`。构建时它会被复制到网站根路径 `/index.html`，应用根路径 `/` 会服务端重定向到 `/index.html`，不需要把它移动到仓库根目录。

Zeabur 环境变量至少需要以下 4 个后端/前端变量，名称必须完全一致：

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

管理员后台已改为通过应用服务端权限校验；部署时不需要在 Zeabur 手动配置 `SUPABASE_SERVICE_ROLE_KEY`。