# Knackpunkt-Spielserver: liefert game.html aus und verteilt den Spielstatus per WebSocket
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server.mjs game.html ./
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
