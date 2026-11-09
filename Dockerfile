FROM node:22-bookworm-slim AS deps

WORKDIR /app

ENV HUSKY=0

COPY package.json bun.lock ./

RUN npm install -g bun@1.3.3 \
  && bun install --frozen-lockfile

FROM node:22-bookworm-slim AS builder

WORKDIR /app

# 默认按 Node 产物构建（.output/server/index.mjs）。vite.config.ts 里只要不是
# DEPLOY_TARGET=cloudflare/lovable 就会用 node-server preset，自建服务器直接
# `bun run build` 也能出同样的产物。
ENV DEPLOY_TARGET=zeabur
ENV HUSKY=0

RUN npm install -g bun@1.3.3

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p public/vendor \
  && cp node_modules/@supabase/supabase-js/dist/umd/supabase.js public/vendor/supabase.js \
  && bun run build \
  && test -f .output/server/index.mjs

FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

# yt-dlp (used by youtube-dl-exec for overseas video parsing) is a Python zipapp
# and requires python3 at runtime. ca-certificates for HTTPS to upstream sites.
# GitHub 在部分网络（尤其是国内服务器）经常拉不下来，所以这里带重试，
# 失败时自动退回 pip 安装，避免整次 docker build 因为一个可选组件而失败。
RUN set -eux; \
  apt-get update; \
  apt-get install -y --no-install-recommends python3 ca-certificates curl ffmpeg; \
  ok=0; \
  for i in 1 2 3 4 5; do \
    if curl -fsSL --retry 2 --retry-delay 2 --connect-timeout 15 \
      -o /usr/local/bin/yt-dlp \
      https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp; then ok=1; break; fi; \
    echo "yt-dlp 下载失败（第 ${i} 次），3 秒后重试…"; \
    sleep 3; \
  done; \
  chmod +x /usr/local/bin/yt-dlp 2>/dev/null || true; \
  if [ "${ok}" != "1" ] || ! /usr/local/bin/yt-dlp --version; then \
    echo "GitHub 直连不可用，改用 pip 安装 yt-dlp"; \
    rm -f /usr/local/bin/yt-dlp; \
    apt-get install -y --no-install-recommends python3-pip; \
    python3 -m pip install --break-system-packages --no-cache-dir -U yt-dlp; \
  fi; \
  yt-dlp --version; \
  apt-get purge -y curl; \
  apt-get autoremove -y; \
  rm -rf /var/lib/apt/lists/*

# Tell youtube-dl-exec to use the system yt-dlp instead of the one its
# postinstall would download (bun skips postinstall scripts by default).
ENV YOUTUBE_DL_PATH=/usr/local/bin/yt-dlp

# 运行阶段不再需要 node_modules：nitro 的 node-server 产物已经把运行期依赖
# 全部打进 .output/server（_libs/*.mjs），实测在完全没有 node_modules 的情况下
# /、/index.html、/auth、/api/public/media-proxy 全部正常。
# 少拷一份 node_modules 能让镜像从 ~1.09GB 降到 ~0.4GB，每次部署少写 0.7GB 磁盘，
# 这正是之前服务器被撑到 98% 的主因。
COPY --from=builder /app/.output ./.output
COPY --from=builder /app/package.json ./package.json

EXPOSE 3000

# 部署后能直接从 docker ps 看出服务是否真的活着，不用先 curl 站点。
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/index.html').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", ".output/server/index.mjs"]
