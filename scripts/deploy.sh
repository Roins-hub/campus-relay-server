#!/usr/bin/env bash
set -euo pipefail

APP_NAME="campus-relay-server"
APP_DIR="/www/wwwroot/${APP_NAME}"

cd "${APP_DIR}"

if [ ! -f .env ]; then
  cp .env.example .env
  SECRET="$(openssl rand -hex 32)"
  sed -i "s/change-this-to-a-long-random-secret/${SECRET}/" .env
  sed -i "s#DB_PATH=./data/relay.sqlite#DB_PATH=./data/relay.json#" .env
fi

npm install --omit=dev --registry=https://registry.npmmirror.com

if pm2 describe "${APP_NAME}" >/dev/null 2>&1; then
  pm2 restart "${APP_NAME}" --update-env
else
  pm2 start src/server.js --name "${APP_NAME}"
fi

pm2 save

for attempt in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:8780/health; then
    echo
    exit 0
  fi
  sleep 1
done

echo "campus-relay-server did not pass health check. Recent logs:" >&2
pm2 logs "${APP_NAME}" --lines 50 --nostream >&2
exit 1
