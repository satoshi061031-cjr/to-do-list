# dayfly server: Node 22 with its built-in SQLite. Data lives in the /data volume.
# Usage: see "Self-hosting with Docker" in README.md (docker compose up -d --build).

# Public client files: exactly the ones listed in server/public-assets.js.
FROM node:22-slim AS assets
WORKDIR /src
COPY . .
RUN node -e " \
      const fs = require('node:fs'), path = require('node:path'); \
      for (const file of require('./server/public-assets')) { \
        const target = path.join('/public', file); \
        fs.mkdirSync(path.dirname(target), { recursive: true }); \
        fs.copyFileSync(file, target); \
      }"

# Production dependencies only.
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:22-slim
WORKDIR /app
ENV PORT=3000 \
    DAILY_SPACE_DB_PATH=/data/dayfly.sqlite \
    NPM_CONFIG_UPDATE_NOTIFIER=false

# Application files stay owned by root; the server only writes to /data.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server/ ./server/
# Keeps `npm run db:backup` available inside the container.
COPY scripts/backup-db.js ./scripts/
COPY --from=assets /public/ ./

RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

CMD ["npm", "start"]
