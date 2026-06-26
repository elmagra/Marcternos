FROM node:20-bookworm-slim

LABEL org.opencontainers.image.title="Marcternos Panel" \
      org.opencontainers.image.description="Panel web para administrar servidores de Minecraft" \
      org.opencontainers.image.source="https://github.com/elmagra/Marcternos" \
      org.opencontainers.image.licenses="MIT"

RUN apt-get update && \
    apt-get install -y --no-install-recommends openjdk-21-jre-headless ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
RUN mkdir -p /app/data/servers /app/data/instances /app/data/backups

ENV NODE_ENV=production \
    PORT=3000 \
    SERVERS_ROOT=/app/data/servers \
    INSTANCE_REGISTRY_PATH=/app/data/instances/registry.json \
    PANEL_ROOT=/app/ \
    JAVA_PATH=java \
    MULTI_INSTANCE_ENABLED=true \
    DYNAMIC_CATALOG_ENABLED=true

EXPOSE 3000 25565 25565/udp

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/server/status || exit 1

CMD ["node", "src/server.js"]
