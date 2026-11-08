# 自建服务器部署说明

本项目是 **TanStack Start SSR 应用**，不是静态站点，必须跑 Node 进程（`node .output/server/index.mjs`）。
把它当静态站丢进 Nginx 的 `html` 目录，只会得到 404 或白页。

## 一、必须知道的两个构建前提

1. **构建命令就是 `bun run build`**（不需要额外加 `DEPLOY_TARGET=zeabur`）
   `vite.config.ts` 默认就按 `node-server` 出产物，只有显式 `DEPLOY_TARGET=cloudflare|lovable`
   才会走 Cloudflare Worker 构建。产物固定在 `.output/`。
2. **Node 版本 ≥ 20.19，推荐 22**。Node 18 及以下构建会失败。

## 二、Docker 部署（推荐）

```bash
git clone https://github.com/gdspns/jiexi520.git
cd jiexi520

# 1) 准备环境变量（不要提交到仓库）
cp .env.example .env 2>/dev/null || true
vi .env   # 至少填下面三个

docker compose up -d --build
docker compose logs -f          # 看到 Listening on: http://0.0.0.0:3000 就是成功了
curl -I http://127.0.0.1:3000/index.html
```

`docker compose` 里已经带 `restart: unless-stopped` 和 `HEALTHCHECK`，
容器挂了会自动拉起，`docker ps` 能直接看到 healthy / unhealthy。

镜像构建过程中如果卡在 `yt-dlp` 下载（国内网络拉 GitHub 经常失败），
Dockerfile 已经做了 5 次重试 + pip 兜底，不会因此整体失败。

## 三、MiniPaaS / 宝塔 / 1Panel 这类面板

面板一般有两种构建方式，按优先级选：

**A. 能识别 Dockerfile（首选）** —— 直接选它，把 `Dockerfile` 作为构建方式，
端口填 `3000`，其余不用配。Dockerfile 里已经把 Node 22、bun、ffmpeg、python3、
yt-dlp 全部装好。

**B. 只能填命令（Nixpacks / Node 构建包）** —— 三个字段必须这样填：

| 字段 | 值 |
|---|---|
| 运行时版本 | Node **22**（最低 20.19，Node 18 会失败） |
| 安装命令 | `bun install --frozen-lockfile`（先 `npm i -g bun@1.3.3`） |
| 构建命令 | `bun run build` |
| 启动命令 | `node .output/server/index.mjs` |
| 端口 | `3000`（并设置 `HOST=0.0.0.0`） |

面板如果用 `npm install` 而不是 bun，也会成功——仓库里加了 `.npmrc`，
把依赖的生命周期脚本关掉了。原因是 `youtube-dl-exec` 在安装时会强制检查
python3、还会从 GitHub 下载 yt-dlp 二进制，国内网络下这一步几乎必失败，
表现就是「安装依赖阶段部署失败」。

但**运行时仍然需要 yt-dlp 和 ffmpeg**（海外视频解析、iOS 兼容转码要用）：

```bash
sudo apt-get update && sudo apt-get install -y python3 ffmpeg curl ca-certificates
sudo curl -fsSL -o /usr/local/bin/yt-dlp \
  https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp   # 失败就用 pip
sudo chmod +x /usr/local/bin/yt-dlp
# 拉不下来时改用：
# sudo apt-get install -y python3-pip && sudo pip3 install -U yt-dlp --break-system-packages
```

然后在面板的环境变量里加一条 `YOUTUBE_DL_PATH=/usr/local/bin/yt-dlp`。

## 四、不用 Docker（裸机 / systemd）

```bash
# 系统依赖：ffmpeg 用于视频转码，python3 供 yt-dlp 使用
sudo apt-get update && sudo apt-get install -y python3 ffmpeg curl ca-certificates

# Node 22 + Bun
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
npm install -g bun@1.3.3

# 装依赖并构建
bun install --frozen-lockfile
bun run build
test -f .output/server/index.mjs && echo "构建产物 OK"

# 启动
PORT=3000 HOST=0.0.0.0 node .output/server/index.mjs
```

systemd 方式（`/etc/systemd/system/jiexi520.service`）：

```ini
[Unit]
Description=jiexi520
After=network.target

[Service]
Type=simple
WorkingDirectory=/www/jiexi520
EnvironmentFile=/www/jiexi520/.env
Environment=NODE_ENV=production
Environment=HOST=0.0.0.0
Environment=PORT=3000
ExecStart=/usr/bin/node .output/server/index.mjs
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now jiexi520
sudo journalctl -u jiexi520 -f
```

## 五、Nginx 反代

SSR 站点要把请求转给 Node，不要配 `root`：

```nginx
server {
    listen 80;
    server_name your-domain.com;
    client_max_body_size 32m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_buffering off;          # 视频流接口需要
        proxy_read_timeout 300s;
    }
}
```

## 六、环境变量

| 变量 | 是否必需 | 说明 |
|---|---|---|
| `SUPABASE_URL` | ✅ | Supabase 项目地址 |
| `SUPABASE_PUBLISHABLE_KEY` | ✅ | anon / publishable key |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` | ✅ | 同上，给前端打包用 |
| `SUPABASE_SERVICE_ROLE_KEY` | ⚠️ 强烈建议 | 后台管理、订单落库、主动查单都依赖它，缺了会 500 |
| `PORT` | 可选 | 默认 3000 |
| `HOST` | 可选 | 容器内固定 `0.0.0.0` |

`.env` 被 `.dockerignore` 排除，不会进镜像；Docker 部署请在 `docker-compose.yml` 里用
`env_file` 或 `-e` 传入，裸机部署用 systemd 的 `EnvironmentFile`。

## 七、部署失败怎么自查

按顺序看，基本能定位到 90% 的问题：

1. **构建阶段报 `Failed to resolve entry for package "crypto"`**
   → 旧版本问题，已在 `vite.config.ts` 里通过 alias 修掉，拉最新代码即可。
2. **构建成功但启动报 `Cannot find module '/app/.output/server/index.mjs'`**
   → 构建时用了 Cloudflare 目标，或者根本没跑 nitro。检查有没有设
   `DEPLOY_TARGET=cloudflare`，并确认 `bun run build` 结尾有
   `Generated .output/nitro.json`。
3. **进程起来了但页面 500 / 白屏**
   → 环境变量没注入（尤其 `SUPABASE_SERVICE_ROLE_KEY`），看进程日志里的
   `Missing Supabase` 或 `supabaseUrl is required`。
4. **站点能开但海外视频解析失败**
   → 容器里没有 `yt-dlp`，`which yt-dlp` 检查；或服务器访问不了 YouTube/TikTok。
5. **端口不通**
   → 云厂商安全组要放行端口；Nginx 反代要指向 `127.0.0.1:3000` 而不是静态目录。
