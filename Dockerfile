# Stufe 1: Oberfläche bauen
FROM node:26-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stufe 2: Laufendes Image
FROM node:26-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g @anthropic-ai/claude-code @openai/codex

WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY --from=build /app/dist ./dist

# Alles Dauerhafte (Datenbank, Anmeldungen der KI-CLIs) liegt in /app/data.
ENV CLAUDE_CONFIG_DIR=/app/data/claude \
    CODEX_HOME=/app/data/codex
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node

EXPOSE 8787
CMD ["node", "src/server.ts"]
