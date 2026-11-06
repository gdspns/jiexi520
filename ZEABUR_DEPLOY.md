# Zeabur 部署说明

本项目是 TanStack Start SSR 应用，不是普通静态站点。部署到 Zeabur 时请使用仓库根目录，并优先使用根目录的 `Dockerfile` 构建。Dockerfile 已固定为 Node.js 22。

- Build Command: `DEPLOY_TARGET=zeabur bun run build`
- Start Command: `node dist/server/index.mjs`

如果 Zeabur 仍然显示 Node.js 24，说明它没有读取到最新仓库根目录的 `Dockerfile`，请确认已提交并推送 `Dockerfile`、`.dockerignore`、`zbpack.json` 后重新部署，必要时在 Zeabur 里清理缓存/重新创建服务。

域名检查：`www.jx520.top` 必须绑定到当前 Zeabur 服务；裸域 `jx520.top` 如果没有单独绑定会返回 Zeabur 404。Cloudflare 502 页面里显示 `Host Error` 时，说明 Cloudflare 到 Zeabur 源站连接失败，优先检查 Zeabur 服务是否正在运行、端口是否为 `3000`、Start Command 是否为 `node dist/server/index.mjs`，以及域名是否指向当前服务。

首页文件保留在 `public/index.html`。构建时它会被复制到网站根路径 `/index.html`，应用根路径 `/` 会服务端重定向到 `/index.html`，不需要把它移动到仓库根目录。

Zeabur 环境变量至少需要以下变量，名称必须完全一致：

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

海外 TikTok / YouTube 解析依赖 Dockerfile 内置的 `/usr/local/bin/yt-dlp`。重新部署后如果仍显示 HTTP 502，请先确认 Zeabur 使用的是 Dockerfile 构建，而不是 Nixpacks/静态构建。

## 平台 Cookie（可选）

各平台 Cookie 使用 Netscape `cookies.txt` 文件的 Base64 内容，环境变量名称如下：

- `DOUYIN_COOKIES_B64`：抖音
- `KUAISHOU_COOKIES_B64`：快手
- `XIAOHONGSHU_COOKIES_B64`：小红书
- `BILIBILI_COOKIES_B64`：B站
- `WEIBO_COOKIES_B64`：微博
- `WEISHI_COOKIES_B64`：微视
- `WEIXIN_COOKIES_B64`：微信视频号
- `TIKTOK_COOKIES_B64`、`YOUTUBE_COOKIES_B64`、`INSTAGRAM_COOKIES_B64`、`FACEBOOK_COOKIES_B64`、`TWITTER_COOKIES_B64`、`VIMEO_COOKIES_B64`：海外平台

每个平台也支持同前缀的 `_COOKIES_FILE`、`_COOKIES` 和 `_COOKIE_HEADER`。Cookie 仅用于对应平台，日志会隐藏 Cookie 请求头。快手、微视和视频号目前依赖 yt-dlp 通用提取能力，平台页面或反爬发生变化时仍可能返回不支持或 502。
