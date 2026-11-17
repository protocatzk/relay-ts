# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Build stage: TypeScript server + Vue dashboard
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json tsconfig.build.json vite.config.ts ./
COPY src ./src
RUN npm run build

# ---------------------------------------------------------------------------
# Runtime stage: Node + ffmpeg + yt-dlp
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache \
      ffmpeg \
      yt-dlp \
      tini \
      su-exec \
      curl \
      ca-certificates \
      tzdata \
      font-dejavu \
      font-noto-emoji

ENV NODE_ENV=production \
    FFMPEG_BIN=ffmpeg \
    YTDLP_BIN=yt-dlp \
    SERVER_HOST=0.0.0.0 \
    SERVER_PORT=3000 \
    RELAY_HOST=127.0.0.1 \
    RELAY_PORT=12345 \
    LOGS_DIR=/app/logs \
    DATA_DIR=/app/data

COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/web/dist ./web/dist
COPY config ./config
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh

RUN chmod +x /usr/local/bin/entrypoint.sh \
    && mkdir -p /app/config /app/logs /app/data /app/data/overlays \
    && chown -R 1001:1001 /app/config /app/logs /app/data

EXPOSE 3000 12345

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${SERVER_PORT}/health" || exit 1

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/entrypoint.sh"]
CMD ["node", "dist/main.js"]
