FROM node:20-bookworm-slim AS deps

WORKDIR /app

ENV HUSKY=0

COPY package.json bun.lock ./

RUN npm install -g bun@1.3.3 \
  && bun install --frozen-lockfile

FROM node:20-bookworm-slim AS builder

WORKDIR /app

ENV DEPLOY_TARGET=zeabur
ENV HUSKY=0

# Install bun in builder stage
RUN npm install -g bun@1.3.3

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build

FROM node:20-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

EXPOSE 8080

CMD ["node", "dist/server/index.mjs"]
