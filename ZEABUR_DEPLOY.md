# Zeabur 部署说明

本项目是 TanStack Start SSR 应用，不是普通静态站点。部署到 Zeabur 时请使用仓库根目录，并让 Zeabur 读取根目录的 `zbpack.json`：

- Build Command: `DEPLOY_TARGET=zeabur bun run build`
- Start Command: `bun run start`

首页文件保留在 `public/index.html`。构建时它会被复制到网站根路径 `/index.html`，应用根路径 `/` 会服务端重定向到 `/index.html`，不需要把它移动到仓库根目录。