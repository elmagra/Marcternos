FROM node:20-bookworm-slim

LABEL org.opencontainers.image.title="Panel Minecraft" \
      org.opencontainers.image.description="Panel web para administrar servidores de Minecraft" \
      org.opencontainers.image.source="https://github.com" \
      org.opencontainers.image.licenses="MIT"

RUN apt-get update && \
    apt-get install -y --no-install-recommends openjdk-21-jre-headless ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
RUN mkdir -p /app/data/servers

ENV NODE_ENV=production \
    PORT=3000 \
    SERVERS_ROOT=/app/data/servers \
    PANEL_ROOT=/app/ \
    JAVA_PATH=java

EXPOSE 3000 25565 25565/udp

CMD ["node", "src/server.js"]
