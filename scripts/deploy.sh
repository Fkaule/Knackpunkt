#!/bin/sh
# Spielserver auf einen Docker-Host bringen: bauen, Dateien kopieren, Image dort bauen, Container neu starten.
# Aufruf: KNACKPUNKT_HOST=<ssh-name des Servers> scripts/deploy.sh [--force]
# Bricht ab, wenn gerade eine Runde läuft (der Neustart würde sie beenden).
set -e
cd "$(dirname "$0")/.."
HOST="${KNACKPUNKT_HOST:?Bitte KNACKPUNKT_HOST auf den SSH-Namen des Servers setzen}"
PORT="${KNACKPUNKT_PORT:-8907}"
node build.mjs
STATUS=$(ssh "$HOST" "curl -s --max-time 5 http://127.0.0.1:$PORT/api/status" || true)
echo "Status vorher: ${STATUS:-kein Server}"
RUNNING=$(printf '%s' "$STATUS" | sed -n 's/.*"roundsRunning":\([0-9]*\).*/\1/p')
if [ "$1" != "--force" ] && [ -n "$RUNNING" ] && [ "$RUNNING" -gt 0 ]; then
  echo "Abbruch: Es läuft gerade eine Runde. Später erneut versuchen oder --force."
  exit 1
fi
tar czf - Dockerfile .dockerignore package.json package-lock.json server.mjs game.html deploy/nginx-knackpunkt-location.conf \
  | ssh "$HOST" 'mkdir -p ~/knackpunkt && tar xzf - -C ~/knackpunkt'
ssh "$HOST" "cd ~/knackpunkt && docker build -q -t knackpunkt . \
  && (docker rm -f knackpunkt >/dev/null 2>&1 || true) \
  && docker run -d --name knackpunkt --restart unless-stopped -p 127.0.0.1:$PORT:8080 knackpunkt >/dev/null \
  && sleep 2 && echo \"Status nachher: \$(curl -s http://127.0.0.1:$PORT/api/status)\""
