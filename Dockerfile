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
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev

# Der `claude`-Befehl wird nur für `claude auth login` gebraucht.
# Gleiche Version wie im Agent SDK, damit Login und SDK zusammenpassen.
RUN npm install -g "@anthropic-ai/claude-code@$(node -p "require('@anthropic-ai/claude-agent-sdk/package.json').claudeCodeVersion")"

COPY src ./src
COPY --from=build /app/dist ./dist

# Alles Dauerhafte (Datenbank, Anmeldungen der KIs) liegt in /app/data.
# Die Pfade stehen hier zusätzlich zu src/config.ts, damit auch `docker compose exec … claude auth login`
# die Anmeldung dort ablegt.
ENV CLAUDE_CONFIG_DIR=/app/data/claude \
    CODEX_HOME=/app/data/codex \
    PATH=/app/node_modules/.bin:$PATH
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node

EXPOSE 8787
CMD ["node", "src/server.ts"]
