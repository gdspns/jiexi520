FROM oven/bun:latest AS build
LABEL "language"="nodejs"
LABEL "framework"="tanstack-start"
WORKDIR /src
COPY . .
RUN bun install
RUN bun run build

FROM node:22-slim
WORKDIR /src
COPY --from=build /src/dist ./dist
COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/package.json ./package.json
EXPOSE 8080
CMD ["node", "dist/index.js"]
