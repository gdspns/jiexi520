FROM node:22-bookworm-slim AS deps

WORKDIR /app

ENV HUSKY=0

COPY package.json bun.lock ./

RUN npm install -g bun@1.3.3 \
  && bun install --frozen-lockfile

FROM node:22-bookworm-slim AS builder

WORKDIR /app

ENV DEPLOY_TARGET=zeabur
ENV HUSKY=0

RUN npm install -g bun@1.3.3

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build

FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

# yt-dlp (used by youtube-dl-exec for overseas video parsing) is a Python zipapp
# and requires python3 at runtime. ca-certificates for HTTPS to upstream sites.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 ca-certificates curl \
  && curl -fsSL -o /usr/local/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
  && chmod +x /usr/local/bin/yt-dlp \
  && apt-get purge -y curl \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*

# Tell youtube-dl-exec to use the system yt-dlp instead of the one its
# postinstall would download (bun skips postinstall scripts by default).
ENV YOUTUBE_DL_PATH=/usr/local/bin/yt-dlp

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

EXPOSE 3000

CMD ["node", "dist/server/index.mjs"]